import type { Choice } from '../engine/types';
import type { Bus } from './mqtt';
import {
  lastLevel,
  topics,
  type ActionMsg,
  type ClosedMsg,
  type HandMsg,
  type JoinMsg,
  type LobbyMsg,
  type PublicState,
} from './protocol';

export interface ClientSnapshot {
  lobby?: LobbyMsg;
  pub?: PublicState;
  hand?: HandMsg;
  presence: Record<string, boolean>;
  connected: boolean;
  /** Someone ended the game; the room's state has been wiped. */
  closed?: ClosedMsg;
}

/** The host gave this player's seat to a bot. */
export function replacedByBot(s: ClientSnapshot, pid: string): boolean {
  return !!s.lobby?.players.some((p) => p.id === pid && p.bot);
}

/** One player's connection to a room. */
export class Player {
  snapshot: ClientSnapshot = { presence: {}, connected: false };
  private listeners = new Set<(s: ClientSnapshot) => void>();
  private cleared = false;

  constructor(
    private bus: Bus,
    readonly room: string,
    readonly id: string,
    private name: string,
  ) {}


  start(): void {
    this.bus.onStatus((connected) => {
      this.update({ connected });
      if (connected) void this.announce();
    });
    this.bus.subscribe(topics.closed(this.room), (_t, p) => {
      if (!p) return;
      this.update({ closed: p as ClosedMsg });
      void this.clearOwn();
    });
    this.bus.subscribe(topics.lobby(this.room), (_t, p) => {
      this.update({ lobby: (p as LobbyMsg) ?? undefined });
      if (replacedByBot(this.snapshot, this.id)) void this.clearOwn();
    });
    this.bus.subscribe(topics.publicState(this.room), (_t, p) => this.update({ pub: (p as PublicState) ?? undefined }));
    this.bus.subscribe(topics.hand(this.room, this.id), (_t, p) => this.update({ hand: (p as HandMsg) ?? undefined }));
    this.bus.subscribe(topics.presenceAll(this.room), (t, p) =>
      this.update({ presence: { ...this.snapshot.presence, [lastLevel(t)]: p === 'online' } }),
    );
    if (this.bus.online) {
      this.update({ connected: true });
      void this.announce();
    }
  }

  private async announce() {
    if (this.gone) return;
    await this.bus.publish(topics.presence(this.room, this.id), 'online', true);
    await this.bus.publish(topics.join(this.room, this.id), { name: this.name } satisfies JoinMsg, true);
  }

  /** The room is closed or this player was replaced: nothing to publish any more. */
  get gone(): boolean {
    return !!this.snapshot.closed || replacedByBot(this.snapshot, this.id);
  }

  rename(name: string): void {
    this.name = name;
    void this.bus.publish(topics.join(this.room, this.id), { name } satisfies JoinMsg, true);
  }

  /** Asks the host for a civilization (manual mode); undefined drops the pick. */
  pickCiv(civ: string | null): void {
    const msg: JoinMsg = { name: this.name, civ };
    void this.bus.publish(topics.join(this.room, this.id), msg, true);
  }

  send(choice: Choice): void {
    const pub = this.snapshot.pub;
    if (!pub) return;
    const msg: ActionMsg = { epoch: pub.epoch, turn: pub.turn, choice };
    void this.bus.publish(topics.action(this.room, this.id), msg, true);
  }

  /**
   * Ends the game for everyone: marks the room closed (the host stops on
   * that) and removes every retained message of the room.
   */
  async endGame(): Promise<void> {
    const ids = new Set([this.id, ...(this.snapshot.lobby?.players.map((p) => p.id) ?? [])]);
    const r = this.room;
    await this.bus.publish(topics.closed(r), { by: this.name } satisfies ClosedMsg, true);
    const clear = [topics.lobby(r), topics.publicState(r), topics.hostState(r)];
    for (const id of ids) clear.push(topics.join(r, id), topics.action(r, id), topics.hand(r, id), topics.presence(r, id));
    await Promise.all(clear.map((t) => this.bus.publish(t, null, true)));
  }

  /** Removes this player's own retained messages once it is out of the room. */
  private async clearOwn(): Promise<void> {
    if (this.cleared) return;
    this.cleared = true;
    const r = this.room;
    const own = [topics.join(r, this.id), topics.action(r, this.id), topics.hand(r, this.id), topics.presence(r, this.id)];
    await Promise.all(own.map((t) => this.bus.publish(t, null, true)));
  }

  subscribe(fn: (s: ClientSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<ClientSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }
}

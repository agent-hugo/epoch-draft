import type { Choice } from '../engine/types';
import type { Bus } from './mqtt';
import {
  topics,
  type ActionMsg,
  type ClosedMsg,
  type HandMsg,
  type JoinMsg,
  type LobbyMsg,
  type PresenceMsg,
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

/**
 * Ends a room for everyone: marks it closed (the host stops on that and
 * players see who ended it) and removes every other retained message of the
 * room.
 */
export async function deleteRoom(bus: Bus, room: string, by: string): Promise<void> {
  await bus.publish(topics.closed(room), { by } satisfies ClosedMsg, true);
  const left = await bus.retainedTopics(`${topics.room(room)}/#`);
  await Promise.all(left.filter((t) => t !== topics.closed(room)).map((t) => bus.publish(t, null, true)));
}

/** One player's connection to a room. */
export class Player {
  snapshot: ClientSnapshot = { presence: {}, connected: false };
  private listeners = new Set<(s: ClientSnapshot) => void>();
  private cleared = false;
  /** This connection has said it is in the room (and joined, if needed). */
  private announced = false;
  /** Players whose presence is watched. */
  private watched = new Set<string>();

  constructor(
    private bus: Bus,
    readonly room: string,
    readonly id: string,
    private name: string,
  ) {}


  start(): void {
    this.bus.onStatus((connected) => {
      this.update({ connected });
      // After a dropped connection the will has said 'offline'.
      if (!connected) this.announced = false;
      void this.announce();
    });
    this.bus.subscribe(topics.closed(this.room), (_t, p) => {
      if (!p) return;
      this.update({ closed: p as ClosedMsg });
      void this.clearOwn();
    });
    this.bus.subscribe(topics.lobby(this.room), (_t, p) => {
      this.update({ lobby: (p as LobbyMsg) ?? undefined });
      this.watchPresence();
      if (replacedByBot(this.snapshot, this.id)) void this.clearOwn();
      else void this.announce();
    });
    this.bus.subscribe(topics.publicState(this.room), (_t, p) => this.update({ pub: (p as PublicState) ?? undefined }));
    this.bus.subscribe(topics.hand(this.room, this.id), (_t, p) => this.update({ hand: (p as HandMsg) ?? undefined }));
    if (this.bus.online) this.update({ connected: true });
  }

  /** Follows where the lobby's players are: online here or not. */
  private watchPresence() {
    for (const p of this.snapshot.lobby?.players ?? []) {
      if (p.bot || this.watched.has(p.id)) continue;
      this.watched.add(p.id);
      void this.bus.subscribe(topics.presence(p.id, this.room), (_t, msg) =>
        this.update({ presence: { ...this.snapshot.presence, [p.id]: msg === 'online' } }),
      );
    }
  }

  /**
   * Says it is in the room and joins once the lobby is known, and only where that
   * means something: not in a finished game, not as an onlooker of a game
   * already under way. The join is sent only if the lobby lacks this player
   * under this name, so merely opening a room does not rewrite it.
   */
  private async announce() {
    const lobby = this.snapshot.lobby;
    if (this.announced || this.gone || !this.snapshot.connected || !lobby || lobby.over) return;
    const me = lobby.players.find((p) => p.id === this.id);
    if (lobby.started && !me) return;
    this.announced = true;
    await this.bus.publish(topics.presence(this.id, this.room), 'online' satisfies PresenceMsg, true);
    if (me?.name !== this.name)
      await this.bus.publish(topics.join(this.room, this.id), { name: this.name } satisfies JoinMsg, true);
  }

  /** Leaving the room: 'offline', if this player said it was here. */
  leave(): Promise<void> {
    if (!this.announced) return Promise.resolve();
    this.announced = false;
    return this.bus.publish(topics.presence(this.id, this.room), 'offline' satisfies PresenceMsg, true);
  }

  /** The room is closed or this player was replaced: nothing to publish any more. */
  get gone(): boolean {
    return !!this.snapshot.closed || replacedByBot(this.snapshot, this.id);
  }

  rename(name: string): void {
    if (name === this.name) return;
    this.name = name;
    void this.bus.publish(topics.join(this.room, this.id), { name } satisfies JoinMsg, true);
  }

  /** Asks the host for a civilization (manual mode); undefined drops the pick. */
  pickCiv(civ: string | null): void {
    const me = this.snapshot.lobby?.players.find((p) => p.id === this.id);
    if (me && (me.civ ?? null) === civ) return;
    const msg: JoinMsg = { name: this.name, civ };
    void this.bus.publish(topics.join(this.room, this.id), msg, true);
  }

  /** Sends this turn's move; null withdraws it while others are still choosing. */
  send(choice: Choice | null): void {
    const pub = this.snapshot.pub;
    if (!pub) return;
    // Already the move the host holds: nothing to tell it.
    const hand = this.snapshot.hand;
    if (hand && hand.epoch === pub.epoch && hand.turn === pub.turn && !hand.error)
      if (JSON.stringify(hand.chosen ?? null) === JSON.stringify(choice)) return;
    const msg: ActionMsg = { epoch: pub.epoch, turn: pub.turn, choice };
    void this.bus.publish(topics.action(this.room, this.id), msg, true);
  }

  /** Ends the game for everyone; see {@link deleteRoom}. */
  endGame(): Promise<void> {
    return deleteRoom(this.bus, this.room, this.name);
  }

  /** Removes this player's own retained messages once it is out of the room. */
  private async clearOwn(): Promise<void> {
    if (this.cleared) return;
    this.cleared = true;
    const r = this.room;
    const own = [topics.join(r, this.id), topics.action(r, this.id), topics.hand(r, this.id)];
    await Promise.all([...own.map((t) => this.bus.publish(t, null, true)), this.leave()]);
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

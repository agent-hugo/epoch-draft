import type { Choice } from '../engine/types';
import type { Bus } from './mqtt';
import {
  lastLevel,
  topics,
  type ActionMsg,
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
}

/** One player's connection to a room. */
export class Player {
  snapshot: ClientSnapshot = { presence: {}, connected: false };
  private listeners = new Set<(s: ClientSnapshot) => void>();

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
    this.bus.subscribe(topics.lobby(this.room), (_t, p) => this.update({ lobby: (p as LobbyMsg) ?? undefined }));
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
    await this.bus.publish(topics.presence(this.room, this.id), 'online', true);
    await this.bus.publish(topics.join(this.room, this.id), { name: this.name } satisfies JoinMsg, true);
  }

  rename(name: string): void {
    this.name = name;
    void this.bus.publish(topics.join(this.room, this.id), { name } satisfies JoinMsg, true);
  }

  send(choice: Choice): void {
    const pub = this.snapshot.pub;
    if (!pub) return;
    const msg: ActionMsg = { epoch: pub.epoch, turn: pub.turn, choice };
    void this.bus.publish(topics.action(this.room, this.id), msg, true);
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

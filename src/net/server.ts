import { Host, type WorldDbs } from './host';
import type { Bus } from './mqtt';
import { roomOf, topics, type EngineMsg, type ServerPresenceMsg } from './protocol';

/**
 * A game server: runs the games of every room whose leader has handed it
 * to this server's code, so they go on while the leader's phone sleeps.
 * The bus must carry the will `'offline'` on {@link topics.serverPresence}.
 */
export class Server {
  readonly rooms = new Map<string, Host>();
  private listeners = new Set<() => void>();

  constructor(
    private dbs: WorldDbs,
    private bus: Bus,
    readonly code: string,
  ) {}

  async start(): Promise<void> {
    this.bus.onStatus((on) => {
      if (on) void this.announce();
      this.changed();
    });
    await this.announce();
    await this.bus.subscribe(topics.engineAll, (t, p) => this.onEngine(roomOf(t), p as EngineMsg | null));
  }

  private announce(): Promise<void> {
    return this.bus.publish(topics.serverPresence(this.code), 'online' satisfies ServerPresenceMsg, true);
  }

  /** Says it is gone, before the process or the page ends. */
  stop(): Promise<void> {
    return this.bus.publish(topics.serverPresence(this.code), 'offline' satisfies ServerPresenceMsg, true);
  }

  private onEngine(room: string, e: EngineMsg | null) {
    if (!room) return;
    const running = this.rooms.get(room);
    if (e?.id === this.code) {
      if (running && !running.stopped) return;
      const host = new Host(this.dbs, this.bus, room, this.code, e.owner);
      this.rooms.set(room, host);
      host.onChange(() => this.changed());
      host.onStop(() => {
        if (this.rooms.get(room) === host) this.rooms.delete(room);
        this.changed();
      });
      void host.start().then(() => this.changed());
      this.changed();
    } else if (running) {
      running.retire();
    }
  }

  /** Called whenever the rooms or a game in them change. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** For a status page: called when something may have changed. */
  changed(): void {
    for (const l of this.listeners) l();
  }
}

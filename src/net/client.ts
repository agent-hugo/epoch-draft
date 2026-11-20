import type { Choice } from '../engine/types';
import type { Bus } from './mqtt';
import {
  DEFAULT_PREFS,
  lastLevel,
  topics,
  onLeaderPhone,
  type ActionMsg,
  type ClosedMsg,
  type Cmd,
  type CmdMsg,
  type EngineMsg,
  type Op,
  type ServerPresenceMsg,
  type HandMsg,
  type JoinMsg,
  type LobbyMsg,
  type PrefKey,
  type Prefs,
  type PresenceMsg,
  type PublicState,
} from './protocol';

export interface ClientSnapshot {
  lobby?: LobbyMsg;
  pub?: PublicState;
  hand?: HandMsg;
  presence: Record<string, boolean>;
  connected: boolean;
  /** This player's settings, the defaults until the broker says otherwise. */
  prefs: Prefs;
  /** Someone ended the game; the room's state has been wiped. */
  closed?: ClosedMsg;
  /** Who runs the game and who leads the room. */
  engine?: EngineMsg;
  /** Game servers looked at: the room's and the leader's own. */
  servers: Record<string, boolean>;
}

/** The engine of the room is online, as far as is known. */
export function engineOnline(s: ClientSnapshot): boolean {
  const e = s.engine;
  if (!e) return true;
  return onLeaderPhone(e) ? s.presence[e.owner] !== false : s.servers[e.id] === true;
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
  snapshot: ClientSnapshot = { presence: {}, connected: false, prefs: { ...DEFAULT_PREFS }, servers: {} };
  private listeners = new Set<(s: ClientSnapshot) => void>();
  private cleared = false;
  /** This connection has said it is in the room (and joined, if needed). */
  private announced = false;
  /** Players whose presence is watched. */
  private watched = new Set<string>();
  /** Servers whose presence is watched, with the SUBACK of each. */
  private watchedServers = new Map<string, Promise<void>>();
  /** The leader's commands not yet applied, as on the broker. */
  private cmds: Cmd[] = [];
  /** SUBACKs of what the leader needs to know before naming an engine. */
  private loaded?: Promise<unknown>;

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
    const engine = this.bus.subscribe(topics.engine(this.room), (_t, p) => {
      const e = (p as EngineMsg | null) ?? undefined;
      this.update({ engine: e });
      if (e && !onLeaderPhone(e)) void this.watchServer(e.id);
    });
    const cmds = this.bus.subscribe(topics.cmd(this.room), (_t, p) => {
      const list = (p as CmdMsg | null)?.list;
      this.cmds = Array.isArray(list) ? list : [];
    });
    const prefs = this.bus.subscribe(topics.prefAll(this.id), (t, p) => {
      const key = lastLevel(t) as PrefKey;
      if (!(key in DEFAULT_PREFS)) return;
      const value = typeof p === typeof DEFAULT_PREFS[key] ? p : DEFAULT_PREFS[key];
      this.update({ prefs: { ...this.snapshot.prefs, [key]: value } });
      if (key === 'server' && typeof value === 'string' && value) void this.watchServer(value);
    });
    this.loaded = Promise.all([engine, cmds, prefs]);
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

  /** Follows whether a game server is online. */
  watchServer(code: string): Promise<void> {
    let done = this.watchedServers.get(code);
    if (!done) {
      done = this.bus.subscribe(topics.serverPresence(code), (_t, msg) =>
        this.update({ servers: { ...this.snapshot.servers, [code]: (msg as ServerPresenceMsg | null) === 'online' } }),
      );
      this.watchedServers.set(code, done);
    }
    return done;
  }

  /** This player leads the room. */
  get isOwner(): boolean {
    return this.snapshot.engine?.owner === this.id;
  }

  /**
   * Makes this player the leader of a new room: unless the room already has
   * one, the game goes to the leader's server if it is online, otherwise to
   * this phone.
   */
  async claim(): Promise<void> {
    await this.loaded;
    if (this.snapshot.engine || this.gone) return;
    const server = this.snapshot.prefs.server;
    if (server) await this.watchServer(server);
    const id = server && this.snapshot.servers[server] ? server : this.id;
    await this.setEngine(id);
  }

  /**
   * Hands the game to another engine (the leader only): this phone (the
   * leader's id) or a server code. The one running it stops on seeing this.
   */
  setEngine(id: string): Promise<void> {
    const owner = this.snapshot.engine?.owner ?? this.id;
    if (owner !== this.id || this.gone) return Promise.resolve();
    const msg: EngineMsg = { id, owner };
    this.update({ engine: msg });
    if (!onLeaderPhone(msg)) void this.watchServer(id);
    return this.bus.publish(topics.engine(this.room), msg, true);
  }

  /**
   * Asks the engine to do something (the leader only). Commands wait on the
   * broker, in order, until the engine has applied them.
   */
  command(op: Op): void {
    if (!this.isOwner || this.gone) return;
    const applied = this.snapshot.lobby?.cmdSeq ?? 0;
    const queue = this.cmds.filter((c) => c.seq > applied);
    const seq = Math.max(applied, ...queue.map((c) => c.seq)) + 1;
    queue.push({ ...op, seq });
    this.cmds = queue;
    void this.bus.publish(topics.cmd(this.room), { list: queue } satisfies CmdMsg, true);
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

  /** Says again that it is here, after leave() (a page restored from the back-forward cache). */
  rejoin(): void {
    void this.announce();
  }

  /** The room is closed or this player was replaced: nothing to publish any more. */
  get gone(): boolean {
    return !!this.snapshot.closed || replacedByBot(this.snapshot, this.id);
  }

  /**
   * Saves a setting on the broker, for this player on every device. The
   * default is stored as no topic at all.
   */
  setPref<K extends PrefKey>(key: K, value: Prefs[K]): void {
    this.update({ prefs: { ...this.snapshot.prefs, [key]: value } });
    void this.bus.publish(topics.pref(this.id, key), value === DEFAULT_PREFS[key] ? null : value, true, false);
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

import { greedyBot, type Bot } from '../engine/bots';
import type { Db } from '../engine/db';
import { MAX_PLAYERS, MIN_PLAYERS } from '../engine/db';
import { choose, createGame, playerIndex, RuleError, waitingFor } from '../engine/rules';
import type { GameState } from '../engine/types';
import type { Bus } from './mqtt';
import {
  lastLevel,
  publicView,
  randomId,
  topics,
  type ActionMsg,
  type HandMsg,
  type HostSnapshot,
  type JoinMsg,
  type LobbyPlayer,
  type CivMode,
  type LobbyMsg,
} from './protocol';

/** Engine database of a world; the default world for a missing or unknown id. */
export type WorldDbs = (world?: string) => Db;

/**
 * Authoritative game host. Runs in the browser of the player who created
 * the room; all state changes go through it and are published as retained
 * messages.
 */
export class Host {
  lobby: LobbyMsg;
  game?: GameState;
  private bots = new Map<string, Bot>();
  private errors = new Map<string, string>();
  /** The room was closed by a participant: never publish again. */
  private closed = false;

  constructor(
    private dbs: WorldDbs,
    private bus: Bus,
    private room: string,
    hostPlayerId: string,
  ) {
    this.lobby = { host: hostPlayerId, players: [], started: false };
  }

  /** The world of the game, or the one picked in the lobby. */
  private get db(): Db {
    return this.dbs(this.game?.world ?? this.lobby.world);
  }

  /** Restores a previous session from the broker (if any) and starts listening. */
  async start(): Promise<void> {
    this.bus.subscribe(topics.closed(this.room), (_t, payload) => {
      if (payload) this.closed = true;
    });
    const snapshot = await new Promise<HostSnapshot | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      this.bus.subscribe(topics.hostState(this.room), (_t, payload) => {
        clearTimeout(timer);
        resolve((payload as HostSnapshot | null) ?? null);
      });
    });
    if (snapshot && snapshot.lobby.host === this.lobby.host) {
      this.lobby = snapshot.lobby;
      this.game = snapshot.game;
    }
    for (const p of this.lobby.players) if (p.bot) this.bots.set(p.id, this.makeBot(p.id));
    this.bus.subscribe(topics.joinAll(this.room), (topic, payload) => this.onJoin(lastLevel(topic), payload as JoinMsg | null));
    this.bus.subscribe(topics.actionAll(this.room), (topic, payload) =>
      this.onAction(lastLevel(topic), payload as ActionMsg | null),
    );
    await this.publishAll();
  }

  private makeBot(id: string): Bot {
    let seed = 0;
    for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    return greedyBot(seed);
  }

  private onJoin(pid: string, msg: JoinMsg | null) {
    if (this.closed || !msg || typeof msg.name !== 'string') return;
    const name = msg.name.trim().slice(0, 24) || 'Игрок';
    const existing = this.lobby.players.find((p) => p.id === pid);
    let player = existing;
    if (existing) {
      // A player replaced by a bot is out of the game for good.
      if (existing.bot) return;
      if (existing.name !== name) {
        existing.name = name;
        if (this.game) {
          const gp = this.game.players.find((p) => p.id === pid);
          if (gp) gp.name = name;
        }
      }
    } else {
      if (this.lobby.started || this.lobby.players.length >= MAX_PLAYERS) return;
      player = { id: pid, name };
      this.lobby.players.push(player);
    }
    if (!this.lobby.started) this.pickCiv(player!, msg.civ);
    void this.publishAll();
  }

  /** Takes a civilization for a lobby player unless someone else already has it. */
  private pickCiv(p: LobbyPlayer, civ: unknown) {
    if (civ === undefined) return;
    if (civ === null) delete p.civ;
    else if (typeof civ === 'string' && this.db.civs.has(civ) && !this.lobby.players.some((o) => o !== p && o.civ === civ))
      p.civ = civ;
  }

  /** Switches the world in the lobby; civilization picks are dropped. */
  setWorld(world: string): void {
    if (this.lobby.started || this.dbs(world).data.id !== world) return;
    this.lobby.world = world;
    for (const p of this.lobby.players) delete p.civ;
    void this.publishAll();
  }

  setCivMode(mode: CivMode): void {
    if (this.lobby.started) return;
    this.lobby.civMode = mode;
    void this.publishAll();
  }

  /** Players who still have to pick a civilization before the game can start. */
  missingCivs(): LobbyPlayer[] {
    if (this.lobby.civMode !== 'manual') return [];
    return this.lobby.players.filter((p) => !p.bot && !p.civ);
  }

  addBot(): void {
    if (this.lobby.started || this.lobby.players.length >= MAX_PLAYERS) return;
    const id = `bot-${randomId().slice(0, 6)}`;
    const used = new Set(this.lobby.players.map((p) => p.name));
    const names = (this.db.data.bots ?? []).map((n) => `Бот ${n}`);
    const name = names.find((n) => !used.has(n)) ?? `Бот ${this.lobby.players.length + 1}`;
    this.lobby.players.push({ id, name, bot: true });
    this.bots.set(id, this.makeBot(id));
    void this.publishAll();
  }

  removePlayer(pid: string): void {
    if (this.lobby.started || pid === this.lobby.host) return;
    this.lobby.players = this.lobby.players.filter((p) => p.id !== pid);
    this.bots.delete(pid);
    void this.publishAll();
  }

  /**
   * Hands a player's seat to a bot for the rest of the game. The player is
   * dropped: their hand is no longer published and their moves are ignored.
   */
  replaceWithBot(pid: string): void {
    const g = this.game;
    const lp = this.lobby.players.find((p) => p.id === pid);
    if (this.closed || !g || g.phase !== 'play' || pid === this.lobby.host || !lp || lp.bot) return;
    lp.bot = true;
    lp.name = `🤖 ${lp.name}`;
    const gp = g.players.find((p) => p.id === pid);
    if (gp) gp.name = lp.name;
    this.bots.set(pid, this.makeBot(pid));
    this.errors.delete(pid);
    this.runBots();
    void this.publishAll();
    void this.bus.publish(topics.hand(this.room, pid), null, true);
    void this.bus.publish(topics.action(this.room, pid), null, true);
  }

  canStart(): boolean {
    const n = this.lobby.players.length;
    return !this.lobby.started && n >= MIN_PLAYERS && n <= MAX_PLAYERS && this.missingCivs().length === 0;
  }

  startGame(): void {
    if (!this.canStart()) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    // Random seating.
    const seats = this.lobby.players.slice().sort(() => Math.random() - 0.5);
    // Bots and (in random mode) everybody get a random civilization.
    const manual = this.lobby.civMode === 'manual';
    const players = seats.map((p) => ({ id: p.id, name: p.name, civ: manual ? p.civ : undefined }));
    this.game = createGame(this.db, { seed, players });
    this.lobby.started = true;
    this.runBots();
    void this.publishAll();
  }

  private onAction(pid: string, msg: ActionMsg | null) {
    const g = this.game;
    if (this.closed || !msg || !g || g.phase !== 'play') return;
    if (msg.epoch !== g.epoch || msg.turn !== g.turn) return;
    if (!g.players.some((p) => p.id === pid) || this.bots.has(pid)) return;
    const prev = g.pending[pid];
    if (prev && JSON.stringify(prev) === JSON.stringify(msg.choice)) return;
    try {
      this.game = choose(this.db, g, pid, msg.choice);
      this.errors.delete(pid);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.errors.set(pid, e.message);
    }
    this.runBots();
    void this.publishAll();
  }

  private runBots() {
    while (this.game && this.game.phase === 'play') {
      const botId = waitingFor(this.game).find((id) => this.bots.has(id));
      if (!botId) return;
      const i = playerIndex(this.game, botId);
      this.game = choose(this.db, this.game, botId, this.bots.get(botId)!(this.db, this.game, i));
    }
  }

  private async publishAll(): Promise<void> {
    if (this.closed) return;
    const pubs: Promise<void>[] = [this.bus.publish(topics.lobby(this.room), this.lobby, true)];
    const g = this.game;
    if (g) {
      pubs.push(this.bus.publish(topics.publicState(this.room), publicView(g), true));
      for (const p of g.players) {
        if (this.bots.has(p.id)) continue;
        const msg: HandMsg = { epoch: g.epoch, turn: g.turn, hand: p.hand, chosen: g.pending[p.id] };
        const err = this.errors.get(p.id);
        if (err) msg.error = err;
        pubs.push(this.bus.publish(topics.hand(this.room, p.id), msg, true));
      }
    }
    const snapshot: HostSnapshot = { lobby: this.lobby, game: g };
    pubs.push(this.bus.publish(topics.hostState(this.room), snapshot, true));
    await Promise.all(pubs);
  }
}

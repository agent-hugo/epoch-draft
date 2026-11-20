import type { Choice, GameState, PlayerState } from '../engine/types';

export const TOPIC_ROOT = 'epoch-draft';
/** Rooms live under `epoch-draft/room/<room>/`. */
export const ROOMS_ROOT = `${TOPIC_ROOT}/room`;
/** Topics of a player across rooms: `epoch-draft/player/<player>/`. */
export const PLAYERS_ROOT = `${TOPIC_ROOT}/player`;

export const topics = {
  room: (room: string) => `${ROOMS_ROOT}/${room}`,
  /** The lobby of every room. */
  lobbyAll: `${ROOMS_ROOT}/+/lobby`,
  /** The closed marker of every room. */
  closedAll: `${ROOMS_ROOT}/+/closed`,
  lobby: (room: string) => `${ROOMS_ROOT}/${room}/lobby`,
  join: (room: string, pid: string) => `${ROOMS_ROOT}/${room}/join/${pid}`,
  joinAll: (room: string) => `${ROOMS_ROOT}/${room}/join/+`,
  publicState: (room: string) => `${ROOMS_ROOT}/${room}/public`,
  hand: (room: string, pid: string) => `${ROOMS_ROOT}/${room}/hand/${pid}`,
  action: (room: string, pid: string) => `${ROOMS_ROOT}/${room}/action/${pid}`,
  actionAll: (room: string) => `${ROOMS_ROOT}/${room}/action/+`,
  /**
   * Whether a player is online in a room: kept with the player, outside the
   * room, so it never touches the room's topics; one per room, so tabs in
   * different rooms do not overwrite each other.
   */
  presence: (pid: string, room: string) => `${PLAYERS_ROOT}/${pid}/presence/${room}`,
  /** A player's own setting, one topic each, kept for good (no expiry). */
  pref: (pid: string, key: PrefKey) => `${PLAYERS_ROOT}/${pid}/settings/${key}`,
  prefAll: (pid: string) => `${PLAYERS_ROOT}/${pid}/settings/+`,
  /** Full host state, so the host can resume after a reload. */
  hostState: (room: string) => `${ROOMS_ROOT}/${room}/host`,
  /** Set (retained) when a participant ends the game for everyone. */
  closed: (room: string) => `${ROOMS_ROOT}/${room}/closed`,
};

/** Room code of a topic under `epoch-draft/room/<room>/`. */
export function roomOf(topic: string): string {
  return topic.startsWith(`${ROOMS_ROOT}/`) ? (topic.slice(ROOMS_ROOT.length + 1).split('/')[0] ?? '') : '';
}

/** Last topic level, e.g. the player id of `.../action/<pid>`. */
export function lastLevel(topic: string): string {
  return topic.slice(topic.lastIndexOf('/') + 1);
}

export interface LobbyPlayer {
  id: string;
  name: string;
  bot?: boolean;
  /** Civilization picked in the lobby (manual mode only). */
  civ?: string;
}

/** How civilizations are assigned: at random or picked by players in the lobby. */
export type CivMode = 'random' | 'manual';

export interface LobbyMsg {
  host: string;
  players: LobbyPlayer[];
  started: boolean;
  /** The game has been played to the end. */
  over?: boolean;
  /** Missing means random. */
  civMode?: CivMode;
  /** World id; missing means the default world. */
  world?: string;
}

export interface JoinMsg {
  name: string;
  /** Civilization the player wants (manual mode); null drops the pick, missing keeps it. */
  civ?: string | null;
}

/**
 * A player's settings: the host's signals when everybody has chosen and the
 * turn can be ended. A missing topic means on.
 */
export interface Prefs {
  sound: boolean;
  vibrate: boolean;
}
export type PrefKey = keyof Prefs;
export const DEFAULT_PREFS: Prefs = { sound: true, vibrate: true };

/** A player's presence in a room; 'offline' is also the will. */
export type PresenceMsg = 'online' | 'offline';

export interface ClosedMsg {
  /** Name of the player who ended the game. */
  by: string;
}

export interface ActionMsg {
  epoch: number;
  turn: number;
  /** The move; null withdraws the move made earlier this turn. */
  choice: Choice | null;
}

export interface HandMsg {
  epoch: number;
  turn: number;
  hand: string[];
  /** The choice the host has accepted for this turn, if any. */
  chosen?: Choice;
  error?: string;
}

/** Everything about the game every player may see. */
export interface PublicState extends Omit<GameState, 'players' | 'pending' | 'rng'> {
  players: (Omit<PlayerState, 'hand'> & { handSize: number })[];
  /** Ids of players who have chosen this turn. */
  chosen: string[];
}

export interface HostSnapshot {
  lobby: LobbyMsg;
  game?: GameState;
}

export function publicView(state: GameState): PublicState {
  const { players, pending, rng: _rng, ...rest } = state;
  return {
    ...rest,
    players: players.map(({ hand, ...p }) => ({ ...p, handSize: hand.length })),
    chosen: Object.keys(pending),
  };
}

/**
 * Rebuilds an engine state from the public view and one player's hand, so
 * the client can compute payment options locally. Other hands are empty.
 */
export function playerView(pub: PublicState, pid: string, hand: string[]): GameState {
  const { players, chosen: _chosen, ...rest } = pub;
  return {
    ...rest,
    rng: 0,
    pending: {},
    players: players.map(({ handSize: _h, ...p }) => ({ ...p, hand: p.id === pid ? hand.slice() : [] })),
  };
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(): string {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) s += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return s;
}

export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Room code as typed: letters, digits, '-' and '_' only (nothing that would
 * break a topic, such as '/', '+' or '#'), upper-cased.
 */
export function normalizeRoom(code: string): string {
  return code.toUpperCase().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32);
}

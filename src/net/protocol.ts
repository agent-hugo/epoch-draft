import type { Choice, GameState, PlayerState } from '../engine/types';

export const TOPIC_ROOT = 'epoch-draft';

export const topics = {
  room: (room: string) => `${TOPIC_ROOT}/${room}`,
  lobby: (room: string) => `${TOPIC_ROOT}/${room}/lobby`,
  join: (room: string, pid: string) => `${TOPIC_ROOT}/${room}/join/${pid}`,
  joinAll: (room: string) => `${TOPIC_ROOT}/${room}/join/+`,
  publicState: (room: string) => `${TOPIC_ROOT}/${room}/public`,
  hand: (room: string, pid: string) => `${TOPIC_ROOT}/${room}/hand/${pid}`,
  action: (room: string, pid: string) => `${TOPIC_ROOT}/${room}/action/${pid}`,
  actionAll: (room: string) => `${TOPIC_ROOT}/${room}/action/+`,
  presence: (room: string, pid: string) => `${TOPIC_ROOT}/${room}/presence/${pid}`,
  presenceAll: (room: string) => `${TOPIC_ROOT}/${room}/presence/+`,
  /** Full host state, so the host can resume after a reload. */
  hostState: (room: string) => `${TOPIC_ROOT}/${room}/host`,
};

/** Last topic level, e.g. the player id of `.../action/<pid>`. */
export function lastLevel(topic: string): string {
  return topic.slice(topic.lastIndexOf('/') + 1);
}

export interface LobbyPlayer {
  id: string;
  name: string;
  bot?: boolean;
}

export interface LobbyMsg {
  host: string;
  players: LobbyPlayer[];
  started: boolean;
}

export interface JoinMsg {
  name: string;
}

export interface ActionMsg {
  epoch: number;
  turn: number;
  choice: Choice;
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

export function normalizeRoom(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

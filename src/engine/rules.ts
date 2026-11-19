import { Db, HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS, TURNS_PER_EPOCH } from './db';
import { checkPayment, leftOf, paymentOptions, rightOf } from './payment';
import type { PaymentOption } from './payment';
import { Rng } from './rng';
import { count, military } from './scoring';
import type { Choice, Cost, Epoch, GameState, LogEntry, PlayerState, Trade } from './types';

export const START_COINS = 3;
export const SELL_COINS = 3;
export const VICTORY_POINTS: Record<Epoch, number> = { 1: 1, 2: 3, 3: 5 };
export const DEFEAT_POINTS = -1;

export interface PlayerSetup {
  id: string;
  name: string;
  civ?: string;
}

export interface GameSetup {
  seed: number;
  players: PlayerSetup[];
}

export class RuleError extends Error {}

export function createGame(db: Db, setup: GameSetup): GameState {
  const n = setup.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new RuleError(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  if (new Set(setup.players.map((p) => p.id)).size !== n) throw new RuleError('duplicate player ids');
  const rng = new Rng(setup.seed);

  const taken = new Set(setup.players.map((p) => p.civ).filter((c): c is string => !!c));
  if (taken.size !== setup.players.filter((p) => p.civ).length) throw new RuleError('duplicate civilizations');
  for (const c of taken) db.civ(c);
  const free = rng.shuffle([...db.civs.keys()].filter((c) => !taken.has(c)));

  const players: PlayerState[] = setup.players.map((p) => ({
    id: p.id,
    name: p.name,
    civ: p.civ ?? free.pop()!,
    coins: START_COINS,
    city: [],
    stages: 0,
    conflicts: [],
    hand: [],
  }));

  const state: GameState = {
    version: 1,
    ...(db.data.id ? { world: db.data.id } : {}),
    rng: 0,
    epoch: 1,
    turn: 1,
    phase: 'play',
    players,
    discard: [],
    pending: {},
    log: [],
  };
  deal(db, state, rng);
  state.rng = rng.state;
  return state;
}

function deal(db: Db, state: GameState, rng: Rng): void {
  const n = state.players.length;
  let deck = db.epochCards(state.epoch, n);
  if (state.epoch === 3) deck = deck.concat(rng.shuffle(db.dynasties()).slice(0, n + 2));
  deck = rng.shuffle(deck);
  state.players.forEach((p, i) => {
    p.hand = deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
  });
}

export function playerIndex(state: GameState, playerId: string): number {
  const i = state.players.findIndex((p) => p.id === playerId);
  if (i < 0) throw new RuleError(`unknown player ${playerId}`);
  return i;
}

/** Can player `i` build card `cardId` for free thanks to a chain? */
export function isChainFree(db: Db, p: PlayerState, cardId: string): boolean {
  const from = db.chainedFrom.get(cardId);
  return !!from && from.some((id) => p.city.includes(id));
}

export function nextStageCost(db: Db, p: PlayerState): Cost | undefined {
  return db.civ(p.civ).monument.stages[p.stages]?.cost;
}

/** Validates a choice; returns an error message or undefined. */
export function validateChoice(db: Db, state: GameState, i: number, choice: Choice): string | undefined {
  if (state.phase !== 'play') return 'game is over';
  const p = state.players[i]!;
  if (!p.hand.includes(choice.card)) return 'card is not in hand';
  if (choice.action === 'sell') return undefined;
  if (choice.action === 'build') {
    if (p.city.includes(choice.card)) return 'this card is already built';
    if (isChainFree(db, p, choice.card)) {
      return isTradeEmpty(choice.trade) ? undefined : 'chain build needs no trade';
    }
    const r = checkPayment(db, state, i, db.card(choice.card).cost, choice.trade);
    return 'error' in r ? r.error : undefined;
  }
  if (choice.action === 'stage') {
    const cost = nextStageCost(db, p);
    if (!cost) return 'monument is complete';
    const r = checkPayment(db, state, i, cost, choice.trade);
    return 'error' in r ? r.error : undefined;
  }
  return 'unknown action';
}

function isTradeEmpty(t: Trade): boolean {
  return Object.values(t.left).every((v) => !v) && Object.values(t.right).every((v) => !v);
}

export interface CardOptions {
  card: string;
  /** Payment options for building; empty when it cannot be built. */
  build: PaymentOption[];
  /** True when the card would be built for free via a chain. */
  chain: boolean;
  /** Payment options for using the card as the next monument stage. */
  stage: PaymentOption[];
}

/** What player `i` can do with each card in hand (selling is always possible). */
export function handOptions(db: Db, state: GameState, i: number): CardOptions[] {
  const p = state.players[i]!;
  const stageCost = nextStageCost(db, p);
  const stage = stageCost ? paymentOptions(db, state, i, stageCost) : [];
  const seen = new Set<string>();
  const out: CardOptions[] = [];
  for (const card of p.hand) {
    if (seen.has(card)) continue;
    seen.add(card);
    const built = p.city.includes(card);
    const chain = !built && isChainFree(db, p, card);
    const build = built
      ? []
      : chain
        ? [{ trade: { left: {}, right: {} }, left: 0, right: 0, total: 0 }]
        : paymentOptions(db, state, i, db.card(card).cost);
    out.push({ card, build, chain, stage });
  }
  return out;
}

/**
 * Records a player's choice for the current turn (it may be changed until
 * everybody has chosen). When the last player chooses, the turn resolves.
 */
export function choose(db: Db, state: GameState, playerId: string, choice: Choice): GameState {
  const i = playerIndex(state, playerId);
  const err = validateChoice(db, state, i, choice);
  if (err) throw new RuleError(err);
  const next = structuredClone(state);
  next.pending[playerId] = choice;
  if (next.players.every((p) => next.pending[p.id])) resolveTurn(db, next);
  return next;
}

/** Withdraws a player's choice for the current turn, while the turn is still open. */
export function unchoose(state: GameState, playerId: string): GameState {
  playerIndex(state, playerId);
  if (state.phase !== 'play' || !state.pending[playerId]) return state;
  const next = structuredClone(state);
  delete next.pending[playerId];
  return next;
}

export function waitingFor(state: GameState): string[] {
  if (state.phase !== 'play') return [];
  return state.players.filter((p) => !state.pending[p.id]).map((p) => p.id);
}

function resolveTurn(db: Db, state: GameState): void {
  const n = state.players.length;
  const delta = new Array<number>(n).fill(0);
  const newlyBuilt: { i: number; effects: ReturnType<typeof stageOrCardEffects> }[] = [];

  // Payments are checked against start-of-turn coins; income arrives after.
  state.players.forEach((p, i) => {
    const choice = state.pending[p.id]!;
    p.hand.splice(p.hand.indexOf(choice.card), 1);
    let paid = 0;
    let toLeft = 0;
    let toRight = 0;
    if (choice.action === 'sell') {
      delta[i]! += SELL_COINS;
      state.discard.push(choice.card);
    } else {
      const free = choice.action === 'build' && isChainFree(db, p, choice.card);
      if (!free) {
        const cost = choice.action === 'build' ? db.card(choice.card).cost : nextStageCost(db, p)!;
        const r = checkPayment(db, state, i, cost, choice.trade);
        if ('error' in r) throw new Error(`payment became invalid: ${r.error}`);
        paid = r.total;
        toLeft = r.left;
        toRight = r.right;
        delta[i]! -= r.total;
        delta[leftOf(n, i)]! += r.left;
        delta[rightOf(n, i)]! += r.right;
      }
      newlyBuilt.push({ i, effects: stageOrCardEffects(db, p, choice) });
    }
    const entry: LogEntry = { epoch: state.epoch, turn: state.turn, player: p.id, action: choice.action, card: choice.card, paid };
    if (toLeft) entry.left = toLeft;
    if (toRight) entry.right = toRight;
    if (choice.action === 'build' && isChainFree(db, p, choice.card)) entry.chain = true;
    state.log.push(entry);
  });

  for (const b of newlyBuilt) {
    const p = state.players[b.i]!;
    const choice = state.pending[p.id]!;
    if (choice.action === 'build') p.city.push(choice.card);
    else p.stages += 1;
  }
  // Immediate coin effects see every placement of this turn.
  for (const b of newlyBuilt) {
    for (const e of b.effects) {
      if (e.kind === 'coins') delta[b.i]! += e.n;
      else if (e.kind === 'coinsPer') delta[b.i]! += e.n * count(db, state, b.i, e.count);
    }
  }
  state.players.forEach((p, i) => (p.coins += delta[i]!));
  state.pending = {};

  if (state.turn < TURNS_PER_EPOCH) {
    passHands(state);
    state.turn += 1;
    return;
  }
  for (const p of state.players) state.discard.push(...p.hand.splice(0));
  resolveConflicts(db, state);
  if (state.epoch === 3) {
    state.phase = 'over';
    return;
  }
  state.epoch = (state.epoch + 1) as Epoch;
  state.turn = 1;
  const rng = new Rng(state.rng);
  deal(db, state, rng);
  state.rng = rng.state;
}

function stageOrCardEffects(db: Db, p: PlayerState, choice: Choice) {
  if (choice.action === 'build') return db.card(choice.card).effects;
  return db.civ(p.civ).monument.stages[p.stages]!.effects;
}

/** Epochs I and III pass to the left, epoch II to the right. */
function passHands(state: GameState): void {
  const n = state.players.length;
  const hands = state.players.map((p) => p.hand);
  state.players.forEach((_, i) => {
    const to = state.epoch === 2 ? rightOf(n, i) : leftOf(n, i);
    state.players[to]!.hand = hands[i]!;
  });
}

function resolveConflicts(db: Db, state: GameState): void {
  const n = state.players.length;
  const power = state.players.map((_, i) => military(db, state, i));
  state.players.forEach((p, i) => {
    for (const j of [leftOf(n, i), rightOf(n, i)]) {
      if (power[i]! > power[j]!) p.conflicts.push(VICTORY_POINTS[state.epoch]);
      else if (power[i]! < power[j]!) p.conflicts.push(DEFEAT_POINTS);
    }
  });
}

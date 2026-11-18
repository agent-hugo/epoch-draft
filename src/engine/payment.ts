import type { Db } from './db';
import type { Cost, Effect, GameState, PlayerState, Resource, ResourceMap, Side, Trade } from './types';
import { RESOURCES } from './types';

export const BASE_TRADE_PRICE = 2;

export function leftOf(n: number, i: number): number {
  return (i + n - 1) % n;
}
export function rightOf(n: number, i: number): number {
  return (i + 1) % n;
}
export function neighbour(state: GameState, i: number, side: Side): PlayerState {
  const n = state.players.length;
  return state.players[side === 'left' ? leftOf(n, i) : rightOf(n, i)]!;
}

/** All effects a player has: built cards and built monument stages. */
export function playerEffects(db: Db, p: PlayerState): { effect: Effect; source: 'card' | 'stage'; cardType?: string }[] {
  const out: { effect: Effect; source: 'card' | 'stage'; cardType?: string }[] = [];
  for (const id of p.city) {
    const c = db.card(id);
    for (const effect of c.effects) out.push({ effect, source: 'card', cardType: c.type });
  }
  const stages = db.civ(p.civ).monument.stages.slice(0, p.stages);
  for (const s of stages) for (const effect of s.effects) out.push({ effect, source: 'stage' });
  return out;
}

export interface Production {
  fixed: ResourceMap;
  /** Each entry yields one unit of any listed resource per turn. */
  choices: Resource[][];
}

/**
 * Resources a player produces each turn. With tradableOnly, only what
 * neighbours may buy: the civilization's start resource and raw/goods cards.
 */
export function production(db: Db, p: PlayerState, tradableOnly = false): Production {
  const fixed: ResourceMap = { [db.civ(p.civ).start]: 1 };
  const choices: Resource[][] = [];
  for (const { effect, source, cardType } of playerEffects(db, p)) {
    const tradable = source === 'card' && (cardType === 'raw' || cardType === 'goods');
    if (tradableOnly && !tradable) continue;
    if (effect.kind === 'produce') addInto(fixed, effect.res);
    else if (effect.kind === 'produceChoice') choices.push(effect.options);
  }
  return { fixed, choices };
}

export function addInto(target: ResourceMap, add: ResourceMap): ResourceMap {
  for (const r of RESOURCES) {
    const v = add[r];
    if (v) target[r] = (target[r] ?? 0) + v;
  }
  return target;
}

function isEmpty(m: ResourceMap): boolean {
  return RESOURCES.every((r) => !m[r]);
}

/** Can the production supply all of `need` in one turn? */
export function canCover(prod: Production, need: ResourceMap): boolean {
  const rest: ResourceMap = {};
  for (const r of RESOURCES) {
    const left = (need[r] ?? 0) - (prod.fixed[r] ?? 0);
    if (left > 0) rest[r] = left;
  }
  if (isEmpty(rest)) return true;
  const missing = RESOURCES.reduce((s, r) => s + (rest[r] ?? 0), 0);
  if (missing > prod.choices.length) return false;
  return assign(prod.choices, 0, rest, missing);
}

function assign(choices: Resource[][], from: number, rest: ResourceMap, missing: number): boolean {
  if (missing === 0) return true;
  if (choices.length - from < missing) return false;
  const opts = choices[from]!;
  for (const r of opts) {
    if ((rest[r] ?? 0) > 0) {
      rest[r]! -= 1;
      const ok = assign(choices, from + 1, rest, missing - 1);
      rest[r]! += 1;
      if (ok) return true;
    }
  }
  // Leave this choice unused.
  return assign(choices, from + 1, rest, missing);
}

/** Price of one unit of `res` bought from the neighbour on `side`. */
export function tradePrice(db: Db, p: PlayerState, side: Side, res: Resource): number {
  let price = BASE_TRADE_PRICE;
  for (const { effect } of playerEffects(db, p)) {
    if (effect.kind === 'tradeDiscount' && effect.sides.includes(side) && effect.resources.includes(res)) {
      price = Math.min(price, effect.price);
    }
  }
  return price;
}

export function tradeCost(db: Db, p: PlayerState, side: Side, bought: ResourceMap): number {
  let sum = 0;
  for (const r of RESOURCES) sum += (bought[r] ?? 0) * tradePrice(db, p, side, r);
  return sum;
}

export interface PaymentOption {
  trade: Trade;
  left: number;
  right: number;
  /** Coins in total: card cost plus trade. */
  total: number;
}

export const EMPTY_TRADE: Trade = Object.freeze({ left: {}, right: {} }) as Trade;

/**
 * Cheapest ways for player `i` to pay `cost` this turn. Only Pareto-optimal
 * options on (left coins, right coins) are returned, sorted by total.
 * Empty when the cost cannot be paid.
 */
export function paymentOptions(db: Db, state: GameState, i: number, cost: Cost): PaymentOption[] {
  const p = state.players[i]!;
  const baseCoins = cost.coins ?? 0;
  if (baseCoins > p.coins) return [];
  const need = cost.res ?? {};
  const own = production(db, p);
  if (canCover(own, need)) return [{ trade: { left: {}, right: {} }, left: 0, right: 0, total: baseCoins }];

  const leftProd = production(db, neighbour(state, i, 'left'), true);
  const rightProd = production(db, neighbour(state, i, 'right'), true);
  const needed = RESOURCES.filter((r) => (need[r] ?? 0) > 0);
  const found: PaymentOption[] = [];

  const walk = (k: number, left: ResourceMap, right: ResourceMap) => {
    if (k === needed.length) {
      const selfNeed: ResourceMap = {};
      for (const r of needed) selfNeed[r] = need[r]! - (left[r] ?? 0) - (right[r] ?? 0);
      if (!canCover(own, selfNeed)) return;
      if (!canCover(leftProd, left) || !canCover(rightProd, right)) return;
      const l = tradeCost(db, p, 'left', left);
      const rr = tradeCost(db, p, 'right', right);
      if (baseCoins + l + rr > p.coins) return;
      found.push({ trade: { left: { ...left }, right: { ...right } }, left: l, right: rr, total: baseCoins + l + rr });
      return;
    }
    const r = needed[k]!;
    const n = need[r]!;
    for (let a = 0; a <= n; a++) {
      for (let b = 0; a + b <= n; b++) {
        const l2 = { ...left };
        const r2 = { ...right };
        if (a) l2[r] = a;
        if (b) r2[r] = b;
        walk(k + 1, l2, r2);
      }
    }
  };
  walk(0, {}, {});

  const pareto = found.filter(
    (o) => !found.some((q) => q !== o && q.left <= o.left && q.right <= o.right && (q.left < o.left || q.right < o.right)),
  );
  const seen = new Set<string>();
  const unique = pareto.filter((o) => {
    const key = `${o.left}/${o.right}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => a.total - b.total || a.left - b.left);
}

/** Checks that `trade` lets player `i` pay `cost`; returns coins owed to each side or an error. */
export function checkPayment(
  db: Db,
  state: GameState,
  i: number,
  cost: Cost,
  trade: Trade,
): { left: number; right: number; total: number } | { error: string } {
  const p = state.players[i]!;
  const need = cost.res ?? {};
  const selfNeed: ResourceMap = {};
  for (const r of RESOURCES) {
    const l = trade.left[r] ?? 0;
    const rr = trade.right[r] ?? 0;
    if (l < 0 || rr < 0 || !Number.isInteger(l) || !Number.isInteger(rr)) return { error: 'bad trade amount' };
    const rest = (need[r] ?? 0) - l - rr;
    if (rest < 0) return { error: `buying more ${r} than needed` };
    if (rest > 0) selfNeed[r] = rest;
  }
  if (!canCover(production(db, p), selfNeed)) return { error: 'not enough own resources' };
  if (!canCover(production(db, neighbour(state, i, 'left'), true), trade.left)) {
    return { error: 'left neighbour does not produce that' };
  }
  if (!canCover(production(db, neighbour(state, i, 'right'), true), trade.right)) {
    return { error: 'right neighbour does not produce that' };
  }
  const left = tradeCost(db, p, 'left', trade.left);
  const right = tradeCost(db, p, 'right', trade.right);
  const total = (cost.coins ?? 0) + left + right;
  if (total > p.coins) return { error: 'not enough coins' };
  return { left, right, total };
}

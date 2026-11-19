import type { Db } from './db';
import { leftOf, production, rightOf } from './payment';
import { handOptions } from './rules';
import { Rng } from './rng';
import { count, military, scorePlayer } from './scoring';
import type { Choice, GameState } from './types';

export type Bot = (db: Db, state: GameState, i: number) => Choice;

/** Every legal choice for player `i`, using the cheapest payment for each. */
export function legalChoices(db: Db, state: GameState, i: number): Choice[] {
  const out: Choice[] = [];
  for (const o of handOptions(db, state, i)) {
    out.push({ action: 'sell', card: o.card });
    if (o.build[0]) out.push({ action: 'build', card: o.card, trade: o.build[0].trade });
    if (o.stage[0]) out.push({ action: 'stage', card: o.card, trade: o.stage[0].trade });
  }
  return out;
}

export function randomBot(seed: number): Bot {
  const rng = new Rng(seed);
  return (db, state, i) => {
    const all = legalChoices(db, state, i);
    const builds = all.filter((c) => c.action !== 'sell');
    const pool = builds.length && rng.next() < 0.85 ? builds : all;
    return pool[rng.int(pool.length)]!;
  };
}

export interface GreedyWeights {
  /** Value of one unit of new production per remaining epoch. */
  production: number;
  /** Multiplier for military points expected from beating a neighbour. */
  military: number;
  /** Value of one science symbol per remaining epoch (future sets). */
  science: number;
  /** Value of a trade discount (per resource type and side) per remaining epoch. */
  discount: number;
  /** Random noise added to each evaluation, to vary play. */
  noise: number;
}

export const DEFAULT_WEIGHTS: GreedyWeights = { production: 1.2, military: 0.8, science: 1.5, discount: 0.25, noise: 0.5 };

/**
 * One-ply greedy bot: applies each choice to a copy of its own city and
 * compares end-game score, plus heuristics for production and military.
 */
export function greedyBot(seed: number, w: GreedyWeights = DEFAULT_WEIGHTS): Bot {
  const rng = new Rng(seed);
  return (db, state, i) => {
    const base = evaluate(db, state, i, w);
    let best: Choice | undefined;
    let bestValue = -Infinity;
    const options = handOptions(db, state, i);
    for (const choice of legalChoices(db, state, i)) {
      const sim = structuredClone(state);
      const p = sim.players[i]!;
      p.hand.splice(p.hand.indexOf(choice.card), 1);
      if (choice.action === 'sell') p.coins += 3;
      else {
        const opts = options.find((o) => o.card === choice.card)!;
        const pay = choice.action === 'build' ? opts.build[0]! : opts.stage[0]!;
        p.coins -= pay.total;
        const effects =
          choice.action === 'build' ? db.card(choice.card).effects : db.civ(p.civ).monument.stages[p.stages]!.effects;
        if (choice.action === 'build') p.city.push(choice.card);
        else p.stages += 1;
        for (const e of effects) {
          if (e.kind === 'coins') p.coins += e.n;
          else if (e.kind === 'coinsPer') p.coins += e.n * count(db, sim, i, e.count);
        }
      }
      const value = evaluate(db, sim, i, w) - base + rng.next() * w.noise;
      if (value > bestValue) {
        bestValue = value;
        best = choice;
      }
    }
    return best!;
  };
}

function evaluate(db: Db, state: GameState, i: number, w: GreedyWeights): number {
  const p = state.players[i]!;
  const score = scorePlayer(db, state, i);
  const remaining = 3 - state.epoch + (6 - state.turn) / 6;
  const prod = production(db, p);
  const units = Object.values(prod.fixed).reduce<number>((s, v) => s + (v ?? 0), 0) + prod.choices.length;
  const n = state.players.length;
  const mine = military(db, state, i);
  const epochsLeft = 4 - state.epoch;
  let mil = 0;
  for (const j of [leftOf(n, i), rightOf(n, i)]) {
    const theirs = military(db, state, j);
    if (mine > theirs) mil += 2 * epochsLeft;
    else if (mine < theirs) mil -= 0.5 * epochsLeft;
  }
  let symbols = 0;
  let discounts = 0;
  for (const id of p.city) {
    for (const e of db.card(id).effects) {
      if (e.kind === 'science') symbols++;
      else if (e.kind === 'tradeDiscount') discounts += e.resources.length * e.sides.length;
    }
  }
  return score.total + w.science * symbols * remaining + w.discount * discounts * remaining + w.production * units * remaining + w.military * mil + p.coins / 6;
}

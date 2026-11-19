import type { Db } from './db';
import { leftOf, playerEffects, rightOf } from './payment';
import type { Counter, GameState, ScoreBreakdown, School } from './types';

export const SCIENCE_SET_BONUS = 7;
export const COINS_PER_POINT = 3;

export function military(db: Db, state: GameState, i: number): number {
  let sum = 0;
  for (const { effect } of playerEffects(db, state.players[i]!)) if (effect.kind === 'military') sum += effect.n;
  return sum;
}

/** Evaluates a counter (e.g. "raw cards of both neighbours") for player `i`. */
export function count(db: Db, state: GameState, i: number, counter: Counter): number {
  const n = state.players.length;
  let sum = 0;
  for (const who of counter.who) {
    const idx = who === 'self' ? i : who === 'left' ? leftOf(n, i) : rightOf(n, i);
    const p = state.players[idx]!;
    for (const what of counter.what) {
      if (what === 'stage') sum += p.stages;
      else if (what === 'defeat') sum += p.conflicts.filter((c) => c < 0).length;
      else sum += p.city.filter((id) => db.card(id).type === what).length;
    }
  }
  return sum;
}

function triangle(k: number): number {
  return (k * (k + 1)) / 2;
}

/** Science points; `counts` has an entry for every school of the world. */
export function scienceScore(counts: Record<School, number>, wild: number): number {
  const schools = Object.keys(counts);
  const base = (c: Record<School, number>) =>
    schools.reduce((s, k) => s + triangle(c[k]!), 0) + SCIENCE_SET_BONUS * Math.min(...schools.map((k) => c[k]!));
  if (wild === 0) return base(counts);
  let best = 0;
  for (const k of schools) {
    best = Math.max(best, scienceScore({ ...counts, [k]: counts[k]! + 1 }, wild - 1));
  }
  return best;
}

export function scorePlayer(db: Db, state: GameState, i: number): ScoreBreakdown {
  const p = state.players[i]!;
  const s: ScoreBreakdown = { military: 0, coins: 0, monument: 0, culture: 0, trade: 0, dynasty: 0, science: 0, total: 0 };
  s.military = p.conflicts.reduce((a, b) => a + b, 0);
  s.coins = Math.floor(p.coins / COINS_PER_POINT);

  const sci: Record<School, number> = Object.fromEntries(db.data.schools.map((k) => [k.id, 0]));
  let wild = 0;
  for (const { effect, source, cardType } of playerEffects(db, p)) {
    let pts = 0;
    if (effect.kind === 'points') pts = effect.n;
    else if (effect.kind === 'pointsPer') pts = effect.n * count(db, state, i, effect.count);
    else if (effect.kind === 'science') {
      if (effect.school === 'any') wild++;
      else sci[effect.school] = (sci[effect.school] ?? 0) + 1;
    }
    if (!pts) continue;
    if (source === 'stage') s.monument += pts;
    else if (cardType === 'trade') s.trade += pts;
    else if (cardType === 'dynasty') s.dynasty += pts;
    else s.culture += pts;
  }
  s.science = scienceScore(sci, wild);
  s.total = s.military + s.coins + s.monument + s.culture + s.trade + s.dynasty + s.science;
  return s;
}

export function scoreGame(db: Db, state: GameState): ScoreBreakdown[] {
  return state.players.map((_, i) => scorePlayer(db, state, i));
}

/** Player indices ordered by total score, ties broken by coins. */
export function ranking(db: Db, state: GameState): number[] {
  const scores = scoreGame(db, state);
  return state.players
    .map((_, i) => i)
    .sort((a, b) => scores[b]!.total - scores[a]!.total || state.players[b]!.coins - state.players[a]!.coins);
}

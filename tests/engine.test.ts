import { describe, expect, it } from 'vitest';
import { problems, worldDb, worlds } from '../src/worlds';
import { greedyBot, randomBot, type Bot } from '../src/engine/bots';
import {
  canCover,
  checkPayment,
  choose,
  createGame,
  handOptions,
  paymentOptions,
  RuleError,
  scienceScore,
  scoreGame,
  unchoose,
  waitingFor,
  type GameState,
} from '../src/engine';

const db = worldDb('ancient');

function setup(n: number, seed = 1, civs?: string[]): GameState {
  return createGame(db, {
    seed,
    players: Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `P${k}`, civ: civs?.[k] })),
  });
}

function playOut(state: GameState, bots: Bot[]): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'play') {
    for (const id of waitingFor(s)) {
      const i = s.players.findIndex((p) => p.id === id);
      s = choose(db, s, id, bots[i]!(db, s, i));
    }
    if (++guard > 100) throw new Error('game did not finish');
  }
  return s;
}

describe('worlds', () => {
  it('are all valid for 3-5 players and have their images', () => {
    expect(worlds.length).toBeGreaterThan(0);
    for (const w of worlds) expect({ world: w.id, problems: problems[w.id] }).toEqual({ world: w.id, problems: [] });
  });

  it('stores the world in the game state', () => {
    expect(setup(3).world).toBe('ancient');
  });
});

describe('production and payment', () => {
  it('covers needs with choice producers', () => {
    expect(canCover({ fixed: { wood: 1 }, choices: [['wood', 'clay'], ['stone', 'ore']] }, { wood: 2, ore: 1 })).toBe(true);
    expect(canCover({ fixed: {}, choices: [['wood', 'clay']] }, { wood: 1, clay: 1 })).toBe(false);
    expect(canCover({ fixed: {}, choices: [['wood', 'clay'], ['clay']] }, { wood: 1, clay: 1 })).toBe(true);
  });

  it('buys missing resources from neighbours, using discounts', () => {
    const s = setup(3, 1, ['egypt', 'mesopotamia', 'china']); // starts: stone, clay, ore
    // p0 (egypt) needs ore: left neighbour is p2 (china, ore), right is p1 (clay).
    const opts = paymentOptions(db, s, 0, { res: { ore: 1 } });
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ left: 2, right: 0, total: 2 });

    s.players[0]!.city.push('1-gate-market');
    expect(paymentOptions(db, s, 0, { res: { ore: 1 } })[0]).toMatchObject({ left: 1, total: 1 });

    s.players[0]!.coins = 0;
    s.players[0]!.city = [];
    expect(paymentOptions(db, s, 0, { res: { ore: 1 } })).toEqual([]);
  });

  it('does not let neighbours sell non-tradable production', () => {
    const s = setup(3, 1, ['egypt', 'mesopotamia', 'china']);
    s.players[1]!.city.push('2-warehouse'); // trade card: any raw, not for sale
    expect(checkPayment(db, s, 0, { res: { wood: 1 } }, { left: {}, right: { wood: 1 } })).toEqual({
      error: 'right neighbour does not produce that',
    });
  });
});

describe('turns', () => {
  it('waits for everybody, then passes hands', () => {
    let s = setup(3);
    const hands = s.players.map((p) => p.hand.slice());
    s = choose(db, s, 'p0', { action: 'sell', card: hands[0]![0]! });
    expect(waitingFor(s)).toEqual(['p1', 'p2']);
    s = choose(db, s, 'p1', { action: 'sell', card: hands[1]![0]! });
    s = choose(db, s, 'p2', { action: 'sell', card: hands[2]![0]! });
    expect(s.turn).toBe(2);
    expect(s.players.every((p) => p.coins === 6)).toBe(true);
    // Epoch I passes left: p0's hand goes to p2 (left of 0).
    expect(s.players[2]!.hand).toEqual(hands[0]!.slice(1));
  });

  it('lets a choice be withdrawn until the turn resolves', () => {
    let s = setup(3);
    s = choose(db, s, 'p0', { action: 'sell', card: s.players[0]!.hand[0]! });
    s = unchoose(s, 'p0');
    expect(waitingFor(s)).toEqual(['p0', 'p1', 'p2']);
    expect(unchoose(s, 'p0')).toBe(s);
    s = choose(db, s, 'p1', { action: 'sell', card: s.players[1]!.hand[0]! });
    s = choose(db, s, 'p2', { action: 'sell', card: s.players[2]!.hand[0]! });
    expect(s.turn).toBe(1);
  });

  it('rejects illegal choices', () => {
    const s = setup(3);
    expect(() => choose(db, s, 'p0', { action: 'sell', card: 'nope' })).toThrow(RuleError);
  });

  it('builds chained cards for free', () => {
    const s = setup(3);
    const p = s.players[0]!;
    p.city.push('1-shrine');
    p.hand[0] = '2-temple';
    p.coins = 0;
    const opt = handOptions(db, s, 0).find((o) => o.card === '2-temple')!;
    expect(opt.chain).toBe(true);
    expect(opt.build[0]!.total).toBe(0);

    let t = choose(db, s, 'p0', { action: 'build', card: '2-temple', trade: opt.build[0]!.trade });
    for (const q of t.players.slice(1)) t = choose(db, t, q.id, { action: 'sell', card: q.hand[0]! });
    const entry = t.log.find((e) => e.player === 'p0')!;
    expect(entry).toMatchObject({ action: 'build', card: '2-temple', paid: 0, chain: true });
    expect(t.log.filter((e) => e.chain)).toHaveLength(1);
  });
});

describe('scoring', () => {
  it('scores science with sets and wild symbols', () => {
    expect(scienceScore({ astronomy: 1, medicine: 1, writing: 1 }, 0)).toBe(3 + 7);
    expect(scienceScore({ astronomy: 3, medicine: 0, writing: 0 }, 0)).toBe(6);
    expect(scienceScore({ astronomy: 2, medicine: 2, writing: 1 }, 1)).toBe(3 + 3 + 3 + 14);
  });
});

describe('full games', () => {
  for (const n of [3, 4, 5]) {
    it(`finishes with ${n} random players`, () => {
      const bots = Array.from({ length: n }, (_, k) => randomBot(100 + k));
      const end = playOut(setup(n, 7), bots);
      expect(end.phase).toBe('over');
      expect(end.log).toHaveLength(18 * n);
      expect(end.players.every((p) => p.hand.length === 0)).toBe(true);
      expect(end.players.every((p) => p.conflicts.length <= 6)).toBe(true);
      // Every card ends up in a city, under a monument or in the discard.
      const used = end.players.reduce((s, p) => s + p.city.length + p.stages, 0);
      expect(used + end.discard.length).toBe(21 * n);
    });
  }

  it('is deterministic for the same seed', () => {
    const run = () => playOut(setup(4, 42), [0, 1, 2, 3].map((k) => greedyBot(k)));
    const a = run();
    const b = run();
    expect(scoreGame(db, a)).toEqual(scoreGame(db, b));
    expect(a.log).toEqual(b.log);
  });

  it('greedy bots beat random bots', () => {
    let greedyWins = 0;
    for (let g = 0; g < 10; g++) {
      const bots = [greedyBot(g), randomBot(g), randomBot(g + 50)];
      const end = playOut(setup(3, g), bots);
      const scores = scoreGame(db, end).map((s) => s.total);
      if (scores[0]! >= Math.max(...scores)) greedyWins++;
    }
    expect(greedyWins).toBeGreaterThanOrEqual(7);
  });
});

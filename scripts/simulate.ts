/**
 * Plays many bot games and prints balance statistics.
 * Usage: [WORLD=<id>] npm run sim -- [games per player count, default 300]
 */
import { greedyBot } from '../src/engine/bots';
import { choose, createGame, ranking, scoreGame, waitingFor } from '../src/engine';
import type { GameState, ScoreBreakdown } from '../src/engine';
import { loadDb } from '../src/worlds/node';

const db = loadDb(process.env.WORLD);
const games = Number(process.argv[2] ?? 300);

type Cat = keyof ScoreBreakdown;
const CATS: Cat[] = ['military', 'coins', 'monument', 'culture', 'trade', 'dynasty', 'science', 'total'];

const civStats = new Map<string, { games: number; wins: number; points: number }>();
const catSum = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;
const cardStats = new Map<string, { offered: number; built: number }>();
let playerGames = 0;
const winnerCats = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;

for (let n = 3; n <= 5; n++) {
  for (let g = 0; g < games; g++) {
    const seed = n * 100000 + g;
    let s: GameState = createGame(db, {
      seed,
      players: Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `P${k}` })),
    });
    const bots = s.players.map((_, k) => greedyBot(seed * 10 + k));
    for (const p of s.players) for (const c of p.hand) bump(c, 'offered');
    let epoch = s.epoch;
    while (s.phase === 'play') {
      for (const id of waitingFor(s)) {
        const i = s.players.findIndex((p) => p.id === id);
        s = choose(db, s, id, bots[i]!(db, s, i));
      }
      if (s.phase === 'play' && s.epoch !== epoch) {
        epoch = s.epoch;
        for (const p of s.players) for (const c of p.hand) bump(c, 'offered');
      }
    }
    for (const e of s.log) if (e.action === 'build') bump(e.card, 'built');
    const scores = scoreGame(db, s);
    const winner = ranking(db, s)[0]!;
    s.players.forEach((p, i) => {
      const st = civStats.get(p.civ) ?? { games: 0, wins: 0, points: 0 };
      st.games++;
      st.points += scores[i]!.total;
      if (i === winner) st.wins++;
      civStats.set(p.civ, st);
      for (const c of CATS) catSum[c] += scores[i]![c];
      playerGames++;
    });
    for (const c of CATS) winnerCats[c] += scores[winner]![c];
  }
}

function bump(card: string, key: 'offered' | 'built') {
  const st = cardStats.get(card) ?? { offered: 0, built: 0 };
  st[key]++;
  cardStats.set(card, st);
}

const totalGames = games * 3;
console.log(`\n${totalGames} games (${games} each for 3, 4, 5 players), greedy bots\n`);
console.log('Average points per player / per winner:');
for (const c of CATS) {
  console.log(`  ${c.padEnd(9)} ${(catSum[c] / playerGames).toFixed(1).padStart(6)} ${(winnerCats[c] / totalGames).toFixed(1).padStart(6)}`);
}

console.log('\nCivilizations (win rate is relative to a fair share):');
const fair = (games * (1 / 3 + 1 / 4 + 1 / 5)) / 3;
for (const [civ, st] of [...civStats].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
  const name = db.civ(civ).name;
  const rate = st.wins / st.games;
  const fairRate = fair / games;
  console.log(
    `  ${name.padEnd(12)} games ${String(st.games).padStart(4)}  avg ${(st.points / st.games).toFixed(1).padStart(5)}  wins ${(rate * 100).toFixed(0).padStart(3)}% (×${(rate / fairRate).toFixed(2)})`,
  );
}

console.log('\nCards by build rate (built / dealt):');
const rows = [...cardStats].map(([id, st]) => ({ id, rate: st.built / st.offered }));
rows.sort((a, b) => b.rate - a.rate);
const show = (r: { id: string; rate: number }) =>
  `  ${(r.rate * 100).toFixed(0).padStart(3)}%  ${db.card(r.id).name} (${r.id})`;
console.log('  most built:');
rows.slice(0, 10).forEach((r) => console.log(show(r)));
console.log('  least built:');
rows.slice(-10).forEach((r) => console.log(show(r)));

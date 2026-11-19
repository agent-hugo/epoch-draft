/**
 * Plays a full game over a real MQTT broker: a host, two remote players
 * driven by bots through the network, and one host-side bot.
 * Usage: MQTT_URL=wss://... MQTT_TOKEN=... npm run net-smoke
 */
import { greedyBot } from '../src/engine/bots';
import { loadDb } from '../src/worlds/node';
import { Player } from '../src/net/client';
import { Host } from '../src/net/host';
import { Bus } from '../src/net/mqtt';
import { playerView, randomRoomCode, topics } from '../src/net/protocol';
import { scoreGame } from '../src/engine/scoring';

const url = process.env.MQTT_URL;
const token = process.env.MQTT_TOKEN;
if (!url || !token) {
  console.error('MQTT_URL and MQTT_TOKEN are required');
  process.exit(2);
}
const cfg = { url, token };
const db = loadDb();
const room = `TEST${randomRoomCode()}`;
console.log('room', room);

const buses: Bus[] = [];
function bus(pid: string) {
  const b = new Bus(cfg, { will: { topic: topics.presence(room, pid), payload: 'offline' } });
  buses.push(b);
  return b;
}

const hostBus = bus('alice');
await hostBus.ready();
const host = new Host(() => db, hostBus, room, 'alice');
await host.start();

const players = ['alice', 'bob', 'carol'].map((id) => {
  const p = new Player(id === 'alice' ? hostBus : bus(id), room, id, id.toUpperCase());
  p.start();
  return p;
});

// Remote players act as soon as their hand for the current turn arrives.
for (const p of players) {
  const bot = greedyBot(p.id.length * 7);
  let lastKey = '';
  p.subscribe((s) => {
    if (!s.pub || !s.hand || s.pub.phase !== 'play') return;
    if (s.hand.epoch !== s.pub.epoch || s.hand.turn !== s.pub.turn) return;
    if (s.hand.error) throw new Error(`${p.id}: ${s.hand.error}`);
    const key = `${s.pub.epoch}-${s.pub.turn}`;
    if (key === lastKey || s.hand.chosen) return;
    lastKey = key;
    const view = playerView(s.pub, p.id, s.hand.hand);
    const i = view.players.findIndex((x) => x.id === p.id);
    p.send(bot(db, view, i));
  });
}

await waitFor(() => host.lobby.players.length === 3, 'players joined');
host.addBot();
host.startGame();
const t0 = Date.now();
await waitFor(() => host.game?.phase === 'over', 'game over', 120_000);
const g = host.game!;
console.log(`game finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${g.log.length} moves`);
scoreGame(db, g).forEach((s, i) => console.log(`  ${g.players[i]!.name.padEnd(16)} ${s.total}`));
await waitFor(() => players.every((p) => p.snapshot.pub?.phase === 'over' && p.snapshot.lobby?.over), 'clients saw the end');
console.log('clients saw the final state');

// Clean up retained messages of the test room, unless KEEP=1 asks to leave it for inspection.
for (const t of process.env.KEEP ? [] : [
  topics.lobby(room),
  topics.publicState(room),
  topics.hostState(room),
  ...['alice', 'bob', 'carol'].flatMap((id) => [
    topics.hand(room, id),
    topics.action(room, id),
    topics.join(room, id),
    topics.presence(room, id),
  ]),
]) {
  await hostBus.publish(t, null, true);
}
await Promise.all(buses.map((b) => b.end()));
if (process.env.KEEP) console.log(`room ${room} kept on the broker`);
console.log('ok');
process.exit(0);

async function waitFor(cond: () => boolean, what: string, ms = 15_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

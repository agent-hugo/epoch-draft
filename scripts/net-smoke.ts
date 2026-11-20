/**
 * Plays a full game over a real MQTT broker: the leader's phone, two remote
 * players driven by bots through the network, and one engine-side bot. The
 * game moves from the leader's phone to a game server and back mid-game,
 * once right as a turn is being ended.
 * Usage: MQTT_URL=wss://... MQTT_TOKEN=... npm run net-smoke
 */
import { greedyBot } from '../src/engine/bots';
import { loadDb } from '../src/worlds/node';
import { deleteRoom, Player } from '../src/net/client';
import { Host } from '../src/net/host';
import { Bus } from '../src/net/mqtt';
import { playerView, randomRoomCode, topics } from '../src/net/protocol';
import { Server } from '../src/net/server';
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
const serverCode = `TESTS${randomRoomCode()}`;
console.log('room', room, 'server', serverCode);

const buses: Bus[] = [];
function bus(will: string) {
  const b = new Bus(cfg, { will: { topic: will, payload: 'offline' } });
  buses.push(b);
  return b;
}

// The game server, its own connection.
const serverBus = bus(topics.serverPresence(serverCode));
await serverBus.ready();
const server = new Server(() => db, serverBus, serverCode);
await server.start();

const aliceBus = bus(topics.presence('alice', room));
await aliceBus.ready();
const players = ['alice', 'bob', 'carol'].map((id) => {
  const p = new Player(id === 'alice' ? aliceBus : bus(topics.presence(id, room)), room, id, id.toUpperCase());
  p.start();
  return p;
});
const alice = players[0]!;

// The leader's phone runs the game while the room's engine says so, as the app does.
let phone: Host | undefined;
let phoneRuns = 0;
alice.subscribe((s) => {
  const here = s.engine?.id === 'alice';
  if (here && (!phone || phone.stopped)) {
    phone = new Host(() => db, aliceBus, room, 'alice', 'alice');
    phoneRuns++;
    void phone.start();
  } else if (!here && phone && !phone.stopped) phone.retire();
});
await alice.claim();
check(alice.isOwner && alice.snapshot.engine?.id === 'alice', 'a new room runs on the leader phone');

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

await waitFor(() => alice.snapshot.lobby?.players.length === 3, 'players joined');
alice.command({ op: 'addBot' });
await waitFor(() => alice.snapshot.lobby?.players.length === 4, 'bot added');
alice.command({ op: 'start' });

// The leader ends every turn once everybody has chosen, and moves the game
// between engines on the way.
const moves: string[] = [];
let ended = '';
const ender = setInterval(() => {
  const pub = alice.snapshot.pub;
  if (!pub || pub.phase !== 'play' || !pub.players.every((p) => pub.chosen.includes(p.id))) return;
  const key = `${pub.epoch}-${pub.turn}`;
  if (key === ended) return;
  ended = key;
  alice.command({ op: 'endTurn' });
  if (key === '1-3') {
    // Right after the end of the turn, before the phone has published it.
    void alice.setEngine(serverCode);
    moves.push('server');
  }
  if (key === '2-4') {
    void alice.setEngine('alice');
    moves.push('phone');
  }
}, 50);
const t0 = Date.now();
await waitFor(() => alice.snapshot.pub?.phase === 'over', 'game over', 120_000);
clearInterval(ender);
check(moves.join() === 'server,phone', `engine moves: ${moves}`);
check(phoneRuns === 2, `the phone ran the game ${phoneRuns} times`);
check(server.rooms.size === 0, 'the server let the room go');
const g = phone!.game!;
console.log(`game finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${g.log.length} moves`);
check(g.log.length === 4 * 18, `expected ${4 * 18} moves, got ${g.log.length}`);
scoreGame(db, g).forEach((s, i) => console.log(`  ${g.players[i]!.name.padEnd(16)} ${s.total}`));
await waitFor(() => players.every((p) => p.snapshot.pub?.phase === 'over' && p.snapshot.lobby?.over), 'clients saw the end');
console.log('clients saw the final state');

// Clean up the test room and the server, unless KEEP=1 asks to leave them for inspection.
if (!process.env.KEEP) {
  await deleteRoom(aliceBus, room, 'net-smoke');
  await aliceBus.publish(topics.closed(room), null, true);
  for (const id of ['alice', 'bob', 'carol']) await aliceBus.publish(topics.presence(id, room), null, true);
  await server.stop();
  await aliceBus.publish(topics.serverPresence(serverCode), null, true);
} else console.log(`room ${room} kept on the broker`);
await Promise.all(buses.map((b) => b.end()));
console.log('ok');
process.exit(0);

function check(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

async function waitFor(cond: () => boolean, what: string, ms = 15_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

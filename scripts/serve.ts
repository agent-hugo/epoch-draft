/**
 * A game server without a browser: runs the games leaders hand to its code,
 * like a page opened with `#serve`, for an always-on machine.
 * Usage: MQTT_TOKEN=... npm run serve -- CODE   (MQTT_URL defaults to wss://mqtt.flespi.io)
 */
import { Bus } from '../src/net/mqtt';
import { normalizeRoom, topics } from '../src/net/protocol';
import { Server } from '../src/net/server';
import type { Db } from '../src/engine/db';
import { loadDb, loadWorlds } from '../src/worlds/node';

const url = process.env.MQTT_URL || 'wss://mqtt.flespi.io';
const token = process.env.MQTT_TOKEN;
const code = normalizeRoom(process.argv[2] ?? process.env.SERVER_CODE ?? '');
if (!token || !code) {
  console.error('usage: MQTT_TOKEN=... npm run serve -- CODE');
  process.exit(2);
}

const ids = new Set(loadWorlds().map((w) => w.id));
const dbs = new Map<string, Db>();
const worldDb = (id?: string): Db => {
  const key = id && ids.has(id) ? id : '';
  let db = dbs.get(key);
  if (!db) dbs.set(key, (db = loadDb(key || undefined)));
  return db;
};

const bus = new Bus({ url, token }, { will: { topic: topics.serverPresence(code), payload: 'offline' } });
let stopping = false;
bus.onStatus((on) => stopping || log(on ? 'connected' : 'connection lost, reconnecting'));
await bus.ready();
const server = new Server(worldDb, bus, code);

// One line per room whenever what it shows changes.
const shown = new Map<string, string>();
server.subscribe(() => {
  for (const [room, host] of server.rooms) {
    const g = host.game;
    const line = `${g ? (g.phase === 'over' ? 'over' : `epoch ${g.epoch} turn ${g.turn}`) : 'lobby'} · ${host.lobby.players.map((p) => p.name).join(', ')}`;
    if (shown.get(room) !== line) log(`${room}: ${line}`);
    shown.set(room, line);
  }
  for (const room of shown.keys())
    if (!server.rooms.has(room)) {
      shown.delete(room);
      log(`${room}: released`);
    }
});
await server.start();
log(`server ${code} is running`);

const stop = async () => {
  stopping = true;
  log('stopping');
  await server.stop().catch(() => {});
  await bus.end();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function log(msg: string) {
  console.log(`${new Date().toISOString().slice(0, 19)} ${msg}`);
}

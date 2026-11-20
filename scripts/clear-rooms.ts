/**
 * Deletes rooms from the broker: clears every retained message under
 * `epoch-draft/room/<room>/`, including the `closed` marker, so nothing of the
 * room is left, and the presence of players in deleted rooms, as well as
 * every 'offline' presence (a missing one means the same). Meant for rooms left
 * over from tests.
 *
 * Usage:
 *   MQTT_URL=wss://... MQTT_TOKEN=... npm run clear-rooms -- [--apply] [ROOM...]
 *
 *   ROOM...   room codes to delete; without them every room is deleted
 *   --apply   actually delete; without it only lists the rooms
 */
import mqtt from 'mqtt';
import { PLAYERS_ROOT, ROOMS_ROOT, roomOf } from '../src/net/protocol';

const url = process.env.MQTT_URL;
const token = process.env.MQTT_TOKEN;
if (!url || !token) {
  console.error('MQTT_URL and MQTT_TOKEN are required');
  process.exit(2);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = new Set(args.filter((a) => a !== '--apply').map((a) => a.toUpperCase()));
const unknown = [...only].find((a) => a.startsWith('-'));
if (unknown) {
  console.error(`unknown argument ${unknown}`);
  process.exit(2);
}

const client = mqtt.connect(url, {
  username: token,
  password: '',
  protocolVersion: 5,
  clean: true,
  reconnectPeriod: 0,
  clientId: `ed-clear-${Math.random().toString(16).slice(2, 10)}`,
});
await new Promise<void>((resolve, reject) => {
  client.once('connect', () => resolve());
  client.once('error', reject);
});

// Retained messages arrive before the SUBACK.
const filter = `${ROOMS_ROOT}/#`;
const rooms = new Map<string, { topics: string[]; summary: string }>();
const onMessage = (topic: string, payload: Buffer, packet: mqtt.IPublishPacket) => {
  if (!packet.retain || !payload.length) return;
  const code = roomOf(topic);
  if (only.size && !only.has(code)) return;
  const room = rooms.get(code) ?? { topics: [], summary: '' };
  room.topics.push(topic);
  try {
    const leaf = topic.slice(ROOMS_ROOT.length + 1).split('/')[1];
    const msg = JSON.parse(payload.toString());
    if (leaf === 'lobby') {
      const names = (msg.players ?? []).map((p: { name: string }) => p.name).join(', ');
      room.summary = `${msg.over ? 'over' : msg.started ? 'started' : 'lobby'}: ${names || 'no players'}` + (room.summary.startsWith('closed') ? `; ${room.summary}` : '');
    } else if (leaf === 'closed') {
      room.summary = room.summary ? `${room.summary}; closed by ${msg.by}` : `closed by ${msg.by}`;
    }
  } catch {
    // Not JSON; the topic is still cleared.
  }
  rooms.set(code, room);
};
client.on('message', onMessage);
await client.subscribeAsync(filter, { qos: 1, nl: true, rh: 0 });
client.off('message', onMessage);
await client.unsubscribeAsync(filter);

// Presence of players, by room: epoch-draft/player/<player>/presence/<room>.
const presence = new Map<string, unknown>();
const onPresence = (topic: string, payload: Buffer, packet: mqtt.IPublishPacket) => {
  if (!packet.retain || !payload.length) return;
  try {
    presence.set(topic, JSON.parse(payload.toString()));
  } catch {
    presence.set(topic, undefined);
  }
};
const presenceFilter = `${PLAYERS_ROOT}/+/presence/+`;
client.on('message', onPresence);
await client.subscribeAsync(presenceFilter, { qos: 1, nl: true, rh: 0 });
client.off('message', onPresence);
await client.unsubscribeAsync(presenceFilter);
const stale = [...presence].filter(([t, msg]) => rooms.has(t.slice(t.lastIndexOf('/') + 1)) || msg !== 'online');
console.log(`${apply ? 'clear' : 'would clear'} ${stale.length} stale player presences`);
if (apply) await Promise.all(stale.map(([t]) => client.publishAsync(t, '', { qos: 1, retain: true })));

let cleared = 0;
for (const [code, room] of [...rooms].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${apply ? 'delete' : 'would delete'} ${code} (${room.topics.length} topics; ${room.summary || 'no lobby'})`);
  if (!apply) continue;
  await Promise.all(room.topics.map((t) => client.publishAsync(t, '', { qos: 1, retain: true })));
  cleared += room.topics.length;
}
const missing = [...only].filter((code) => !rooms.has(code));
if (missing.length) console.log(`not on the broker: ${missing.join(', ')}`);
console.log(apply ? `${rooms.size} rooms deleted, ${cleared} retained messages cleared` : `${rooms.size} rooms (dry run; add --apply)`);
await client.endAsync();

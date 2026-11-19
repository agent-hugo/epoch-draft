/**
 * Deletes rooms from the broker: clears every retained message under
 * `epoch-draft/<room>/`, including the `closed` marker, so nothing of the
 * room is left. Meant for rooms left over from tests.
 *
 * Usage:
 *   MQTT_URL=wss://... MQTT_TOKEN=... npm run clear-rooms -- [--apply] [ROOM...]
 *
 *   ROOM...   room codes to delete; without them every room is deleted
 *   --apply   actually delete; without it only lists the rooms
 */
import mqtt from 'mqtt';
import { TOPIC_ROOT } from '../src/net/protocol';

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
const filter = `${TOPIC_ROOT}/#`;
const rooms = new Map<string, { topics: string[]; summary: string }>();
const onMessage = (topic: string, payload: Buffer, packet: mqtt.IPublishPacket) => {
  if (!packet.retain || !payload.length) return;
  const code = topic.split('/')[1] ?? '';
  if (only.size && !only.has(code)) return;
  const room = rooms.get(code) ?? { topics: [], summary: '' };
  room.topics.push(topic);
  try {
    const leaf = topic.split('/')[2];
    const msg = JSON.parse(payload.toString());
    if (leaf === 'lobby') {
      const names = (msg.players ?? []).map((p: { name: string }) => p.name).join(', ');
      room.summary = `${msg.started ? 'started' : 'lobby'}: ${names || 'no players'}` + (room.summary.startsWith('closed') ? `; ${room.summary}` : '');
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

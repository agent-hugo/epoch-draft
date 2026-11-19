/**
 * Re-publishes retained messages with a message expiry interval, so retained
 * messages published before the expiry was set also go away in time.
 *
 * Subscribes to a topic filter, collects the retained messages the broker
 * sends (it stops after a quiet period), then publishes each one again with
 * the same payload and properties plus the expiry.
 *
 * Usage:
 *   MQTT_URL=wss://... MQTT_TOKEN=... npx tsx scripts/retain-expiry.ts [options] [filter]
 *
 *   filter        topic filter, default '#'
 *   --apply       actually re-publish; without it only lists what would change
 *   --days N      expiry in days, default 90 (the one the app uses)
 *   --all         also re-publish messages that already have an expiry
 *   --quiet MS    how long to wait for more retained messages, default 3000
 */
import mqtt from 'mqtt';
import type { IPublishPacket } from 'mqtt';
import { RETAIN_EXPIRY_S } from '../src/net/mqtt';

const url = process.env.MQTT_URL;
const token = process.env.MQTT_TOKEN;
if (!url || !token) {
  console.error('MQTT_URL and MQTT_TOKEN are required');
  process.exit(2);
}

const args = process.argv.slice(2);
let filter = '#';
let apply = false;
let all = false;
let expiry = RETAIN_EXPIRY_S;
let quietMs = 3000;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--apply') apply = true;
  else if (a === '--all') all = true;
  else if (a === '--days') expiry = Math.round(Number(args[++i]) * 24 * 60 * 60);
  else if (a === '--quiet') quietMs = Number(args[++i]);
  else if (a.startsWith('--')) {
    console.error(`unknown option ${a}`);
    process.exit(2);
  } else filter = a;
}
if (!(expiry > 0) || !(quietMs > 0)) {
  console.error('--days and --quiet must be positive numbers');
  process.exit(2);
}

const client = mqtt.connect(url, {
  username: token,
  password: '',
  protocolVersion: 5,
  clean: true,
  reconnectPeriod: 0,
  clientId: `ed-retain-${Math.random().toString(16).slice(2, 10)}`,
});
await new Promise<void>((resolve, reject) => {
  client.once('connect', () => resolve());
  client.once('error', reject);
});

// Only messages the broker sends because they are retained; live traffic
// (including our own re-publishes) arrives without the retain flag.
const found = new Map<string, IPublishPacket>();
let timer: ReturnType<typeof setTimeout> | undefined;
let done!: () => void;
const quiet = new Promise<void>((r) => (done = r));
const bump = () => {
  clearTimeout(timer);
  timer = setTimeout(done, quietMs);
};
client.on('message', (topic, payload, packet) => {
  if (!packet.retain || payload.length === 0) return;
  found.set(topic, packet);
  bump();
});
await client.subscribeAsync(filter, { qos: 1, nl: true, rh: 0 });
bump();
await quiet;

let todo = 0;
let skipped = 0;
for (const [topic, packet] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const left = packet.properties?.messageExpiryInterval;
  if (left !== undefined && !all) {
    skipped++;
    continue;
  }
  todo++;
  console.log(`${apply ? 'republish' : 'would republish'} ${topic} (${packet.payload.length} B${left !== undefined ? `, expiry ${left}s left` : ''})`);
  if (!apply) continue;
  // Keep what describes the content. User properties are not copied: the app
  // sets none, and the broker adds its own (timestamp, sender) on publish.
  const { payloadFormatIndicator, contentType, responseTopic, correlationData } = packet.properties ?? {};
  await client.publishAsync(topic, packet.payload as Buffer, {
    qos: 1,
    retain: true,
    properties: { payloadFormatIndicator, contentType, responseTopic, correlationData, messageExpiryInterval: expiry },
  });
}

console.log(
  `${found.size} retained under '${filter}': ${todo} ${apply ? 're-published' : 'to re-publish'}, ${skipped} already expire` +
    (apply ? '' : ' (dry run; add --apply)'),
);
await client.endAsync();

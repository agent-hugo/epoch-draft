/**
 * Re-publishes the project's retained messages with a message expiry
 * interval, so retained messages published before the expiry was set also go
 * away in time.
 *
 * Subscribes to the project's topic tree; the broker delivers the retained
 * messages before the SUBACK, so once the subscription is acknowledged each
 * message is published again with the same payload and the expiry; other
 * properties are not carried over. Then it subscribes again and checks that
 * every retained message has an expiry.
 *
 * Usage:
 *   MQTT_URL=wss://... MQTT_TOKEN=... npm run retain-expiry -- [options]
 *
 *   --apply       actually re-publish; without it only lists what would change
 *   --days N      expiry in days, default 7 (the one the app uses)
 *   --all         also re-publish messages that already have an expiry
 */
import mqtt from 'mqtt';
import type { IPublishPacket, MqttClient } from 'mqtt';
import { RETAIN_EXPIRY_S } from '../src/net/mqtt';
import { TOPIC_ROOT } from '../src/net/protocol';

const url = process.env.MQTT_URL;
const token = process.env.MQTT_TOKEN;
if (!url || !token) {
  console.error('MQTT_URL and MQTT_TOKEN are required');
  process.exit(2);
}

const filter = `${TOPIC_ROOT}/#`;
const args = process.argv.slice(2);
let apply = false;
let all = false;
let expiry = RETAIN_EXPIRY_S;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--apply') apply = true;
  else if (a === '--all') all = true;
  else if (a === '--days') expiry = Math.round(Number(args[++i]) * 24 * 60 * 60);
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (!(expiry > 0)) {
  console.error('--days must be a positive number');
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

/** Retained messages under the filter, as the broker sends them on subscribe. */
async function retained(client: MqttClient): Promise<Map<string, IPublishPacket>> {
  const found = new Map<string, IPublishPacket>();
  // Live traffic (including our own re-publishes) arrives without the retain flag.
  const onMessage = (topic: string, payload: Buffer, packet: IPublishPacket) => {
    if (packet.retain && payload.length > 0) found.set(topic, packet);
  };
  client.on('message', onMessage);
  await client.subscribeAsync(filter, { qos: 1, nl: true, rh: 0 });
  client.off('message', onMessage);
  await client.unsubscribeAsync(filter);
  return found;
}

const found = await retained(client);
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
  await client.publishAsync(topic, packet.payload as Buffer, {
    qos: 1,
    retain: true,
    properties: { messageExpiryInterval: expiry },
  });
}

console.log(
  `${found.size} retained under '${filter}': ${todo} ${apply ? 're-published' : 'to re-publish'}, ${skipped} already expire` +
    (apply ? '' : ' (dry run; add --apply)'),
);

if (apply && todo > 0) {
  const missing = [...(await retained(client))].filter(([, p]) => p.properties?.messageExpiryInterval === undefined);
  for (const [topic] of missing) console.log(`still without expiry: ${topic}`);
  console.log(missing.length ? `${missing.length} retained messages still have no expiry` : 'check: every retained message has an expiry');
  if (missing.length) process.exitCode = 1;
}
await client.endAsync();

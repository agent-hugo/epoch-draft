import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

export interface BrokerConfig {
  url: string;
  token: string;
}

export type Handler = (topic: string, payload: unknown) => void;

/** Thin JSON wrapper over mqtt.js with topic-filter handlers. */
export class Bus {
  private client: MqttClient;
  private handlers: { filter: string; fn: Handler }[] = [];
  private statusListeners = new Set<(online: boolean) => void>();
  online = false;

  constructor(cfg: BrokerConfig, opts: { will?: { topic: string; payload: unknown } } = {}) {
    this.client = mqtt.connect(cfg.url, {
      username: cfg.token,
      password: '',
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 2000,
      keepalive: 15, // notice a dead link within ~20 s (phones sleep, Wi-Fi drops)
      connectTimeout: 10000,
      clientId: `ed-${Math.random().toString(16).slice(2, 12)}`,
      will: opts.will
        ? { topic: opts.will.topic, payload: JSON.stringify(opts.will.payload), qos: 1, retain: true }
        : undefined,
    });
    this.client.on('connect', () => this.setOnline(true));
    this.client.on('close', () => this.setOnline(false));
    this.client.on('offline', () => this.setOnline(false));
    this.client.on('message', (topic, buf) => {
      if (buf.length === 0) {
        this.dispatch(topic, null);
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(buf.toString());
      } catch {
        return;
      }
      this.dispatch(topic, payload);
    });
  }

  private setOnline(v: boolean) {
    if (this.online === v) return;
    this.online = v;
    for (const l of this.statusListeners) l(v);
  }

  onStatus(fn: (online: boolean) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Resolves once connected for the first time; rejects on an auth error. */
  ready(): Promise<void> {
    if (this.online) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const off = this.onStatus((on) => {
        if (on) {
          off();
          this.client.off('error', onError);
          resolve();
        }
      });
      const onError = (e: Error) => {
        off();
        reject(e);
      };
      this.client.once('error', onError);
    });
  }

  private dispatch(topic: string, payload: unknown) {
    for (const h of this.handlers) if (matches(h.filter, topic)) h.fn(topic, payload);
  }

  subscribe(filter: string, fn: Handler): void {
    this.handlers.push({ filter, fn });
    this.client.subscribe(filter, { qos: 1 });
  }

  publish(topic: string, payload: unknown, retain = false): Promise<void> {
    const body = payload === null ? '' : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      this.client.publish(topic, body, { qos: 1, retain }, (err) => (err ? reject(err) : resolve()));
    });
  }

  end(): Promise<void> {
    return new Promise((resolve) => this.client.end(false, {}, () => resolve()));
  }
}

export function matches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

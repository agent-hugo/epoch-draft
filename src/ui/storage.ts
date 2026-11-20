import { randomId, randomRoomCode } from '../net/protocol';

export const DEFAULT_BROKER = 'wss://mqtt.flespi.io';

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: settings live for this page only */
  }
}

const memory = new Map<string, string>();

function load(key: string): string | null {
  return get(key) ?? memory.get(key) ?? null;
}

function save(key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  set(key, value);
}

export const settings = {
  get brokerUrl(): string {
    return load('ed:broker') || DEFAULT_BROKER;
  },
  set brokerUrl(v: string) {
    save('ed:broker', v.trim() || null);
  },
  get token(): string {
    return load('ed:token') ?? '';
  },
  set token(v: string) {
    save('ed:token', v.trim() || null);
  },
  get name(): string {
    return load('ed:name') ?? '';
  },
  set name(v: string) {
    save('ed:name', v.trim() || null);
  },
  /** Stable id of this device's player. */
  get playerId(): string {
    let id = load('ed:pid');
    if (!id) {
      id = randomId();
      save('ed:pid', id);
    }
    return id;
  },
  /** Code of the game server this browser runs on its `#serve` page. */
  get serverCode(): string {
    let code = load('ed:server');
    if (!code) {
      code = randomRoomCode();
      save('ed:server', code);
    }
    return code;
  },
  /** A room created on this device that has not named its engine yet. */
  isHost(room: string): boolean {
    return load(`ed:host:${room}`) === '1';
  },
  setHost(room: string): void {
    save(`ed:host:${room}`, '1');
  },
  clearHost(room: string): void {
    save(`ed:host:${room}`, null);
  },
  /** Rooms opened on this device, latest first. */
  get visited(): string[] {
    try {
      const v: unknown = JSON.parse(load('ed:visited') ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  visit(room: string): void {
    save('ed:visited', JSON.stringify([room, ...this.visited.filter((r) => r !== room)].slice(0, 50)));
  },
  forget(room: string): void {
    save('ed:visited', JSON.stringify(this.visited.filter((r) => r !== room)));
  },
};

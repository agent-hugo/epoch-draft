import type { CardDef, CivDef, Epoch, GameData } from './types';

export const HAND_SIZE = 7;
export const TURNS_PER_EPOCH = 6;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;

/** Indexed, read-only view of the game data. */
export class Db {
  readonly cards = new Map<string, CardDef>();
  readonly civs = new Map<string, CivDef>();
  /** card id -> ids of cards whose presence makes it free */
  readonly chainedFrom = new Map<string, string[]>();

  constructor(readonly data: GameData) {
    for (const c of data.cards) this.cards.set(c.id, c);
    for (const c of data.civs) this.civs.set(c.id, c);
    for (const c of data.cards) {
      for (const to of c.chainsTo ?? []) {
        const list = this.chainedFrom.get(to) ?? [];
        list.push(c.id);
        this.chainedFrom.set(to, list);
      }
    }
  }

  card(id: string): CardDef {
    const c = this.cards.get(id);
    if (!c) throw new Error(`unknown card ${id}`);
    return c;
  }

  civ(id: string): CivDef {
    const c = this.civs.get(id);
    if (!c) throw new Error(`unknown civilization ${id}`);
    return c;
  }

  /** Cards of the epoch for the player count, dynasties excluded. */
  epochCards(epoch: Epoch, players: number): string[] {
    const out: string[] = [];
    for (const c of this.data.cards) {
      if (c.epoch !== epoch || c.type === 'dynasty') continue;
      for (const min of c.copies) if (players >= min) out.push(c.id);
    }
    return out;
  }

  dynasties(): string[] {
    return this.data.cards.filter((c) => c.type === 'dynasty').map((c) => c.id);
  }
}

/** Returns a list of problems with the data; empty when valid. */
export function validateData(data: GameData): string[] {
  const errors: string[] = [];
  const db = new Db(data);
  if (db.cards.size !== data.cards.length) errors.push('duplicate card ids');
  if (db.civs.size !== data.civs.length) errors.push('duplicate civilization ids');
  for (const c of data.cards) {
    for (const to of c.chainsTo ?? []) {
      const target = db.cards.get(to);
      if (!target) errors.push(`${c.id}: chain target ${to} does not exist`);
      else if (target.epoch <= c.epoch) errors.push(`${c.id}: chain target ${to} is not in a later epoch`);
    }
    if (c.type === 'dynasty' && c.epoch !== 3) errors.push(`${c.id}: dynasty outside epoch 3`);
  }
  for (const civ of data.civs) {
    if (civ.monument.stages.length !== 3) errors.push(`${civ.id}: monument must have 3 stages`);
  }
  if (data.civs.length < MAX_PLAYERS) errors.push('not enough civilizations');
  const dyn = db.dynasties().length;
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (const epoch of [1, 2, 3] as Epoch[]) {
      const want = HAND_SIZE * n - (epoch === 3 ? n + 2 : 0);
      const got = db.epochCards(epoch, n).length;
      if (got !== want) errors.push(`epoch ${epoch}, ${n} players: ${got} cards, need ${want}`);
    }
    if (dyn < n + 2) errors.push(`${n} players: ${dyn} dynasties, need ${n + 2}`);
  }
  return errors;
}

/** Loads worlds from disk, for scripts that run without Vite. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Db } from '../engine/db';
import { makeWorld, sortWorlds, type World, type WorldFile } from './load';

const root = fileURLToPath(new URL('.', import.meta.url));

export function loadWorlds(): World[] {
  const list: World[] = [];
  for (const dir of readdirSync(root)) {
    const path = join(root, dir, 'world.json');
    if (!existsSync(path)) continue;
    const file = JSON.parse(readFileSync(path, 'utf8')) as WorldFile;
    list.push(makeWorld(dir, file, (name) => (existsSync(join(root, dir, name)) ? name : undefined)).world);
  }
  return sortWorlds(list);
}

/** Engine database of a world; the first world when `id` is missing. */
export function loadDb(id?: string): Db {
  const all = loadWorlds();
  const w = id ? all.find((x) => x.id === id) : all[0];
  if (!w) throw new Error(`unknown world ${id}; have ${all.map((x) => x.id).join(', ')}`);
  return new Db(w);
}

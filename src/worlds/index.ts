import { Db } from '../engine/db';
import { makeWorld, sortWorlds, worldProblems, type World, type WorldFile } from './load';

export type { World } from './load';

const files = import.meta.glob<WorldFile>('./*/world.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('./*/*.{png,svg,webp,jpg,jpeg,gif,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const loaded = Object.entries(files).map(([path, file]) => {
  const dir = path.split('/')[1]!;
  return { dir, ...makeWorld(dir, file, (name) => images[`./${dir}/${name}`]) };
});

/** All worlds, in display order. */
export const worlds: World[] = sortWorlds(loaded.map((w) => w.world));

/** Problems per world id; empty lists when everything is fine. */
export const problems: Record<string, string[]> = Object.fromEntries(
  loaded.map((w) => [w.dir, worldProblems(w.world, w.missing)]),
);

export const DEFAULT_WORLD = worlds[0]!.id;

export function getWorld(id?: string): World {
  return worlds.find((w) => w.id === id) ?? worlds.find((w) => w.id === DEFAULT_WORLD)!;
}

const dbs = new Map<string, Db>();

/** Engine database of a world (the default world for unknown ids). */
export function worldDb(id?: string): Db {
  const w = getWorld(id);
  let db = dbs.get(w.id);
  if (!db) dbs.set(w.id, (db = new Db(w)));
  return db;
}

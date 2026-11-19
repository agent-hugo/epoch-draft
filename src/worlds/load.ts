import { validateData } from '../engine/db';
import type { GameData } from '../engine/types';

/**
 * A world: the theme the general rules are played in — civilizations,
 * resources with their icons, science schools and cards. Each world is a
 * folder in src/worlds with a world.json and the image files it refers to.
 */
export interface World extends GameData {
  id: string;
  name: string;
  description?: string;
  /** Position in the list of worlds. */
  order: number;
  /** Names for bots added in the lobby. */
  bots: string[];
}

/** world.json as written: `img` fields are file names next to it. */
export type WorldFile = Omit<World, 'id' | 'order' | 'bots'> & { order?: number; bots?: string[] };

/**
 * Builds a world from its world.json. `fileUrl` turns a file name from the
 * folder into a URL; image names it does not know are reported in `missing`.
 */
export function makeWorld(id: string, file: WorldFile, fileUrl: (name: string) => string | undefined) {
  const missing: string[] = [];
  const data = structuredClone(file);
  const resolve = <T extends { img?: string }>(item: T) => {
    if (!item.img) return;
    const url = fileUrl(item.img);
    if (url) item.img = url;
    else {
      missing.push(item.img);
      delete item.img;
    }
  };
  data.resources.forEach(resolve);
  data.schools.forEach(resolve);
  data.civs.forEach(resolve);
  data.cards.forEach(resolve);
  const world: World = { ...data, id, order: data.order ?? 1000, bots: data.bots ?? [] };
  return { world, missing };
}

/** Problems with a world: bad data or missing image files. */
export function worldProblems(world: World, missing: string[]): string[] {
  return [...validateData(world), ...missing.map((f) => `missing image ${f}`)];
}

export function sortWorlds(list: World[]): World[] {
  return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

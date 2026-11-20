import type { ComponentChildren } from 'preact';
import type { Db } from '../engine/db';
import type { CardType, Cost, Counter, Effect, Resource, ResourceMap } from '../engine/types';

/** A world icon: an image when the world has one, the text icon otherwise. */
export function Icon({ def }: { def?: { icon: string; img?: string; name: string } }) {
  if (!def) return <>?</>;
  return def.img ? <img class="ico" src={def.img} alt={def.icon} title={def.name} /> : <>{def.icon}</>;
}

export function ResIcon({ db, id }: { db: Db; id: Resource }) {
  return <Icon def={db.resources.get(id)} />;
}

/** Items separated by `sep`. */
export function joined(items: ComponentChildren[], sep: ComponentChildren): ComponentChildren {
  return items.map((it, k) => (
    <>
      {k > 0 && sep}
      {it}
    </>
  ));
}

/** Alternatives like 🪵/🧱. */
export function resChoice(db: Db, options: Resource[]): ComponentChildren {
  return joined(options.map((r) => <ResIcon db={db} id={r} />), '/');
}

export const TYPE_NAME: Record<CardType, string> = {
  raw: 'Сырьё',
  goods: 'Товары',
  culture: 'Культура',
  trade: 'Торговля',
  military: 'Армия',
  science: 'Наука',
  dynasty: 'Династия',
};

export const TYPE_ORDER: CardType[] = ['raw', 'goods', 'culture', 'trade', 'military', 'science', 'dynasty'];

export const EPOCH_NAME = ['', 'I', 'II', 'III'];

/** Resources as repeated icons; null when there are none. */
export function resList(db: Db, m: ResourceMap): ComponentChildren {
  const ids = db.resourceIds.filter((r) => m[r]);
  if (!ids.length) return null;
  return ids.flatMap((r) => Array.from({ length: m[r]! }, () => <ResIcon db={db} id={r} />));
}

export function costText(db: Db, cost: Cost): ComponentChildren {
  const parts: ComponentChildren[] = [];
  if (cost.coins) parts.push(`${cost.coins}🪙`);
  const res = cost.res && resList(db, cost.res);
  if (res) parts.push(res);
  return parts.length ? joined(parts, ' ') : 'бесплатно';
}

const WHAT_NAME: Record<string, string> = {
  raw: 'сырья',
  goods: 'товаров',
  culture: 'культуры',
  trade: 'торговли',
  military: 'армии',
  science: 'науки',
  dynasty: 'династий',
  stage: 'стадию сооружения',
  defeat: 'каждый жетон поражения в войнах',
};

function counterText(c: Counter): string {
  const what = c.what.map((w) => WHAT_NAME[w]).join(', ');
  const isCard = c.what.every((w) => w !== 'stage' && w !== 'defeat');
  const subject = isCard ? `карту ${what}` : what;
  const self = c.who.includes('self');
  const nb = c.who.includes('left') || c.who.includes('right');
  const whose =
    self && nb ? 'у вас и соседей' : nb ? (c.what.includes('defeat') ? 'у обоих соседей (ваши не в счёт)' : 'у соседей') : 'у вас';
  return `за ${subject} ${whose}`;
}

export function effectText(db: Db, e: Effect): ComponentChildren {
  switch (e.kind) {
    case 'produce':
      return resList(db, e.res);
    case 'produceChoice':
      return resChoice(db, e.options);
    case 'points':
      return `${e.n}⭐`;
    case 'coins':
      return `+${e.n}🪙`;
    case 'military':
      return '⚔️'.repeat(e.n);
    case 'science':
      return e.school === 'any'
        ? joined([...db.schools.values()].map((s) => <Icon def={s} />), '/')
        : <Icon def={db.schools.get(e.school)} />;
    case 'tradeDiscount': {
      const side = e.sides.length === 2 ? '◀▶' : e.sides[0] === 'left' ? '◀' : '▶';
      return (
        <>
          {side} {e.resources.map((r) => <ResIcon db={db} id={r} />)} по {e.price}🪙
        </>
      );
    }
    case 'coinsPer':
      return `+${e.n}🪙 ${counterText(e.count)}`;
    case 'pointsPer':
      return `${e.n}⭐ ${counterText(e.count)}`;
  }
}

export function effectsText(db: Db, effects: Effect[]): ComponentChildren {
  return joined(effects.map((e) => effectText(db, e)), ' · ');
}

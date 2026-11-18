import type { CardType, Cost, Counter, Effect, Resource, ResourceMap, School } from '../engine/types';
import { RESOURCES } from '../engine/types';

export const RES_ICON: Record<Resource, string> = {
  wood: '🪵',
  stone: '🪨',
  clay: '🧱',
  ore: '⛏️',
  cloth: '🧵',
  papyrus: '📜',
  glass: '🔮',
};

export const RES_NAME: Record<Resource, string> = {
  wood: 'дерево',
  stone: 'камень',
  clay: 'глина',
  ore: 'руда',
  cloth: 'ткань',
  papyrus: 'папирус',
  glass: 'стекло',
};

export const SCHOOL_ICON: Record<School, string> = { astronomy: '🔭', medicine: '⚕️', writing: '✒️' };
export const SCHOOL_NAME: Record<School, string> = { astronomy: 'Астрономия', medicine: 'Медицина', writing: 'Письменность' };

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

export function resList(m: ResourceMap): string {
  return RESOURCES.filter((r) => m[r])
    .map((r) => RES_ICON[r].repeat(m[r]!))
    .join('');
}

export function costText(cost: Cost): string {
  const parts: string[] = [];
  if (cost.coins) parts.push(`${cost.coins}🪙`);
  if (cost.res) parts.push(resList(cost.res));
  return parts.join(' ') || 'бесплатно';
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
  defeat: 'поражение',
};

function counterText(c: Counter): string {
  const what = c.what.map((w) => WHAT_NAME[w]).join(', ');
  const isCard = c.what.every((w) => w !== 'stage' && w !== 'defeat');
  const subject = isCard ? `карту ${what}` : what;
  const self = c.who.includes('self');
  const nb = c.who.includes('left') || c.who.includes('right');
  const whose = self && nb ? 'у вас и соседей' : nb ? 'у соседей' : 'у вас';
  return `за ${subject} ${whose}`;
}

export function effectText(e: Effect): string {
  switch (e.kind) {
    case 'produce':
      return resList(e.res);
    case 'produceChoice':
      return e.options.map((r) => RES_ICON[r]).join('/');
    case 'points':
      return `${e.n}⭐`;
    case 'coins':
      return `+${e.n}🪙`;
    case 'military':
      return '⚔️'.repeat(e.n);
    case 'science':
      return e.school === 'any' ? '🔭/⚕️/✒️' : SCHOOL_ICON[e.school];
    case 'tradeDiscount': {
      const side = e.sides.length === 2 ? '◀▶' : e.sides[0] === 'left' ? '◀' : '▶';
      return `${side} ${e.resources.map((r) => RES_ICON[r]).join('')} по ${e.price}🪙`;
    }
    case 'coinsPer':
      return `+${e.n}🪙 ${counterText(e.count)}`;
    case 'pointsPer':
      return `${e.n}⭐ ${counterText(e.count)}`;
  }
}

export function effectsText(effects: Effect[]): string {
  return effects.map(effectText).join(' · ');
}

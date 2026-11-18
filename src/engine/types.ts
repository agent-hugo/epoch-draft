export const RAW = ['wood', 'stone', 'clay', 'ore'] as const;
export const GOODS = ['cloth', 'papyrus', 'glass'] as const;
export type RawResource = (typeof RAW)[number];
export type Goods = (typeof GOODS)[number];
export type Resource = RawResource | Goods;
export const RESOURCES: readonly Resource[] = [...RAW, ...GOODS];
export type ResourceMap = Partial<Record<Resource, number>>;

export const SCHOOLS = ['astronomy', 'medicine', 'writing'] as const;
export type School = (typeof SCHOOLS)[number];

export const CARD_TYPES = ['raw', 'goods', 'culture', 'trade', 'military', 'science', 'dynasty'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type Side = 'left' | 'right';
export type Who = 'self' | Side;
/** What a counter counts: cards of a type, monument stages, or defeat tokens. */
export type Countable = CardType | 'stage' | 'defeat';

export interface Counter {
  what: Countable[];
  who: Who[];
}

export type Effect =
  | { kind: 'produce'; res: ResourceMap }
  | { kind: 'produceChoice'; options: Resource[] }
  | { kind: 'points'; n: number }
  | { kind: 'coins'; n: number }
  | { kind: 'military'; n: number }
  | { kind: 'science'; school: School | 'any' }
  | { kind: 'tradeDiscount'; resources: Resource[]; sides: Side[]; price: number }
  | { kind: 'coinsPer'; count: Counter; n: number }
  | { kind: 'pointsPer'; count: Counter; n: number };

export interface Cost {
  coins?: number;
  res?: ResourceMap;
}

export type Epoch = 1 | 2 | 3;

export interface CardDef {
  id: string;
  name: string;
  epoch: Epoch;
  type: CardType;
  /**
   * Player counts at which a copy is added: [3, 5] means one copy with 3+
   * players and a second one with 5+. Dynasty cards use [3] and are drawn
   * randomly (players + 2 of them).
   */
  copies: number[];
  cost: Cost;
  effects: Effect[];
  /** Cards that become free to build once this card is in the city. */
  chainsTo?: string[];
}

export interface StageDef {
  cost: Cost;
  effects: Effect[];
}

export interface CivDef {
  id: string;
  name: string;
  start: Resource;
  monument: { name: string; stages: StageDef[] };
}

export interface GameData {
  cards: CardDef[];
  civs: CivDef[];
}

export interface Trade {
  left: ResourceMap;
  right: ResourceMap;
}

export type Choice =
  | { action: 'build'; card: string; trade: Trade }
  | { action: 'stage'; card: string; trade: Trade }
  | { action: 'sell'; card: string };

export interface PlayerState {
  id: string;
  name: string;
  civ: string;
  coins: number;
  /** Card ids built in the city, in build order. */
  city: string[];
  /** Number of monument stages built. */
  stages: number;
  /** Conflict tokens: positive for victories, -1 for defeats. */
  conflicts: number[];
  hand: string[];
}

export interface LogEntry {
  epoch: Epoch;
  turn: number;
  player: string;
  action: Choice['action'];
  card: string;
  /** Coins paid in total, including the coins paid to neighbours. */
  paid: number;
  /** Coins paid to the left / right neighbour for resources. */
  left?: number;
  right?: number;
}

export interface GameState {
  version: 1;
  rng: number;
  epoch: Epoch;
  /** 1..6 within the epoch. */
  turn: number;
  phase: 'play' | 'over';
  /** Seat order; left neighbour of seat i is i-1, right is i+1 (cyclic). */
  players: PlayerState[];
  discard: string[];
  /** Choices made this turn, keyed by player id. */
  pending: Record<string, Choice>;
  log: LogEntry[];
}

export interface ScoreBreakdown {
  military: number;
  coins: number;
  monument: number;
  culture: number;
  trade: number;
  dynasty: number;
  science: number;
  total: number;
}

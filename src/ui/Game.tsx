import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TURNS_PER_EPOCH, type Db } from '../engine/db';
import { coinsNeeded, leftOf, production, rightOf, type PaymentOption } from '../engine/payment';
import { DEFEAT_POINTS, handOptions, nextStageCost, SELL_COINS, VICTORY_POINTS, type CardOptions } from '../engine/rules';
import { military, ranking, scoreGame, scorePlayer } from '../engine/scoring';
import type { CardDef, Choice, Cost, Epoch, GameState, LogEntry, PlayerState, ScoreBreakdown } from '../engine/types';
import type { ClientSnapshot, Player } from '../net/client';
import type { Host } from '../net/host';
import { playerView } from '../net/protocol';
import { ConfirmDialog, type Ask } from './dialog';
import { Reference } from './Reference';
import { SeatList } from './SeatList';
import { settings } from './storage';
import { costText, effectsText, EPOCH_NAME, joined, resChoice, resList, TYPE_NAME, TYPE_ORDER } from './format';

type Tab = 'hand' | 'city' | 'others' | 'help' | 'settings';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'hand', icon: '🃏', label: 'Рука' },
  { id: 'city', icon: '🏙️', label: 'Город' },
  { id: 'others', icon: '👥', label: 'Соседи' },
  { id: 'help', icon: '📖', label: 'Справка' },
  { id: 'settings', icon: '⚙️', label: 'Настройки' },
];

interface Props {
  db: Db;
  room: string;
  pid: string;
  snap: ClientSnapshot;
  player: Player;
  host?: Host;
  onLeave: () => void;
}

export function Game({ db, room, pid, snap, player, host, onLeave }: Props) {
  const [tab, setTab] = useState<Tab>('hand');
  // The tab body is the only scrolling element, so the header and the tab bar
  // never leave the screen. Each tab keeps its own scroll position.
  const body = useRef<HTMLElement>(null);
  const scrollPos = useRef<Partial<Record<Tab, number>>>({});
  const switchTab = (t: Tab) => {
    if (body.current) scrollPos.current[tab] = body.current.scrollTop;
    setTab(t);
  };
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = scrollPos.current[tab] ?? 0;
  }, [tab]);
  const pub = snap.pub!;
  const handFresh = snap.hand && snap.hand.epoch === pub.epoch && snap.hand.turn === pub.turn;
  const view = playerView(pub, pid, handFresh ? snap.hand!.hand : []);
  const i = view.players.findIndex((p) => p.id === pid);
  const hostOnline = snap.lobby ? snap.presence[snap.lobby.host] !== false : true;

  // After every resolved turn show what everybody did. Turns resolved before
  // this screen was opened (e.g. before a reload) are not shown.
  const last = pub.log[pub.log.length - 1];
  const lastKey = last ? `${last.epoch}-${last.turn}` : '';
  const seenTurn = useRef(lastKey);
  const [summary, setSummary] = useState(false);
  // The expanded card of the hand survives switching tabs, but not the turn.
  const [openCard, setOpenCard] = useState<{ key: string; card?: string }>({ key: '' });
  const turnKey = `${pub.epoch}-${pub.turn}`;
  const open = openCard.key === turnKey ? openCard.card : undefined;
  const setOpen = (card?: string) => setOpenCard({ key: turnKey, card });
  // When everybody has chosen, the host is asked to move on to the next turn.
  const allDone = pub.phase === 'play' && pub.players.every((p) => pub.chosen.includes(p.id));
  // '' asks, 'cancel' leaves a banner to end the turn later, 'ok' waits for the host.
  const [endAsk, setEndAsk] = useState<'' | 'cancel' | 'ok'>('');
  useEffect(() => {
    if (!allDone) setEndAsk('');
  }, [allDone]);
  useEffect(() => {
    if (lastKey === seenTurn.current) return;
    seenTurn.current = lastKey;
    setSummary(true);
  }, [lastKey]);

  if (i < 0) return <Spectator db={db} state={view} onLeave={onLeave} />;
  if (pub.phase === 'over') return <Final db={db} state={view} me={i} onLeave={onLeave} />;

  const me = view.players[i]!;
  const waiting = pub.players.filter((p) => !pub.chosen.includes(p.id)).map((p) => p.name);

  return (
    <div class="game">
      <header class="bar game-bar">
        <div class="bar-row">
          <div>
            <b>Эпоха {EPOCH_NAME[pub.epoch]}</b> · ход {pub.turn}/6
          </div>
          <div class="stats">
            <span>{me.coins}🪙</span>
            <span>{military(db, view, i)}⚔️</span>
            <span>{scorePlayer(db, view, i).total}⭐</span>
          </div>
        </div>
        <Neighbours state={view} i={i} />
      </header>
      {!snap.connected && <div class="banner warn">Нет связи с брокером, переподключаемся…</div>}
      {snap.connected && !hostOnline && <div class="banner warn">Хост не в сети: игра продолжится, когда он вернётся.</div>}
      <div class="waiting small muted">
        {waiting.length ? `Ждём: ${waiting.join(', ')}` : host ? 'Все сделали выбор' : 'Все сделали выбор, ждём, пока хост завершит ход'}
      </div>
      {host && allDone && endAsk === 'cancel' && (
        <div class="banner">
          Все сделали выбор.
          <button
            class="banner-action primary"
            onClick={() => {
              setEndAsk('ok');
              host.endTurn();
            }}
          >
            Завершить ход
          </button>
        </div>
      )}
      {host && allDone && endAsk === '' && !summary && (
        <ConfirmDialog
          ask={{
            text: 'Все сделали выбор. Завершить ход и перейти к следующему?',
            ok: 'Завершить ход',
            run: () => {
              setEndAsk('ok');
              host.endTurn();
            },
          }}
          onClose={() => setEndAsk('cancel')}
        />
      )}

      <main class="tab-body" ref={body}>
        {tab === 'hand' && (
          <HandTab
            db={db}
            view={view}
            i={i}
            ready={!!handFresh}
            chosen={handFresh ? snap.hand!.chosen : undefined}
            error={handFresh ? snap.hand!.error : undefined}
            onChoose={(c) => player.send(c)}
            open={open}
            setOpen={setOpen}
          />
        )}
        {tab === 'city' && <CityView db={db} state={view} i={i} />}
        {tab === 'others' && (
          <Others
            db={db}
            state={view}
            me={i}
            online={(id) => !!snap.lobby?.players.find((p) => p.id === id)?.bot || !!snap.presence[id]}
          />
        )}
        {tab === 'help' && <Reference db={db} highlightCiv={me.civ} />}
        {tab === 'settings' && (
          <GameSettings room={room} pid={pid} snap={snap} player={player} host={host} onLeave={onLeave} />
        )}
      </main>

      <nav class="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={tab === t.id ? 'active' : ''}
            aria-label={t.label}
            title={t.label}
            onClick={() => switchTab(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </nav>
      {summary && <TurnSummary db={db} state={view} pid={pid} onClose={() => setSummary(false)} />}
    </div>
  );
}

/** Entries of the last resolved turn. */
function lastTurnLog(log: LogEntry[]): LogEntry[] {
  const last = log[log.length - 1];
  return last ? log.filter((e) => e.epoch === last.epoch && e.turn === last.turn) : [];
}

/**
 * What a player did, as everybody sees it. As in the board game, the card
 * spent on a monument stage or sold stays hidden from the other players,
 * unless `reveal` (the review after the game) shows every card.
 */
function ActionText(props: { db: Db; state: GameState; e: LogEntry; pid: string; reveal?: boolean }) {
  const { db, state, e, pid, reveal } = props;
  const n = state.players.length;
  const k = state.players.findIndex((p) => p.id === e.player);
  // Always in the third person with the name: the lists name every player, me too.
  const shown = e.player === pid || reveal;
  const card = db.card(e.card);
  const paid = [];
  if (e.left) paid.push(`${e.left}🪙 ◀ ${state.players[leftOf(n, k)]!.name}`);
  if (e.right) paid.push(`${e.right}🪙 ▶ ${state.players[rightOf(n, k)]!.name}`);
  const pay = e.paid ? (
    <span class="muted">
      {' '}
      · заплатил(а) {e.paid}🪙{paid.length ? `, из них ${paid.join(', ')}` : ''}
    </span>
  ) : null;
  if (e.action === 'build')
    return (
      <>
        построил(а) <b class={`chip t-${card.type}`}>{card.name}</b>
        {e.chain && <span class="muted"> · даром по цепочке</span>}
        {pay}
        <div class="small muted">{effectsText(db, card.effects)}</div>
      </>
    );
  if (e.action === 'stage') {
    const stageNo = state.log.slice(0, state.log.indexOf(e) + 1).filter((x) => x.player === e.player && x.action === 'stage').length;
    const stage = db.civ(state.players[k]!.civ).monument.stages[stageNo - 1];
    return (
      <>
        возвёл(а) 🏛️ стадию {stageNo} сооружения{shown && ` картой «${card.name}»`}
        {pay}
        {stage && <div class="small muted">{effectsText(db, stage.effects)}</div>}
      </>
    );
  }
  return (
    <>
      продал(а) {shown ? `«${card.name}»` : 'карту'} за {SELL_COINS}🪙
    </>
  );
}

/**
 * Conflict results of an epoch between every pair of neighbours, as recorded
 * by the host. Games saved before the record existed get them recomputed
 * from the state right after the epoch ended.
 */
function ConflictResults({ db, state, epoch }: { db: Db; state: GameState; epoch: Epoch }) {
  const n = state.players.length;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?';
  let battles = (state.battles ?? []).filter((b) => b.epoch === epoch);
  if (!battles.length && !state.battles)
    battles = state.players.map((p, a) => {
      const b = rightOf(n, a);
      return { epoch, players: [p.id, state.players[b]!.id], military: [military(db, state, a), military(db, state, b)] };
    });
  if (!battles.length) return null;
  return (
    <ul class="summary-list conflicts">
      {battles.map((bt) => {
        const [pa, pb] = bt.military;
        const A = name(bt.players[0]);
        const B = name(bt.players[1]);
        const res =
          pa === pb
            ? 'ничья'
            : pa > pb
              ? `${A} +${VICTORY_POINTS[epoch]}⭐, ${B} −${-DEFEAT_POINTS}⭐`
              : `${B} +${VICTORY_POINTS[epoch]}⭐, ${A} −${-DEFEAT_POINTS}⭐`;
        return (
          <li key={bt.players.join()}>
            {A} {pa}⚔️ : {pb}⚔️ {B} → {res}
          </li>
        );
      })}
    </ul>
  );
}

/** The screen shown after each turn: what every player did. */
function TurnSummary({ db, state, pid, onClose }: { db: Db; state: GameState; pid: string; onClose: () => void }) {
  const entries = lastTurnLog(state.log);
  const first = entries[0];
  if (!first) return null;
  const n = state.players.length;
  const me = state.players.findIndex((p) => p.id === pid);
  // Me first, then around the table.
  const order = state.players.map((_, k) => (me + k) % n);
  return (
    <div class="modal-back" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div class="modal summary" role="dialog" aria-modal="true" aria-label="Итоги хода">
        <h3>
          Итоги хода {first.turn} · эпоха {EPOCH_NAME[first.epoch]}
        </h3>
        <ul class="summary-list">
          {order.map((k) => {
            const p = state.players[k]!;
            const e = entries.find((x) => x.player === p.id);
            return (
              <li key={p.id}>
                <b>{p.name}</b>{' '}
                {e ? <ActionText db={db} state={state} e={e} pid={pid} /> : <span class="muted">—</span>}
              </li>
            );
          })}
        </ul>
        {first.turn === TURNS_PER_EPOCH && (
          <>
            <h3>Конфликты эпохи {EPOCH_NAME[first.epoch]}</h3>
            <ConflictResults db={db} state={state} epoch={first.epoch} />
          </>
        )}
        <div class="row end">
          <button class="primary" autoFocus onClick={onClose}>
            Дальше
          </button>
        </div>
      </div>
    </div>
  );
}

function GameSettings(props: {
  room: string;
  pid: string;
  snap: ClientSnapshot;
  player: Player;
  host?: Host;
  onLeave: () => void;
}) {
  const { room, snap, player, host } = props;
  const [name, setName] = useState(settings.name);
  const [ending, setEnding] = useState(false);
  const [ask, setAsk] = useState<Ask>();
  const newName = name.trim();
  const lobby = snap.lobby;
  const isBot = (id: string) => !!lobby?.players.find((p) => p.id === id)?.bot;
  return (
    <div class="stack settings-tab">
      <h2>Настройки</h2>
      <div>
        Комната: <b>{room}</b>
      </div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName || newName === settings.name) return;
          setAsk({
            text: `Сменить имя на «${newName}»? Его увидят все игроки.`,
            ok: 'Сменить',
            run: () => {
              settings.name = newName;
              player.rename(newName);
            },
          });
        }}
      >
        <input value={name} maxLength={24} aria-label="Ваше имя" onInput={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={!newName || newName === settings.name}>
          Сменить имя
        </button>
      </form>
      <button
        onClick={() =>
          setAsk({
            text: 'Выйти в меню? Остальные будут ждать вашего хода, пока вы не вернётесь.',
            ok: 'Выйти',
            run: props.onLeave,
          })
        }
      >
        Выйти в меню
      </button>
      <p class="small muted">Остальные будут ждать вашего хода, пока вы не вернётесь по коду комнаты.</p>

      {host && snap.pub && (
        <>
          <h3>Игроки</h3>
          <SeatList
            players={snap.pub.players}
            onApply={(ids) => host.reorder(ids)}
            row={(p) => (
              <>
                <span class={`dot ${isBot(p.id) || snap.presence[p.id] ? 'on' : ''}`} />
                <span class="seat-name">{p.name}</span>
                {p.id === lobby?.host && <span class="tag">хост</span>}
                {p.id !== lobby?.host && !isBot(p.id) && (
                  <button
                    class="replace"
                    onClick={() =>
                      setAsk({
                        text: `Заменить игрока ${p.name} ботом до конца игры? Его отключат от партии, вернуться он не сможет.`,
                        ok: 'Заменить',
                        danger: true,
                        run: () => host.replaceWithBot(p.id),
                      })
                    }
                  >
                    🤖 Заменить
                  </button>
                )}
              </>
            )}
          />
          <p class="small muted">
            Заменить ботом пригодится, если кто-то ушёл и игра его ждёт. Если поменять порядок посреди хода, ходы с
            покупками у соседей придётся сделать заново.
          </p>
        </>
      )}

      <button
        class="danger"
        disabled={ending}
        onClick={() =>
          setAsk({
            text: 'Завершить игру для всех? Партия будет удалена, продолжить её будет нельзя.',
            ok: 'Завершить',
            danger: true,
            run: () => {
              setEnding(true);
              void player.endGame().catch(() => setEnding(false));
            },
          })
        }
      >
        {ending ? 'Завершаем…' : 'Завершить игру для всех'}
      </button>
      <p class="small muted">Удаляет партию у всех участников. Нажать может любой игрок.</p>
      <a class="small" href="https://github.com/agent-hugo/epoch-draft" target="_blank" rel="noopener">
        Проект на GitHub
      </a>
      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

/**
 * The neighbours of player `i` and where the hand goes after this turn:
 * epochs I and III pass left, II right; the last turn's card is discarded.
 */
function Neighbours({ state, i }: { state: GameState; i: number }) {
  const n = state.players.length;
  const last = state.turn >= TURNS_PER_EPOCH;
  const toRight = state.epoch === 2;
  return (
    <div class="neighbours small">
      <span class={`nb left ${!last && !toRight ? 'next' : ''}`} title="Сосед слева">
        ◀ {state.players[leftOf(n, i)]!.name}
      </span>
      <span class="pass-to">{last ? 'последний ход' : toRight ? 'далее ▶' : '◀ далее'}</span>
      <span class={`nb right ${!last && toRight ? 'next' : ''}`} title="Сосед справа">
        {state.players[rightOf(n, i)]!.name} ▶
      </span>
    </div>
  );
}

function HandTab(props: {
  db: Db;
  view: GameState;
  i: number;
  ready: boolean;
  chosen?: Choice;
  error?: string;
  onChoose: (c: Choice | null) => void;
  open?: string;
  setOpen: (card?: string) => void;
}) {
  const { db, view, i, chosen, open, setOpen } = props;
  // What was last sent this turn: a move, or null for a withdrawn one.
  const [sent, setSent] = useState<Choice | null>();
  const [ask, setAsk] = useState<Ask>();
  const key = `${view.epoch}-${view.turn}`;
  useEffect(() => {
    setSent(undefined);
    setAsk(undefined);
  }, [key]);

  if (!props.ready) return <p class="muted">Получаем карты…</p>;
  const me = view.players[i]!;
  const options = handOptions(db, view, i);
  const civ = db.civ(me.civ);
  const stageCost = nextStageCost(db, me);
  const choose = (c: Choice | null) => {
    setSent(c);
    props.onChoose(c);
  };
  const pendingSend = sent !== undefined && JSON.stringify(sent) !== JSON.stringify(chosen ?? null);

  return (
    <div>
      {chosen && (
        <div class="banner ok">
          {choiceLabel(db, chosen)}. Пока ход не завершён, выбор можно изменить или отменить.
          <button class="banner-action" onClick={() => choose(null)}>
            Отменить выбор
          </button>
        </div>
      )}
      {pendingSend && !props.error && <div class="banner">Отправляем…</div>}
      {props.error && <div class="banner warn">Ход не принят: {props.error}</div>}

      <div class="monument small">
        <b>{civ.monument.name}</b>: стадия {me.stages}/3
        {stageCost && (
          <>
            {' '}
            · следующая: {costText(db, stageCost)} → {effectsText(db, civ.monument.stages[me.stages]!.effects)}
          </>
        )}
      </div>

      <ul class="cards">
        {options.map((o) => {
          const card = db.card(o.card);
          const isChosen = chosen?.card === o.card;
          return (
            <li key={o.card} class={`card t-${card.type} ${isChosen ? 'chosen' : ''} ${o.build.length ? 'can' : ''}`}>
              <button class="card-head" onClick={() => setOpen(open === o.card ? undefined : o.card)}>
                <CardFace db={db} card={card} chain={o.chain} affordable={o.build.length > 0} />
              </button>
              {open === o.card && card.img && <img class="card-img" src={card.img} alt="" />}
              {open === o.card && isChosen && (
                <div class="actions">
                  <div class="small">{choiceLabel(db, chosen)}.</div>
                  <button
                    onClick={() => {
                      choose(null);
                      setOpen(undefined);
                    }}
                  >
                    Отменить выбор
                  </button>
                </div>
              )}
              {open === o.card && !isChosen && (
                <CardActions
                  db={db}
                  state={view}
                  i={i}
                  me={me}
                  o={o}
                  hasStage={!!stageCost}
                  stageNo={me.stages + 1}
                  onChoose={(c, pay) =>
                    setAsk({
                      text: <ChoiceText db={db} me={me} o={o} choice={c} pay={pay} />,
                      ok: 'Подтвердить',
                      run: () => {
                        choose(c);
                        setOpen(undefined);
                      },
                    })
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

/** The move being confirmed: what is done with the card and what it costs. */
function ChoiceText(props: { db: Db; me: PlayerState; o: CardOptions; choice: Choice; pay?: PaymentOption }) {
  const { db, me, o, choice, pay } = props;
  const card = db.card(choice.card);
  const chain = choice.action === 'build' && o.chain;
  const cost = choice.action === 'stage' ? nextStageCost(db, me) : card.cost;
  const price = (
    <>
      <div>Цена: {chain ? 'бесплатно по цепочке' : cost ? costText(db, cost) : '—'}</div>
      {!chain && pay && pay.total > 0 && <div>Платите: {payLabel(db, pay)}</div>}
    </>
  );
  if (choice.action === 'sell')
    return (
      <div class="choice-text">
        <b>Продать «{card.name}»?</b>
        <div>Карта уйдёт в сброс, вы получите {SELL_COINS}🪙.</div>
      </div>
    );
  if (choice.action === 'stage') {
    const stage = db.civ(me.civ).monument.stages[me.stages]!;
    return (
      <div class="choice-text">
        <b>Построить стадию {me.stages + 1} сооружения?</b>
        <div>Стадия даст: {effectsText(db, stage.effects)}</div>
        {price}
        <div class="small muted">Карта «{card.name}» уйдёт на стадию, её эффект не сработает.</div>
      </div>
    );
  }
  return (
    <div class="choice-text">
      <b>Построить «{card.name}»?</b>
      <div>Эффект: {effectsText(db, card.effects)}</div>
      <div>Оплата: {price}</div>
    </div>
  );
}

function choiceLabel(db: Db, c: Choice): string {
  const name = db.card(c.card).name;
  if (c.action === 'build') return `Вы строите «${name}»`;
  if (c.action === 'stage') return `Вы возводите стадию сооружения (картой «${name}»)`;
  return `Вы продаёте «${name}» за 3🪙`;
}

function CardFace({ db, card, chain, affordable }: { db: Db; card: CardDef; chain?: boolean; affordable?: boolean }) {
  const price = costText(db, card.cost);
  const free = price === 'бесплатно';
  return (
    <div class="face">
      <div class="title">
        <span class="name">{card.name}</span>
        <span class="type">{TYPE_NAME[card.type]}</span>
      </div>
      <div class="effects">{effectsText(db, card.effects)}</div>
      <div class="meta small">
        <span class={affordable === false ? 'cant' : affordable && (chain || free) ? 'free' : ''}>
          {affordable && <span class="can-mark">✓ </span>}
          {chain ? 'бесплатно по цепочке' : <>цена: {price}</>}
        </span>
        {card.chainsTo && <span class="muted"> · даром потом: {card.chainsTo.map((id) => db.card(id).name).join(', ')}</span>}
      </div>
    </div>
  );
}

function payLabel(db: Db, p: PaymentOption): ComponentChildren {
  if (p.left === 0 && p.right === 0) return p.total ? `${p.total}🪙` : 'бесплатно';
  const parts: ComponentChildren[] = [];
  if (p.left) parts.push(<>◀ {resList(db, p.trade.left)} за {p.left}🪙</>);
  if (p.right) parts.push(<>▶ {resList(db, p.trade.right)} за {p.right}🪙</>);
  return joined(parts, ', ');
}

/** Why player `i` cannot pay `cost` this turn: coins or resources. */
function shortfall(db: Db, state: GameState, i: number, cost: Cost): string {
  const coins = state.players[i]!.coins;
  const need = coinsNeeded(db, state, i, cost);
  if (need === undefined) return 'не хватает ресурсов, и у соседей их не купить';
  const what = need > (cost.coins ?? 0) ? 'не хватает монет на покупку у соседей' : 'не хватает монет';
  return `${what}: нужно ${need}🪙, у вас ${coins}🪙`;
}

function CardActions(props: {
  db: Db;
  state: GameState;
  i: number;
  me: PlayerState;
  o: CardOptions;
  hasStage: boolean;
  stageNo: number;
  onChoose: (c: Choice, pay?: PaymentOption) => void;
}) {
  const { o, me } = props;
  const built = me.city.includes(o.card);
  return (
    <div class="actions">
      {built ? (
        <div class="small muted">Такая карта уже есть в городе.</div>
      ) : o.build.length === 0 ? (
        <div class="small muted">Построить нельзя: {shortfall(props.db, props.state, props.i, props.db.card(o.card).cost)}.</div>
      ) : (
        o.build.slice(0, 3).map((p, k) => (
          <button key={`b${k}`} class="primary" onClick={() => props.onChoose({ action: 'build', card: o.card, trade: p.trade }, p)}>
            Построить{(o.build.length > 1 || p.total > 0) && <>: {payLabel(props.db, p)}</>}
          </button>
        ))
      )}
      {props.hasStage &&
        (o.stage.length ? (
          o.stage.slice(0, 2).map((p, k) => (
            <button key={`s${k}`} onClick={() => props.onChoose({ action: 'stage', card: o.card, trade: p.trade }, p)}>
              Стадия {props.stageNo}
              {p.total > 0 && <>: {payLabel(props.db, p)}</>}
            </button>
          ))
        ) : (
          <div class="small muted">
            Стадию {props.stageNo} не построить: {shortfall(props.db, props.state, props.i, nextStageCost(props.db, me)!)}.
          </div>
        ))}
      <button onClick={() => props.onChoose({ action: 'sell', card: o.card })}>Продать за 3🪙</button>
    </div>
  );
}

function productionText(db: Db, p: PlayerState, tradableOnly = false): ComponentChildren {
  const prod = production(db, p, tradableOnly);
  const parts = [resList(db, prod.fixed), ...prod.choices.map((c) => resChoice(db, c))].filter(Boolean);
  return parts.length ? joined(parts, ' ') : '—';
}

function CityView({ db, state, i, title = true }: { db: Db; state: GameState; i: number; title?: boolean }) {
  const p = state.players[i]!;
  const civ = db.civ(p.civ);
  const score = scorePlayer(db, state, i);
  return (
    <div class="city">
      {title && (
        <h2>
          {civ.name} <span class="muted small">{p.name}</span>
        </h2>
      )}
      <div class="small">Производство: {productionText(db, p)}</div>
      <div class="small">
        {p.coins}🪙 · {military(db, state, i)}⚔️ · конфликты: {p.conflicts.length ? p.conflicts.join(' ') : '—'}
      </div>
      <div class="small">
        {civ.monument.name}:
        <div class="stage-list">
          {civ.monument.stages.map((s, k) => (
            <span key={k} class={k < p.stages ? 'stage done' : 'stage'}>
              {k + 1}: {costText(db, s.cost)} → {effectsText(db, s.effects)}
            </span>
          ))}
        </div>
      </div>
      <ScoreLine s={score} />
      {TYPE_ORDER.map((t) => {
        const cards = p.city.map((id) => db.card(id)).filter((c) => c.type === t);
        if (!cards.length) return null;
        return (
          <div key={t} class="group">
            <div class={`group-title t-${t}`}>{TYPE_NAME[t]}</div>
            {cards.map((c) => (
              <div key={c.id} class="mini">
                <span>{c.name}</span> <span class="muted">{effectsText(db, c.effects)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ScoreLine({ s }: { s: ScoreBreakdown }) {
  return (
    <div class="small score-line">
      Очки: <b>{s.total}⭐</b> (армия {s.military}, монеты {s.coins}, сооружение {s.monument}, культура {s.culture},
      торговля {s.trade}, династии {s.dynasty}, наука {s.science})
    </div>
  );
}

function Others(props: { db: Db; state: GameState; me: number; online?: (id: string) => boolean }) {
  const { db, state, me, online } = props;
  const pid = state.players[me]?.id ?? '';
  const n = state.players.length;
  const order = [leftOf(n, me), rightOf(n, me), ...state.players.map((_, k) => k)].filter(
    (k, idx, arr) => k !== me && arr.indexOf(k) === idx,
  );
  return (
    <div>
      {order.map((k) => {
        const p = state.players[k]!;
        const where = k === leftOf(n, me) ? '◀ слева' : k === rightOf(n, me) ? 'справа ▶' : '';
        return (
          <details key={p.id} class="other" open={!!where}>
            <summary>
              {online && <span class={`dot ${online(p.id) ? 'on' : ''}`} title={online(p.id) ? 'В сети' : 'Не в сети'} />}
              <b>{p.name}</b> · {db.civ(p.civ).name} {where && <span class="tag">{where}</span>}
              <span class="stats">
                {p.coins}🪙 {military(db, state, k)}⚔️ {p.stages}/3🏛️
              </span>
            </summary>
            <LastAction db={db} state={state} k={k} pid={pid} />
            <div class="small">Продаёт: {productionText(db, p, true)}</div>
            {TYPE_ORDER.map((t) => {
              const cards = p.city.map((id) => db.card(id)).filter((c) => c.type === t);
              if (!cards.length) return null;
              return (
                <div key={t} class="small">
                  <span class={`chip t-${t}`}>{TYPE_NAME[t]}</span> {cards.map((c) => c.name).join(', ')}
                </div>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}

function LastAction({ db, state, k, pid }: { db: Db; state: GameState; k: number; pid: string }) {
  const id = state.players[k]!.id;
  const e = [...state.log].reverse().find((x) => x.player === id);
  if (!e) return null;
  return (
    <div class="small last-action">
      Последний ход ({EPOCH_NAME[e.epoch]}, {e.turn}): <ActionText db={db} state={state} e={e} pid={pid} />
    </div>
  );
}

/** Every move of the game, turn by turn, with all cards shown. */
function GameLog({ db, state, pid }: { db: Db; state: GameState; pid: string }) {
  const turns: LogEntry[][] = [];
  for (const e of state.log) {
    const cur = turns[turns.length - 1];
    if (cur && cur[0]!.epoch === e.epoch && cur[0]!.turn === e.turn) cur.push(e);
    else turns.push([e]);
  }
  return (
    <section class="game-log">
      {turns.map((t) => (
        <div key={`${t[0]!.epoch}-${t[0]!.turn}`}>
          <h3>
            Эпоха {EPOCH_NAME[t[0]!.epoch]} · ход {t[0]!.turn}
          </h3>
          <ul class="summary-list">
            {t.map((e) => (
              <li key={e.player}>
                <b>{state.players.find((p) => p.id === e.player)?.name}</b>{' '}
                <ActionText db={db} state={state} e={e} pid={pid} reveal />
              </li>
            ))}
          </ul>
          {t[0]!.turn === TURNS_PER_EPOCH && !!state.battles?.length && (
            <>
              <h3>Конфликты эпохи {EPOCH_NAME[t[0]!.epoch]}</h3>
              <ConflictResults db={db} state={state} epoch={t[0]!.epoch} />
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function Final({ db, state, me, onLeave }: { db: Db; state: GameState; me: number; onLeave: () => void }) {
  const [showLog, setShowLog] = useState(false);
  const scores = scoreGame(db, state);
  const order = ranking(db, state);
  const rows: [keyof ScoreBreakdown, string][] = [
    ['military', '⚔️ Армия'],
    ['coins', '🪙 Монеты'],
    ['monument', '🏛️ Сооружение'],
    ['culture', '🎭 Культура'],
    ['trade', '⚖️ Торговля'],
    ['dynasty', '👑 Династии'],
    ['science', '🔬 Наука'],
    ['total', 'Итого'],
  ];
  return (
    <main class="screen">
      <h1>{order[0] === me ? 'Победа!' : `Победил(а) ${state.players[order[0]!]!.name}`}</h1>
      <div class="table-wrap">
        <table class="scores">
          <thead>
            <tr>
              <th />
              {order.map((k) => (
                <th key={k} class={k === me ? 'me' : ''}>
                  {state.players[k]!.name}
                  <div class="muted small">{db.civ(state.players[k]!.civ).name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label]) => (
              <tr key={key} class={key === 'total' ? 'total' : ''}>
                <td>{label}</td>
                {order.map((k) => (
                  <td key={k}>{scores[k]![key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section class="final-cities">
        {order.map((k) => (
          <details key={state.players[k]!.id} class="other">
            <summary>
              <b>{state.players[k]!.name}</b> · {db.civ(state.players[k]!.civ).name}
              <span class="stats">{scores[k]!.total}⭐</span>
            </summary>
            <CityView db={db} state={state} i={k} title={false} />
          </details>
        ))}
      </section>
      <button onClick={() => setShowLog(!showLog)}>{showLog ? 'Скрыть ходы' : `Все ходы партии (${state.log.length})`}</button>
      {showLog && <GameLog db={db} state={state} pid={state.players[me]?.id ?? ''} />}
      <button class="primary" onClick={onLeave}>
        В меню
      </button>
    </main>
  );
}

function Spectator({ db, state, onLeave }: { db: Db; state: GameState; onLeave: () => void }) {
  if (state.phase === 'over') return <Final db={db} state={state} me={-1} onLeave={onLeave} />;
  return (
    <main class="screen">
      <p class="muted">Игра уже идёт, вы наблюдаете.</p>
      <Others db={db} state={state} me={-1} />
      <button onClick={onLeave}>Выйти</button>
    </main>
  );
}

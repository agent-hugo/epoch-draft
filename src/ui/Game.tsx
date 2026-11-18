import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Db } from '../engine/db';
import { leftOf, production, rightOf, type PaymentOption } from '../engine/payment';
import { handOptions, nextStageCost, type CardOptions } from '../engine/rules';
import { military, ranking, scoreGame, scorePlayer } from '../engine/scoring';
import type { CardDef, Choice, GameState, PlayerState, ScoreBreakdown } from '../engine/types';
import type { ClientSnapshot, Player } from '../net/client';
import { playerView } from '../net/protocol';
import { Reference } from './Reference';
import { settings } from './storage';
import { costText, effectsText, EPOCH_NAME, resList, RES_ICON, TYPE_NAME, TYPE_ORDER } from './format';

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
  onLeave: () => void;
}

export function Game({ db, room, pid, snap, player, onLeave }: Props) {
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

  if (i < 0) return <Spectator db={db} state={view} onLeave={onLeave} />;
  if (pub.phase === 'over') return <Final db={db} state={view} me={i} onLeave={onLeave} />;

  const me = view.players[i]!;
  const waiting = pub.players.filter((p) => !pub.chosen.includes(p.id)).map((p) => p.name);

  return (
    <div class="game">
      <header class="bar">
        <div>
          <b>Эпоха {EPOCH_NAME[pub.epoch]}</b> · ход {pub.turn}/6
        </div>
        <div class="stats">
          <span>{me.coins}🪙</span>
          <span>{military(db, view, i)}⚔️</span>
          <span>{scorePlayer(db, view, i).total}⭐</span>
        </div>
      </header>
      {!snap.connected && <div class="banner warn">Нет связи с брокером, переподключаемся…</div>}
      {snap.connected && !hostOnline && <div class="banner warn">Хост не в сети: игра продолжится, когда он вернётся.</div>}
      <div class="waiting small muted">{waiting.length ? `Ждём: ${waiting.join(', ')}` : 'Все сделали выбор'}</div>

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
          />
        )}
        {tab === 'city' && <CityView db={db} state={view} i={i} />}
        {tab === 'others' && <Others db={db} state={view} me={i} />}
        {tab === 'help' && <Reference db={db} highlightCiv={me.civ} />}
        {tab === 'settings' && <GameSettings room={room} player={player} onLeave={onLeave} />}
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
    </div>
  );
}

function GameSettings({ room, player, onLeave }: { room: string; player: Player; onLeave: () => void }) {
  const [name, setName] = useState(settings.name);
  const [ending, setEnding] = useState(false);
  const rename = () => {
    const n = name.trim();
    if (!n || n === settings.name) return;
    settings.name = n;
    player.rename(n);
  };
  const end = () => {
    if (!confirm('Завершить игру для всех? Партия будет удалена, продолжить её будет нельзя.')) return;
    setEnding(true);
    void player.endGame().catch(() => setEnding(false));
  };
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
          rename();
        }}
      >
        <input value={name} maxLength={24} aria-label="Ваше имя" onInput={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={!name.trim() || name.trim() === settings.name}>
          Сменить имя
        </button>
      </form>
      <button onClick={onLeave}>Выйти в меню</button>
      <p class="small muted">Остальные будут ждать вашего хода, пока вы не вернётесь по коду комнаты.</p>
      <button class="danger" disabled={ending} onClick={end}>
        {ending ? 'Завершаем…' : 'Завершить игру для всех'}
      </button>
      <p class="small muted">Удаляет партию у всех участников. Нажать может любой игрок.</p>
      <a class="small" href="https://github.com/agent-hugo/epoch-draft" target="_blank" rel="noopener">
        Проект на GitHub
      </a>
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
  onChoose: (c: Choice) => void;
}) {
  const { db, view, i, chosen } = props;
  const [open, setOpen] = useState<string>();
  const [sent, setSent] = useState<Choice>();
  const key = `${view.epoch}-${view.turn}`;
  useEffect(() => {
    setOpen(undefined);
    setSent(undefined);
  }, [key]);

  if (!props.ready) return <p class="muted">Получаем карты…</p>;
  const me = view.players[i]!;
  const options = handOptions(db, view, i);
  const civ = db.civ(me.civ);
  const stageCost = nextStageCost(db, me);
  const choose = (c: Choice) => {
    setSent(c);
    props.onChoose(c);
  };
  const pendingSend = sent && JSON.stringify(sent) !== JSON.stringify(chosen);

  return (
    <div>
      {chosen && (
        <div class="banner ok">
          {choiceLabel(db, chosen)}. Пока ходят остальные, выбор можно изменить.
        </div>
      )}
      {pendingSend && !props.error && <div class="banner">Отправляем…</div>}
      {props.error && <div class="banner warn">Ход не принят: {props.error}</div>}

      <div class="monument small">
        <b>{civ.monument.name}</b>: стадия {me.stages}/3
        {stageCost && (
          <>
            {' '}
            · следующая: {costText(stageCost)} → {effectsText(civ.monument.stages[me.stages]!.effects)}
          </>
        )}
      </div>

      <ul class="cards">
        {options.map((o) => {
          const card = db.card(o.card);
          const isChosen = chosen?.card === o.card;
          return (
            <li key={o.card} class={`card t-${card.type} ${isChosen ? 'chosen' : ''}`}>
              <button class="card-head" onClick={() => setOpen(open === o.card ? undefined : o.card)}>
                <CardFace db={db} card={card} chain={o.chain} affordable={o.build.length > 0} />
              </button>
              {open === o.card && (
                <CardActions
                  db={db}
                  me={me}
                  o={o}
                  hasStage={!!stageCost}
                  stageNo={me.stages + 1}
                  onChoose={(c) => {
                    choose(c);
                    setOpen(undefined);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
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
  return (
    <div class="face">
      <div class="title">
        <span class="name">{card.name}</span>
        <span class="type">{TYPE_NAME[card.type]}</span>
      </div>
      <div class="effects">{effectsText(card.effects)}</div>
      <div class="meta small">
        <span class={affordable === false ? 'cant' : ''}>
          {chain ? 'бесплатно по цепочке' : `цена: ${costText(card.cost)}`}
        </span>
        {card.chainsTo && <span class="muted"> · даром потом: {card.chainsTo.map((id) => db.card(id).name).join(', ')}</span>}
      </div>
    </div>
  );
}

function payLabel(p: PaymentOption): string {
  if (p.left === 0 && p.right === 0) return p.total ? `${p.total}🪙` : 'бесплатно';
  const parts = [];
  if (p.left) parts.push(`◀ ${resList(p.trade.left)} за ${p.left}🪙`);
  if (p.right) parts.push(`▶ ${resList(p.trade.right)} за ${p.right}🪙`);
  return parts.join(', ');
}

function CardActions(props: {
  db: Db;
  me: PlayerState;
  o: CardOptions;
  hasStage: boolean;
  stageNo: number;
  onChoose: (c: Choice) => void;
}) {
  const { o, me } = props;
  const built = me.city.includes(o.card);
  return (
    <div class="actions">
      {built ? (
        <div class="small muted">Такая карта уже есть в городе.</div>
      ) : o.build.length === 0 ? (
        <div class="small muted">Построить нельзя: не хватает ресурсов или монет.</div>
      ) : (
        o.build.slice(0, 3).map((p, k) => (
          <button key={`b${k}`} class="primary" onClick={() => props.onChoose({ action: 'build', card: o.card, trade: p.trade })}>
            Построить{o.build.length > 1 || p.total ? `: ${payLabel(p)}` : ''}
          </button>
        ))
      )}
      {props.hasStage &&
        (o.stage.length ? (
          o.stage.slice(0, 2).map((p, k) => (
            <button key={`s${k}`} onClick={() => props.onChoose({ action: 'stage', card: o.card, trade: p.trade })}>
              Стадия {props.stageNo}
              {p.total ? `: ${payLabel(p)}` : ''}
            </button>
          ))
        ) : (
          <div class="small muted">На стадию сооружения не хватает ресурсов.</div>
        ))}
      <button onClick={() => props.onChoose({ action: 'sell', card: o.card })}>Продать за 3🪙</button>
    </div>
  );
}

function productionText(db: Db, p: PlayerState): string {
  const prod = production(db, p);
  const fixed = resList(prod.fixed);
  const choices = prod.choices.map((c) => c.map((r) => RES_ICON[r]).join('/'));
  return [fixed, ...choices].filter(Boolean).join(' ') || '—';
}

function CityView({ db, state, i }: { db: Db; state: GameState; i: number }) {
  const p = state.players[i]!;
  const civ = db.civ(p.civ);
  const score = scorePlayer(db, state, i);
  return (
    <div class="city">
      <h2>
        {civ.name} <span class="muted small">{p.name}</span>
      </h2>
      <div class="small">Производство: {productionText(db, p)}</div>
      <div class="small">
        {p.coins}🪙 · {military(db, state, i)}⚔️ · конфликты: {p.conflicts.length ? p.conflicts.join(' ') : '—'}
      </div>
      <div class="small">
        {civ.monument.name}:{' '}
        {civ.monument.stages.map((s, k) => (
          <span key={k} class={k < p.stages ? 'stage done' : 'stage'}>
            {k + 1}: {effectsText(s.effects)}
          </span>
        ))}
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
                <span>{c.name}</span> <span class="muted">{effectsText(c.effects)}</span>
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
      Сейчас: <b>{s.total}⭐</b> (армия {s.military}, монеты {s.coins}, сооружение {s.monument}, культура {s.culture},
      торговля {s.trade}, династии {s.dynasty}, наука {s.science})
    </div>
  );
}

function Others({ db, state, me }: { db: Db; state: GameState; me: number }) {
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
              <b>{p.name}</b> · {db.civ(p.civ).name} {where && <span class="tag">{where}</span>}
              <span class="stats">
                {p.coins}🪙 {military(db, state, k)}⚔️ {p.stages}/3🏛️
              </span>
            </summary>
            <div class="small">Продаёт: {resList(production(db, p, true).fixed) || '—'}{' '}
              {production(db, p, true).choices.map((c) => c.map((r) => RES_ICON[r]).join('/')).join(' ')}
            </div>
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

function Final({ db, state, me, onLeave }: { db: Db; state: GameState; me: number; onLeave: () => void }) {
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

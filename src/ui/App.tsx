import { useEffect, useMemo, useState } from 'preact/hooks';
import { MAX_PLAYERS, MIN_PLAYERS, type Db } from '../engine/db';
import { Player, replacedByBot, type ClientSnapshot } from '../net/client';
import { Host } from '../net/host';
import { Bus } from '../net/mqtt';
import { normalizeRoom, randomRoomCode, topics, type LobbyMsg } from '../net/protocol';
import { getWorld, worldDb, worlds } from '../worlds';
import { effectsText, joined, ResIcon } from './format';
import { Game } from './Game';
import { Reference } from './Reference';
import { decodeInvite, inviteHash } from './invite';
import { RoomList } from './Rooms';
import { SeatList } from './SeatList';
import { settings } from './storage';

function readHash(): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ''));
}

/**
 * Applies a token from an invite link (`#i=...`, or the older plain `#t=...`)
 * and removes it from the address bar, leaving only the room.
 */
function consumeTokenFromHash(): void {
  const h = readHash();
  const invite = decodeInvite(h.get('i'));
  const t = invite.token ?? h.get('t');
  if (!t && !h.has('i')) return;
  if (t) settings.token = t;
  h.delete('i');
  h.delete('t');
  if (invite.room) h.set('room', invite.room);
  history.replaceState(null, '', `${location.pathname}${location.search}${h.toString() ? `#${h}` : ''}`);
}

export function App() {
  consumeTokenFromHash();
  const [room, setRoom] = useState(() => normalizeRoom(readHash().get('room') ?? ''));
  // Settings are forced until a name and a token are set; otherwise they are
  // opened from the home screen as their own history entry (#settings), so
  // that the back button leaves them instead of returning to an earlier page.
  const [setup, setSetup] = useState(() => !settings.token || !settings.name);
  const [inSettings, setInSettings] = useState(() => readHash().has('settings'));

  useEffect(() => {
    const onHash = () => {
      consumeTokenFromHash();
      setRoom(normalizeRoom(readHash().get('room') ?? ''));
      setInSettings(readHash().has('settings'));
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = (code: string) => {
    location.hash = code ? `room=${code}` : '';
  };

  // Help is an overlay, so opening it does not unmount the room (and drop
  // the broker connection) underneath.
  // Help shows the world of the room, if known.
  const [help, setHelp] = useState<{ world?: string }>();
  const onHelp = (world?: string) => setHelp({ world });

  const openSettings = () => {
    history.pushState({ settings: true }, '', '#settings');
    setInSettings(true);
  };
  const closeSettings = () => {
    setSetup(false);
    if (!readHash().has('settings')) return;
    // Opened from the home screen: step back to it. Opened by a link or a
    // reload: there is nothing of ours behind, so replace the entry instead.
    if (history.state?.settings) history.back();
    else {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      setInSettings(false);
    }
  };

  let screen;
  if (setup || inSettings)
    screen = <Settings onDone={closeSettings} onBack={setup ? undefined : closeSettings} onHelp={onHelp} />;
  else if (!room) screen = <Home onEnter={go} onSettings={openSettings} onHelp={onHelp} />;
  else screen = <Room key={room} room={room} onLeave={() => go('')} onHelp={onHelp} />;
  return (
    <>
      {screen}
      {help && <HelpOverlay world={help.world} onClose={() => setHelp(undefined)} />}
    </>
  );
}

// The world last looked at in the help outside a room.
let helpWorld: string | undefined;

function HelpOverlay({ world, onClose }: { world?: string; onClose: () => void }) {
  // Inside a room the help shows the room's world; elsewhere any world can be browsed.
  const [picked, setPicked] = useState(() => getWorld(helpWorld).id);
  const shown = world ?? picked;
  return (
    <div class="game overlay">
      <header class="bar">
        <b>Справка</b>
        <button class="close" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <main class="tab-body">
        {!world && worlds.length > 1 && (
          <WorldSelect class="help-worlds" value={shown} onChange={(id) => setPicked((helpWorld = id))} />
        )}
        <Reference db={worldDb(shown)} />
      </main>
    </div>
  );
}

/** The world picker: a drop-down list wherever a world can be chosen. */
function WorldSelect(props: { value: string; onChange: (id: string) => void; class?: string }) {
  return (
    <select
      class={`world-select ${props.class ?? ''}`}
      aria-label="Мир"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      {worlds.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

function HelpButton({ onHelp }: { onHelp: (world?: string) => void }) {
  return (
    <button class="link" onClick={() => onHelp()}>
      📖 Справка по игре
    </button>
  );
}

function Settings(props: { onDone: () => void; onBack?: () => void; onHelp: (world?: string) => void }) {
  const { onDone, onBack, onHelp } = props;
  const [name, setName] = useState(settings.name);
  const [token, setToken] = useState(settings.token);
  const [url, setUrl] = useState(settings.brokerUrl);
  const ok = name.trim() && token.trim() && url.trim();
  return (
    <main class="screen narrow">
      <h1>Epoch Draft</h1>
      <h2>Настройки</h2>
      <label>
        Ваше имя
        <input value={name} maxLength={24} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
      </label>
      <label>
        Токен брокера
        <input
          type="password"
          value={token}
          onInput={(e) => setToken(e.currentTarget.value)}
          autoComplete="off"
        />
        <small>Его даёт тот, кто пригласил вас в игру. Хранится только на этом устройстве.</small>
      </label>
      <details>
        <summary>Адрес брокера</summary>
        <input value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
      </details>
      <button
        class="primary"
        disabled={!ok}
        onClick={() => {
          settings.name = name;
          settings.token = token;
          settings.brokerUrl = url;
          onDone();
        }}
      >
        Сохранить
      </button>
      {onBack && (
        <button class="link" onClick={onBack}>
          ← Назад без сохранения
        </button>
      )}
      <HelpButton onHelp={onHelp} />
    </main>
  );
}

function Home(props: { onEnter: (room: string) => void; onSettings: () => void; onHelp: (world?: string) => void }) {
  const { onEnter, onSettings } = props;
  const [code, setCode] = useState('');
  return (
    <main class="screen narrow">
      <h1>Epoch Draft</h1>
      <p class="muted">Здравствуйте, {settings.name}!</p>
      <button
        class="primary"
        onClick={() => {
          const room = randomRoomCode();
          settings.setHost(room);
          onEnter(room);
        }}
      >
        Создать игру
      </button>
      <div class="or">или</div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          const c = normalizeRoom(code);
          if (c) onEnter(c);
        }}
      >
        <input
          placeholder="Код комнаты"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
          autoCapitalize="characters"
        />
        <button type="submit" disabled={!normalizeRoom(code)}>
          Войти
        </button>
      </form>
      <button class="link" onClick={onSettings}>
        Настройки
      </button>
      <HelpButton onHelp={props.onHelp} />
      <RoomList onEnter={onEnter} />
    </main>
  );
}

interface Conn {
  bus: Bus;
  player: Player;
  host?: Host;
  error?: string;
}

function Room({ room, onLeave, onHelp }: { room: string; onLeave: () => void; onHelp: (world?: string) => void }) {
  const pid = settings.playerId;
  const [conn, setConn] = useState<Conn>();
  const [snap, setSnap] = useState<ClientSnapshot>();
  const [error, setError] = useState<string>();
  const [, force] = useState(0);

  useEffect(() => {
    const bus = new Bus(
      { url: settings.brokerUrl, token: settings.token },
      { will: { topic: topics.presence(room, pid), payload: 'offline' } },
    );
    const player = new Player(bus, room, pid, settings.name);
    const c: Conn = { bus, player };
    let alive = true;
    const unsub = player.subscribe((s) => alive && setSnap(s));
    bus
      .ready()
      .then(async () => {
        if (settings.isHost(room)) {
          c.host = new Host(worldDb, bus, room, pid);
          await c.host.start();
        }
        player.start();
        if (alive) setConn({ ...c });
      })
      .catch((e: Error) => alive && setError(`Не удалось подключиться к брокеру: ${e.message}`));
    return () => {
      alive = false;
      unsub();
      // A player out of the room has already removed its retained messages.
      const bye = player.gone ? Promise.resolve() : bus.publish(topics.presence(room, pid), 'offline', true);
      void bye.finally(() => bus.end());
    };
  }, [room, pid]);

  const closed = snap?.closed;
  useEffect(() => {
    if (closed) settings.clearHost(room);
  }, [closed, room]);

  const online = !!snap?.connected && !error;
  const dot = <span class={`conn-dot ${online ? 'on' : 'off'}`} title={online ? 'Связь с брокером есть' : 'Нет связи с брокером'} />;

  let body;
  if (error)
    body = (
      <main class="screen narrow">
        <p class="error">{error}</p>
        <button onClick={onLeave}>Назад</button>
      </main>
    );
  else if (closed)
    body = (
      <main class="screen narrow">
        <h1>Игра завершена</h1>
        <p class="muted">
          {closed.by ? `${closed.by} завершил(а) игру` : 'Игру завершили'} в комнате {room}. Всё её состояние удалено.
        </p>
        <button class="primary" onClick={onLeave}>
          В меню
        </button>
      </main>
    );
  else if (snap && replacedByBot(snap, pid))
    body = (
      <main class="screen narrow">
        <h1>Вас заменили ботом</h1>
        <p class="muted">Хост отдал ваше место в комнате {room} боту, игра продолжается без вас.</p>
        <button class="primary" onClick={onLeave}>
          В меню
        </button>
      </main>
    );
  else if (!conn || !snap) body = <main class="screen narrow muted">Подключение…</main>;
  else if (snap.lobby?.started && snap.pub)
    body = (
      <Game db={worldDb(snap.pub.world ?? snap.lobby.world)} room={room} pid={pid} snap={snap} player={conn.player} host={conn.host} onLeave={onLeave} />
    );
  else
    body = (
      <Lobby
        room={room}
        pid={pid}
        snap={snap}
        host={conn.host}
        player={conn.player}
        onLeave={onLeave}
        onHelp={onHelp}
        refresh={() => force((x) => x + 1)}
      />
    );

  return (
    <>
      {dot}
      {body}
    </>
  );
}

function Lobby(props: {
  room: string;
  pid: string;
  snap: ClientSnapshot;
  host?: Host;
  player: Player;
  onLeave: () => void;
  onHelp: (world?: string) => void;
  refresh: () => void;
}) {
  const { room, pid, snap, host } = props;
  const [withToken, setWithToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const lobby = snap.lobby;
  const link = useMemo(() => {
    return `${location.origin}${location.pathname}#${inviteHash(room, withToken ? settings.token : undefined)}`;
  }, [room, withToken]);

  if (!lobby)
    return (
      <main class="screen narrow">
        <p class="muted">Ждём хоста комнаты {room}…</p>
        <p class="muted small">Если комнаты не существует, проверьте код.</p>
        <button onClick={props.onLeave}>Назад</button>
        <HelpButton onHelp={props.onHelp} />
      </main>
    );

  const inLobby = lobby.players.some((p) => p.id === pid);
  const world = getWorld(lobby.world);
  const db = worldDb(world.id);
  const manual = lobby.civMode === 'manual';
  const missing = host?.missingCivs() ?? [];
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Epoch Draft', url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <main class="screen narrow">
      <h1>Комната</h1>
      <div class="room-code">{room}</div>
      <div class="invite">
        <button onClick={share}>{copied ? 'Ссылка скопирована' : 'Пригласить'}</button>
        <label class="check">
          <input type="checkbox" checked={withToken} onChange={(e) => setWithToken(e.currentTarget.checked)} />
          добавить токен в ссылку
        </label>
      </div>

      <h2>
        Игроки <span class="muted">{lobby.players.length}/{MAX_PLAYERS}</span>
      </h2>
      <SeatList
        players={lobby.players}
        onApply={
          host &&
          ((ids) => {
            host.reorder(ids);
            props.refresh();
          })
        }
        row={(p) => (
          <>
            <span class={`dot ${p.bot || snap.presence[p.id] ? 'on' : ''}`} />
            <span class="seat-name">{p.name}</span>
            {manual && <span class="muted small">{p.civ ? db.civ(p.civ).name : p.bot ? 'случайно' : 'выбирает…'}</span>}
            {p.id === lobby.host && <span class="tag">хост</span>}
            {p.id === pid && <span class="tag">вы</span>}
            {host && p.id !== lobby.host && (
              <button
                class="icon"
                aria-label="Убрать"
                onClick={() => {
                  host.removePlayer(p.id);
                  props.refresh();
                }}
              >
                ×
              </button>
            )}
          </>
        )}
      />
      {!inLobby && lobby.players.length >= MAX_PLAYERS && <p class="error">Комната заполнена.</p>}

      <h2>Мир</h2>
      {host && worlds.length > 1 ? (
        <>
          <WorldSelect
            value={world.id}
            onChange={(id) => {
              host.setWorld(id);
              props.refresh();
            }}
          />
          {world.description && <p class="small muted world-desc">{world.description}</p>}
        </>
      ) : (
        <p class="small">
          <b>{world.name}</b>
          {world.description && <span class="muted"> — {world.description}</span>}
        </p>
      )}

      <h2>Цивилизации</h2>
      {host ? (
        <div class="segmented" role="radiogroup" aria-label="Цивилизации">
          {(['random', 'manual'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={(lobby.civMode ?? 'random') === m}
              class={(lobby.civMode ?? 'random') === m ? 'active' : ''}
              onClick={() => {
                host.setCivMode(m);
                props.refresh();
              }}
            >
              {m === 'random' ? '🎲 Случайно' : '✋ Выбор игроков'}
            </button>
          ))}
        </div>
      ) : (
        <p class="muted small">{manual ? 'Каждый выбирает цивилизацию сам.' : 'Цивилизации раздаются случайно при старте.'}</p>
      )}
      {manual && inLobby && <CivPicker db={db} lobby={lobby} pid={pid} player={props.player} />}

      {host ? (
        <div class="stack">
          <button
            disabled={lobby.players.length >= MAX_PLAYERS}
            onClick={() => {
              host.addBot();
              props.refresh();
            }}
          >
            Добавить бота
          </button>
          <button
            class="primary"
            disabled={!host.canStart()}
            onClick={() => {
              host.startGame();
              props.refresh();
            }}
          >
            Начать игру
          </button>
          {lobby.players.length < MIN_PLAYERS && (
            <p class="muted small">
              Нужно от {MIN_PLAYERS} до {MAX_PLAYERS} игроков.
            </p>
          )}
          {missing.length > 0 && (
            <p class="muted small">Ещё не выбрали цивилизацию: {missing.map((p) => p.name).join(', ')}.</p>
          )}
        </div>
      ) : (
        <p class="muted">Ждём, пока хост начнёт игру…</p>
      )}
      <button class="link" onClick={props.onLeave}>
        Выйти
      </button>
      <HelpButton onHelp={() => props.onHelp(world.id)} />
    </main>
  );
}

/** Civilizations to pick from in the lobby (manual mode); bots get the ones left. */
function CivPicker({ db, lobby, pid, player }: { db: Db; lobby: LobbyMsg; pid: string; player: Player }) {
  const mine = lobby.players.find((p) => p.id === pid)?.civ;
  const owner = (id: string) => lobby.players.find((p) => p.civ === id && p.id !== pid);
  const free = [...db.civs.keys()].filter((id) => !owner(id) && id !== mine);
  return (
    <div class="civ-picker">
      <ul>
        {[...db.civs.values()].map((c) => {
          const by = owner(c.id);
          const stages = c.monument.stages;
          return (
            <li key={c.id}>
              <button
                class={`civ-option ${c.id === mine ? 'mine' : ''}`}
                disabled={!!by}
                aria-pressed={c.id === mine}
                onClick={() => player.pickCiv(c.id === mine ? null : c.id)}
              >
                <div>
                  {c.img && <img class="civ-img" src={c.img} alt="" />}
                  <b>{c.name}</b> · старт: <ResIcon db={db} id={c.start} /> {db.resources.get(c.start)?.name}
                  {by && <span class="muted"> · {by.name}</span>}
                  {c.id === mine && <span class="tag">ваша</span>}
                </div>
                <div class="small muted">
                  {c.monument.name}: {joined(stages.map((s) => effectsText(db, s.effects)), ' → ')}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        class="link"
        disabled={!free.length}
        onClick={() => player.pickCiv(free[Math.floor(Math.random() * free.length)]!)}
      >
        🎲 Выбрать случайную
      </button>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'preact/hooks';
import { gameData } from '../data';
import { Db } from '../engine/db';
import { Player, type ClientSnapshot } from '../net/client';
import { Host } from '../net/host';
import { Bus } from '../net/mqtt';
import { normalizeRoom, randomRoomCode, topics } from '../net/protocol';
import { Game } from './Game';
import { Reference } from './Reference';
import { settings } from './storage';

export const db = new Db(gameData);

function readHash(): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ''));
}

/** Applies a token from an invite link and removes it from the address bar. */
function consumeTokenFromHash(): void {
  const h = readHash();
  const t = h.get('t');
  if (!t) return;
  settings.token = t;
  h.delete('t');
  history.replaceState(null, '', `${location.pathname}${location.search}${h.toString() ? `#${h}` : ''}`);
}

export function App() {
  consumeTokenFromHash();
  const [room, setRoom] = useState(() => normalizeRoom(readHash().get('room') ?? ''));
  const [showSettings, setShowSettings] = useState(() => !settings.token || !settings.name);

  useEffect(() => {
    const onHash = () => {
      consumeTokenFromHash();
      setRoom(normalizeRoom(readHash().get('room') ?? ''));
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = (code: string) => {
    location.hash = code ? `room=${code}` : '';
  };

  // Help is an overlay, so opening it does not unmount the room (and drop
  // the broker connection) underneath.
  const [help, setHelp] = useState(false);
  const onHelp = () => setHelp(true);

  let screen;
  if (showSettings) screen = <Settings onDone={() => setShowSettings(false)} onHelp={onHelp} />;
  else if (!room) screen = <Home onEnter={go} onSettings={() => setShowSettings(true)} onHelp={onHelp} />;
  else screen = <Room key={room} room={room} onLeave={() => go('')} onHelp={onHelp} />;
  return (
    <>
      {screen}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div class="game overlay">
      <header class="bar">
        <b>Справка</b>
        <button class="close" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <main class="tab-body">
        <Reference db={db} />
      </main>
    </div>
  );
}

function HelpButton({ onHelp }: { onHelp: () => void }) {
  return (
    <button class="link" onClick={onHelp}>
      📖 Справка по игре
    </button>
  );
}

function Settings({ onDone, onHelp }: { onDone: () => void; onHelp: () => void }) {
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
      <HelpButton onHelp={onHelp} />
    </main>
  );
}

function Home(props: { onEnter: (room: string) => void; onSettings: () => void; onHelp: () => void }) {
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
    </main>
  );
}

interface Conn {
  bus: Bus;
  player: Player;
  host?: Host;
  error?: string;
}

function Room({ room, onLeave, onHelp }: { room: string; onLeave: () => void; onHelp: () => void }) {
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
          c.host = new Host(db, bus, room, pid);
          await c.host.start();
        }
        player.start();
        if (alive) setConn({ ...c });
      })
      .catch((e: Error) => alive && setError(`Не удалось подключиться к брокеру: ${e.message}`));
    return () => {
      alive = false;
      unsub();
      // In a closed room the player has already removed its retained messages.
      const bye = player.snapshot.closed ? Promise.resolve() : bus.publish(topics.presence(room, pid), 'offline', true);
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
  else if (!conn || !snap) body = <main class="screen narrow muted">Подключение…</main>;
  else if (snap.lobby?.started && snap.pub)
    body = <Game db={db} room={room} pid={pid} snap={snap} player={conn.player} onLeave={onLeave} />;
  else
    body = (
      <Lobby
        room={room}
        pid={pid}
        snap={snap}
        host={conn.host}
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
  onLeave: () => void;
  onHelp: () => void;
  refresh: () => void;
}) {
  const { room, pid, snap, host } = props;
  const [withToken, setWithToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const lobby = snap.lobby;
  const link = useMemo(() => {
    const base = `${location.origin}${location.pathname}#room=${room}`;
    return withToken ? `${base}&t=${encodeURIComponent(settings.token)}` : base;
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
        Игроки <span class="muted">{lobby.players.length}/5</span>
      </h2>
      <ul class="players">
        {lobby.players.map((p) => (
          <li key={p.id}>
            <span class={`dot ${p.bot || snap.presence[p.id] ? 'on' : ''}`} />
            {p.name}
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
          </li>
        ))}
      </ul>
      {!inLobby && lobby.players.length >= 5 && <p class="error">Комната заполнена.</p>}

      {host ? (
        <div class="stack">
          <button
            disabled={lobby.players.length >= 5}
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
          {lobby.players.length < 3 && <p class="muted small">Нужно от 3 до 5 игроков.</p>}
        </div>
      ) : (
        <p class="muted">Ждём, пока хост начнёт игру…</p>
      )}
      <button class="link" onClick={props.onLeave}>
        Выйти
      </button>
      <HelpButton onHelp={props.onHelp} />
    </main>
  );
}

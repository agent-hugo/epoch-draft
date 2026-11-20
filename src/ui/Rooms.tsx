import { useEffect, useState } from 'preact/hooks';
import { MAX_PLAYERS } from '../engine/db';
import { deleteRoom } from '../net/client';
import { Bus } from '../net/mqtt';
import { roomOf, topics, type LobbyMsg } from '../net/protocol';
import { getWorld, worlds } from '../worlds';
import { ConfirmDialog, type Ask } from './dialog';
import { settings } from './storage';

interface RoomInfo {
  code: string;
  lobby: LobbyMsg;
  /** When the engine last moved the game on (ms since epoch), if known. */
  time?: number;
  /** The engine of the room runs right now: the leader's phone or a server. */
  engineOnline?: boolean;
}

function ago(time: number): string {
  const min = Math.floor((Date.now() - time) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн назад`;
  return new Date(time).toLocaleDateString('ru');
}

/**
 * Rooms on the broker, newest first: open games of others to join (while
 * their engine is online), and the rooms the player is in or has opened on
 * this device, to enter or delete. Other rooms are not shown.
 */
export function RoomList({ onEnter }: { onEnter: (room: string) => void }) {
  const pid = settings.playerId;
  const [bus, setBus] = useState<Bus>();
  const [rooms, setRooms] = useState<Map<string, RoomInfo>>();
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(new Set<string>());
  const [ask, setAsk] = useState<Ask>();

  useEffect(() => {
    const b = new Bus({ url: settings.brokerUrl, token: settings.token });
    let alive = true;
    // Collected until all SUBACKs, then rendered and kept up to date.
    const found = new Map<string, RoomInfo>();
    const closed = new Set<string>();
    const times = new Map<string, number>();
    // Who is online in which room: `${room}/${player}`.
    const online = new Set<string>();
    // Game servers online.
    const servers = new Set<string>();
    const running = (code: string, l: LobbyMsg) =>
      l.engine === l.owner ? online.has(`${code}/${l.owner}`) : servers.has(l.engine);
    let loaded = false;
    const show = () => {
      if (!alive || !loaded) return;
      const list = [...found].filter(([code]) => !closed.has(code));
      setRooms(new Map(list.map(([code, r]) => [code, { ...r, time: times.get(code), engineOnline: running(code, r.lobby) }])));
    };
    b.ready()
      .then(() =>
        Promise.all([
          b.subscribe(topics.lobbyAll, (t, p) => {
            const code = roomOf(t);
            if (p) found.set(code, { code, lobby: p as LobbyMsg });
            else found.delete(code);
            show();
          }),
          b.subscribe(topics.updatedAll, (t, p) => {
            if (typeof p === 'number' && p > 0) times.set(roomOf(t), p * 1000);
            else times.delete(roomOf(t));
            show();
          }),
          b.subscribe(topics.presenceAll, (t, p) => {
            const [, , pid, , room] = t.split('/');
            if (p === 'online') online.add(`${room}/${pid}`);
            else online.delete(`${room}/${pid}`);
            show();
          }),
          b.subscribe(topics.serverPresenceAll, (t, p) => {
            const code = t.split('/')[2]!;
            if (p === 'online') servers.add(code);
            else servers.delete(code);
            show();
          }),
          b.subscribe(topics.closedAll, (t, p) => {
            if (p) closed.add(roomOf(t));
            else closed.delete(roomOf(t));
            show();
          }),
        ]),
      )
      .then(() => {
        loaded = true;
        show();
      })
      .catch((e: Error) => alive && setError(`Не удалось загрузить комнаты: ${e.message}`));
    setBus(b);
    return () => {
      alive = false;
      void b.end();
    };
  }, []);

  const remove = (code: string) => {
    if (!bus) return;
    setDeleting((d) => new Set(d).add(code));
    settings.clearHost(code);
    settings.forget(code);
    void deleteRoom(bus, code, settings.name).catch(() =>
      setDeleting((d) => {
        const next = new Set(d);
        next.delete(code);
        return next;
      }),
    );
  };


  const sorted = rooms && [...rooms.values()].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  const visited = new Set(settings.visited);
  const plays = (l: LobbyMsg) => l.owner === pid || l.players.some((p) => p.id === pid);
  const open = sorted?.filter(
    ({ code, lobby: l, engineOnline }) => engineOnline && !plays(l) && !visited.has(code) && l.public && !l.started && !l.over && l.players.length < MAX_PLAYERS,
  );
  const mine = sorted?.filter(({ code, lobby }) => plays(lobby) || visited.has(code));

  const meta = ({ lobby, time }: RoomInfo) => {
    const ownerName = lobby.players.find((p) => p.id === lobby.owner)?.name;
    return (
      <div class="small muted">
        {lobby.players.length ? lobby.players.map((p) => p.name).join(', ') : 'игроков нет'}
        {ownerName && lobby.owner !== pid && <> · ведущий {ownerName}</>}
        {worlds.length > 1 && <> · {getWorld(lobby.world).name}</>}
        {time && <> · {ago(time)}</>}
      </div>
    );
  };

  return (
    <section class="rooms">
      {error ? (
        <>
          <h2>Комнаты</h2>
          <p class="error small">{error}</p>
        </>
      ) : !sorted ? (
        <>
          <h2>Комнаты</h2>
          <p class="muted small">Загружаем…</p>
        </>
      ) : (
        <>
          <h2>Открытые игры</h2>
          {!open!.length ? (
            <p class="muted small">Сейчас никто не набирает игроков в открытую игру.</p>
          ) : (
            <ul class="room-list">
              {open!.map((r) => (
                <li key={r.code}>
                  <div class="room-head">
                    <b class="room-list-code">{r.code}</b>
                    <span class="tag">
                      {r.lobby.players.length}/{MAX_PLAYERS}
                    </span>
                  </div>
                  {meta(r)}
                  <div class="row room-actions">
                    <button class="primary" aria-label={`Присоединиться к игре ${r.code}`} onClick={() => onEnter(r.code)}>
                      Присоединиться
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h2>Мои комнаты</h2>
          {!mine!.length ? (
            <p class="muted small">Комнат нет.</p>
          ) : (
            <ul class="room-list">
              {mine!.map((r) => {
                const { code, lobby } = r;
                const busy = deleting.has(code);
                return (
                  <li key={code}>
                    <div class="room-head">
                      <b class="room-list-code">{code}</b>
                      <span class="tag">{lobby.over ? 'игра окончена' : lobby.started ? 'идёт игра' : 'набор игроков'}</span>
                      {lobby.public && !lobby.started && <span class="tag">открытая</span>}
                      {lobby.owner === pid && <span class="tag">вы ведущий</span>}
                      {lobby.owner !== pid && plays(lobby) && <span class="tag">вы играете</span>}
                    </div>
                    {meta(r)}
                    <div class="row room-actions">
                      <button aria-label={`Войти в комнату ${code}`} disabled={busy} onClick={() => onEnter(code)}>
                        Войти
                      </button>
                      <button
                        class="danger"
                        aria-label={`Удалить комнату ${code}`}
                        disabled={busy}
                        onClick={() =>
                          setAsk({
                            text: `Удалить комнату ${code}? Игра в ней завершится у всех участников, всё её состояние будет удалено.`,
                            ok: 'Удалить',
                            danger: true,
                            run: () => remove(code),
                          })
                        }
                      >
                        {busy ? 'Удаляем…' : 'Удалить'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(undefined)} />}
    </section>
  );
}

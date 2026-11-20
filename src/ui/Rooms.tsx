import { useEffect, useState } from 'preact/hooks';
import { deleteRoom } from '../net/client';
import { Bus } from '../net/mqtt';
import { roomOf, topics, type LobbyMsg } from '../net/protocol';
import { getWorld, worlds } from '../worlds';
import { ConfirmDialog, type Ask } from './dialog';
import { settings } from './storage';

interface RoomInfo {
  code: string;
  lobby: LobbyMsg;
  /** When the lobby last changed, if the broker says. */
  time?: number;
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

/** Rooms on the broker, newest first, to enter or delete. */
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
    // Collected until both SUBACKs, then rendered and kept up to date.
    const found = new Map<string, RoomInfo>();
    const closed = new Set<string>();
    let loaded = false;
    const show = () => {
      if (alive && loaded) setRooms(new Map([...found].filter(([code]) => !closed.has(code))));
    };
    b.ready()
      .then(() =>
        Promise.all([
          b.subscribe(topics.lobbyAll, (t, p, meta) => {
            const code = roomOf(t);
            if (p) found.set(code, { code, lobby: p as LobbyMsg, time: meta.time });
            else found.delete(code);
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
    void deleteRoom(bus, code, settings.name).catch(() =>
      setDeleting((d) => {
        const next = new Set(d);
        next.delete(code);
        return next;
      }),
    );
  };

  const enter = (code: string, lobby: LobbyMsg) => {
    // The host role lives in this device's storage; bring it back if it was lost.
    if (lobby.host === pid) settings.setHost(code);
    onEnter(code);
  };

  const list = rooms && [...rooms.values()].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return (
    <section class="rooms">
      <h2>Комнаты</h2>
      {error ? (
        <p class="error small">{error}</p>
      ) : !list ? (
        <p class="muted small">Загружаем…</p>
      ) : !list.length ? (
        <p class="muted small">Комнат нет.</p>
      ) : (
        <ul class="room-list">
          {list.map(({ code, lobby, time }) => {
            const hostName = lobby.players.find((p) => p.id === lobby.host)?.name;
            const busy = deleting.has(code);
            return (
              <li key={code}>
                <div class="room-head">
                  <b class="room-list-code">{code}</b>
                  <span class="tag">{lobby.over ? 'игра окончена' : lobby.started ? 'идёт игра' : 'набор игроков'}</span>
                  {lobby.host === pid && <span class="tag">вы хост</span>}
                  {lobby.host !== pid && lobby.players.some((p) => p.id === pid) && <span class="tag">вы играете</span>}
                </div>
                <div class="small muted">
                  {lobby.players.length ? lobby.players.map((p) => p.name).join(', ') : 'игроков нет'}
                  {hostName && lobby.host !== pid && <> · хост {hostName}</>}
                  {worlds.length > 1 && <> · {getWorld(lobby.world).name}</>}
                  {time && <> · {ago(time)}</>}
                </div>
                <div class="row room-actions">
                  <button aria-label={`Войти в комнату ${code}`} disabled={busy} onClick={() => enter(code, lobby)}>
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
      {ask && <ConfirmDialog ask={ask} onClose={() => setAsk(undefined)} />}
    </section>
  );
}

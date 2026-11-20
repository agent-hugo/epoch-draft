import { useEffect, useState } from 'preact/hooks';
import { Bus } from '../net/mqtt';
import { topics, type ServerPresenceMsg } from '../net/protocol';
import { Server } from '../net/server';
import { getWorld, worldDb, worlds } from '../worlds';
import { EPOCH_NAME } from './format';
import { settings } from './storage';

/**
 * A game server in a browser tab (`#serve`): runs the games leaders hand to
 * its code, as long as the tab stays open.
 */
export function ServerPage() {
  const code = settings.serverCode;
  const [server, setServer] = useState<Server>();
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string>();
  const [, force] = useState(0);

  useEffect(() => {
    const bus = new Bus(
      { url: settings.brokerUrl, token: settings.token },
      { will: { topic: topics.serverPresence(code), payload: 'offline' satisfies ServerPresenceMsg } },
    );
    const s = new Server(worldDb, bus, code);
    let alive = true;
    const off = bus.onStatus((on) => alive && setOnline(on));
    const unsub = s.subscribe(() => alive && force((x) => x + 1));
    bus
      .ready()
      .then(() => s.start())
      .then(() => alive && setServer(s))
      .catch((e: Error) => alive && setError(`Не удалось подключиться к брокеру: ${e.message}`));
    // A closed tab ends the connection cleanly: the will is not sent.
    const hide = () => void s.stop();
    addEventListener('pagehide', hide);
    // Keeps the tab from being frozen in the background where browsers allow it.
    let lock: Promise<unknown> | undefined;
    let release: () => void = () => {};
    try {
      lock = navigator.locks?.request('epoch-draft-server', () => new Promise<void>((r) => (release = r)));
      lock?.catch(() => {});
    } catch {
      /* no Web Locks */
    }
    return () => {
      alive = false;
      off();
      unsub();
      release();
      removeEventListener('pagehide', hide);
      void s.stop().finally(() => bus.end());
    };
  }, [code]);

  const rooms = server ? [...server.rooms] : [];
  return (
    <main class="screen narrow">
      <h1>Сервер игр</h1>
      <span class={`conn-dot ${online ? 'on' : 'off'}`} title={online ? 'Связь с брокером есть' : 'Нет связи с брокером'} />
      <div class="room-code" aria-label="Код сервера">
        {code}
      </div>
      <p class="muted small">
        Ведущий вводит этот код в комнате, в разделе «Где идёт игра», и передаёт игру сюда. Пока вкладка открыта и есть
        связь, игры идут без телефона ведущего.
      </p>
      {error && <p class="error">{error}</p>}
      <h2>Комнаты</h2>
      {!server ? (
        <p class="muted small">Подключение…</p>
      ) : !rooms.length ? (
        <p class="muted small">Пока ни одной.</p>
      ) : (
        <ul class="room-list server-rooms">
          {rooms.map(([room, host]) => {
            const g = host.game;
            const l = host.lobby;
            return (
              <li key={room}>
                <div class="room-head">
                  <b class="room-list-code">{room}</b>
                  <span class="tag">
                    {g?.phase === 'over' ? 'игра окончена' : g ? `эпоха ${EPOCH_NAME[g.epoch]}, ход ${g.turn}/6` : 'набор игроков'}
                  </span>
                </div>
                <div class="small muted">
                  {l.players.length ? l.players.map((p) => p.name).join(', ') : 'игроков нет'}
                  {worlds.length > 1 && <> · {getWorld(l.world).name}</>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <a class="link" href="#">
        ← На главную
      </a>
    </main>
  );
}

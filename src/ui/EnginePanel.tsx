import { useEffect, useState } from 'preact/hooks';
import { engineOnline, type ClientSnapshot, type Player } from '../net/client';
import { normalizeRoom, onLeaderPhone } from '../net/protocol';

/** Where the game runs, in words: «этот телефон», «телефон ведущего (Мама)», «сервер ABCDE». */
export function engineWhere(snap: ClientSnapshot, pid: string): string {
  const e = snap.engine;
  if (!e) return 'телефон ведущего';
  if (!onLeaderPhone(e)) return `сервер ${e.id}`;
  if (e.owner === pid) return 'этот телефон';
  const name = snap.lobby?.players.find((p) => p.id === e.owner)?.name;
  return name ? `телефон ведущего (${name})` : 'телефон ведущего';
}

/**
 * Where the game runs. The leader can hand it to a game server (a page
 * opened with `#serve` on an always-on computer) and take it back.
 */
export function EnginePanel({ snap, pid, player }: { snap: ClientSnapshot; pid: string; player: Player }) {
  const saved = snap.prefs.server;
  const [code, setCode] = useState(saved);
  useEffect(() => setCode(saved), [saved]);
  const e = snap.engine;
  if (!e) return null;
  const online = engineOnline(snap);
  const status = (
    <p class="small engine-status">
      Игру считает <b>{engineWhere(snap, pid)}</b>
      {online ? '' : <span class="error"> — не в сети</span>}
    </p>
  );
  if (e.owner !== pid) return status;
  const typed = normalizeRoom(code);
  const serverOn = !!saved && snap.servers[saved] === true;
  return (
    <div class="stack engine-panel">
      {status}
      <form
        class="row"
        onSubmit={(ev) => {
          ev.preventDefault();
          player.setPref('server', typed);
        }}
      >
        <input
          aria-label="Код сервера"
          placeholder="Код сервера"
          value={code}
          autoCapitalize="characters"
          onInput={(ev) => {
            const v = normalizeRoom(ev.currentTarget.value);
            ev.currentTarget.value = v;
            setCode(v);
          }}
        />
        <button type="submit" disabled={typed === saved}>
          Запомнить
        </button>
      </form>
      {saved && e.id !== saved && (
        <button disabled={!serverOn} onClick={() => void player.setEngine(saved)}>
          Считать на сервере {saved}
        </button>
      )}
      {saved && !serverOn && <p class="muted small">Сервер {saved} сейчас не в сети.</p>}
      {!onLeaderPhone(e) && <button onClick={() => void player.setEngine(pid)}>Считать на этом телефоне</button>}
      <p class="muted small">
        Сервер — эта же страница, открытая с адресом …#serve на ноутбуке или домашнем компьютере. Пока он в сети, игра
        идёт без вашего телефона, а вы по-прежнему управляете комнатой и завершаете ходы.
      </p>
    </div>
  );
}

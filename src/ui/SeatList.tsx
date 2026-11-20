import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

interface Seat {
  id: string;
  name: string;
}

/**
 * The players in seat order: everyone sits left of the one below and the
 * last one left of the first. The leader can switch the list to a drag mode
 * to change the order; the new order is applied when the mode is left.
 */
export function SeatList<P extends Seat>(props: {
  players: P[];
  /** Row contents outside the drag mode. */
  row: (p: P) => ComponentChildren;
  /** Set for the leader: the list can be reordered. */
  onApply?: (ids: string[]) => void;
}) {
  const { players, onApply } = props;
  // Player ids in the order being edited; undefined outside the drag mode.
  const [order, setOrder] = useState<string[]>();
  const [dragId, setDragId] = useState<string>();
  const list = useRef<HTMLUListElement>(null);

  if (!order)
    return (
      <>
        <ul class="players">
          {players.map((p) => (
            <li key={p.id}>{props.row(p)}</li>
          ))}
        </ul>
        <p class="small muted seat-hint">Порядок за столом: кто выше, тот сидит слева.</p>
        {onApply && players.length > 1 && (
          <button onClick={() => setOrder(players.map((p) => p.id))}>↕ Изменить порядок</button>
        )}
      </>
    );

  // Players who joined or left meanwhile.
  const ids = [...order.filter((id) => players.some((p) => p.id === id)), ...players.map((p) => p.id).filter((id) => !order.includes(id))];
  const byId = new Map(players.map((p) => [p.id, p]));

  const move = (clientY: number) => {
    if (!dragId || !list.current) return;
    const rows = [...list.current.children];
    const cur = ids.indexOf(dragId);
    let k = rows.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    k = k < 0 ? ids.length - 1 : k > cur ? k - 1 : k;
    if (k === cur) return;
    const next = ids.filter((id) => id !== dragId);
    next.splice(k, 0, dragId);
    setOrder(next);
  };
  const shuffle = () => {
    const next = ids.slice();
    for (let k = next.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [next[k], next[j]] = [next[j]!, next[k]!];
    }
    setOrder(next);
  };
  const done = () => {
    if (ids.join() !== players.map((p) => p.id).join()) onApply?.(ids);
    setOrder(undefined);
    setDragId(undefined);
  };

  return (
    <>
      <ul class="players seats-edit" ref={list}>
        {ids.map((id) => (
          <li
            key={id}
            class={id === dragId ? 'dragging' : ''}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragId(id);
            }}
            onPointerMove={(e) => move(e.clientY)}
            onPointerUp={() => setDragId(undefined)}
            onPointerCancel={() => setDragId(undefined)}
          >
            <span class="grip" aria-hidden="true">
              ☰
            </span>
            <span class="seat-name">{byId.get(id)!.name}</span>
          </li>
        ))}
      </ul>
      <p class="small muted seat-hint">
        Перетащите игроков. Кто выше, тот сидит слева от следующего; последний сидит слева от первого.
      </p>
      <div class="row">
        <button class="primary" onClick={done}>
          Готово
        </button>
        <button onClick={shuffle}>🎲 Перемешать</button>
        <button
          onClick={() => {
            setOrder(undefined);
            setDragId(undefined);
          }}
        >
          Отмена
        </button>
      </div>
    </>
  );
}

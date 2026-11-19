import type { ComponentChildren } from 'preact';

/** A question for {@link ConfirmDialog}. */
export interface Ask {
  text: ComponentChildren;
  ok: string;
  danger?: boolean;
  run: () => void;
}

/** A confirmation dialog over the whole screen. */
export function ConfirmDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-body">{ask.text}</div>
        <div class="row end">
          <button onClick={onClose}>Отмена</button>
          <button
            class={ask.danger ? 'danger' : 'primary'}
            autoFocus
            onClick={() => {
              onClose();
              ask.run();
            }}
          >
            {ask.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

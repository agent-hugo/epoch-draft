import type { Db } from '../engine/db';
import type { CardDef, CardType, Epoch } from '../engine/types';
import { GOODS, RAW } from '../engine/types';
import { costText, effectsText, EPOCH_NAME, RES_ICON, RES_NAME, SCHOOL_ICON, SCHOOL_NAME, TYPE_NAME, TYPE_ORDER } from './format';

const TYPE_HINT: Record<CardType, string> = {
  raw: 'дают сырьё; соседи могут его покупать',
  goods: 'дают товары; соседи могут их покупать',
  culture: 'очки победы',
  trade: 'монеты, скидки на покупку у соседей, очки',
  military: 'сила армии для конфликтов в конце эпохи',
  science: 'символы школ, очки за наборы',
  dynasty: 'только в эпохе III: очки за то, что построено у вас и соседей',
};

/** The legend: icons, card types, civilizations and every card in the deck. */
export function Reference({ db, highlightCiv }: { db: Db; highlightCiv?: string }) {
  const civs = [...db.civs.values()];
  const byEpoch = (e: Epoch, dynasty: boolean) =>
    [...db.cards.values()]
      .filter((c) => c.epoch === e && (c.type === 'dynasty') === dynasty)
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'ru'));

  return (
    <div class="reference">
      <details open>
        <summary>Значки</summary>
        <table class="legend">
          <tbody>
            {RAW.map((r) => (
              <Row key={r} icon={RES_ICON[r]} text={`${RES_NAME[r]} (сырьё)`} />
            ))}
            {GOODS.map((r) => (
              <Row key={r} icon={RES_ICON[r]} text={`${RES_NAME[r]} (товар)`} />
            ))}
            <Row icon={`${RES_ICON.wood}/${RES_ICON.stone}`} text="один ресурс на выбор, каждый ход заново" />
            <Row icon="🪙" text="монеты; в конце игры каждые 3 монеты = 1⭐" />
            <Row icon="⭐" text="очки победы" />
            <Row icon="⚔️" text="сила армии" />
            {(['astronomy', 'medicine', 'writing'] as const).map((s) => (
              <Row key={s} icon={SCHOOL_ICON[s]} text={`научная школа: ${SCHOOL_NAME[s]}`} />
            ))}
            <Row icon="🔭/⚕️/✒️" text="любая школа на выбор (выбирается при подсчёте наиболее выгодно)" />
            <Row icon="◀ ▶" text="левый / правый сосед; ◀▶ — оба" />
            <Row icon={`◀ ${RES_ICON.wood} по 1🪙`} text="покупка этих ресурсов у соседа по 1 монете вместо 2" />
            <Row icon="🏛️" text="стадии Великого сооружения" />
            <Row icon="даром потом" text="эта карта позволит бесплатно построить указанные карты следующих эпох" />
          </tbody>
        </table>
      </details>

      <details>
        <summary>Как считаются очки</summary>
        <ul class="rules-list">
          <li>
            <b>Армия.</b> В конце каждой эпохи сравниваете ⚔️ с каждым соседом: победа даёт +1/+3/+5⭐ (эпохи I/II/III),
            поражение −1⭐, ничья — ничего.
          </li>
          <li>
            <b>Наука.</b> За каждую школу: 1 символ — 1⭐, 2 — 3⭐, 3 — 6⭐, 4 — 10⭐ и т. д.,, плюс 7⭐ за каждый полный набор из трёх
            разных школ.
          </li>
          <li>
            <b>Торговля.</b> Недостающий ресурс можно купить у соседа за 2🪙, если он у него производится картой сырья/товаров
            или стартовым ресурсом цивилизации.
          </li>
          <li>
            <b>Ход.</b> Каждый выбирает карту из руки: построить её, построить ею стадию сооружения или продать за 3🪙. Потом
            руки передаются соседу (эпохи I и III — влево, II — вправо).
          </li>
        </ul>
      </details>

      <details>
        <summary>Типы карт</summary>
        {TYPE_ORDER.map((t) => (
          <div key={t} class={`mini t-${t}`}>
            <span class="chip">{TYPE_NAME[t]}</span> — {TYPE_HINT[t]}
          </div>
        ))}
      </details>

      <details>
        <summary>Цивилизации и сооружения</summary>
        {civs.map((c) => (
          <div key={c.id} class={c.id === highlightCiv ? 'civ mine' : 'civ'}>
            <div>
              <b>{c.name}</b> · старт: {RES_ICON[c.start]} {RES_NAME[c.start]}
            </div>
            <div class="muted small">{c.monument.name}</div>
            <ol class="stages">
              {c.monument.stages.map((s, k) => (
                <li key={k}>
                  {costText(s.cost)} → {effectsText(s.effects)}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </details>

      {([1, 2, 3] as Epoch[]).map((e) => (
        <details key={e}>
          <summary>Карты эпохи {EPOCH_NAME[e]}</summary>
          <CardList db={db} cards={byEpoch(e, false)} />
        </details>
      ))}
      <details>
        <summary>Династии (эпоха III)</summary>
        <p class="small muted">В колоду эпохи III случайно попадает на 2 династии больше, чем игроков.</p>
        <CardList db={db} cards={byEpoch(3, true)} />
      </details>
    </div>
  );
}

function Row({ icon, text }: { icon: string; text: string }) {
  return (
    <tr>
      <td class="icon-cell">{icon}</td>
      <td>{text}</td>
    </tr>
  );
}

function copiesText(c: CardDef): string {
  if (c.type === 'dynasty') return '';
  return c.copies.map((n) => `${n}+`).join(', ') + ' игр.';
}

function CardList({ db, cards }: { db: Db; cards: CardDef[] }) {
  return (
    <ul class="ref-cards">
      {cards.map((c) => {
        const from = db.chainedFrom.get(c.id);
        return (
          <li key={c.id} class={`t-${c.type}`}>
            <div class="title">
              <b>{c.name}</b>
              <span class="chip">{TYPE_NAME[c.type]}</span>
            </div>
            <div>{effectsText(c.effects)}</div>
            <div class="small muted">
              цена: {costText(c.cost)}
              {from && <> · даром, если есть: {from.map((id) => db.card(id).name).join(', ')}</>}
              {c.chainsTo && <> · даром потом: {c.chainsTo.map((id) => db.card(id).name).join(', ')}</>}
              {copiesText(c) && <> · копии: {copiesText(c)}</>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

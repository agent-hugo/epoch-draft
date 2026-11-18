import type { ComponentChildren } from 'preact';
import { HAND_SIZE, TURNS_PER_EPOCH, type Db } from '../engine/db';
import { START_COINS } from '../engine/rules';
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

// Which sections are open. Kept outside the component so it survives tab
// switches and reopening the help screen; everything starts collapsed.
const openSections = new Set<string>();

function Section({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  return (
    <details
      open={openSections.has(id)}
      onToggle={(e) => {
        if (e.currentTarget.open) openSections.add(id);
        else openSections.delete(id);
      }}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** The legend: icons, card types, civilizations and every card in the deck. */
export function Reference({ db, highlightCiv }: { db: Db; highlightCiv?: string }) {
  const civs = [...db.civs.values()];
  const byEpoch = (e: Epoch, dynasty: boolean) =>
    [...db.cards.values()]
      .filter((c) => c.epoch === e && (c.type === 'dynasty') === dynasty)
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'ru'));

  return (
    <div class="reference">
      <Section id="rules" title="Правила игры">
        <ul class="rules-list">
          <li>
            <b>Цель.</b> Набрать больше всех ⭐ за три эпохи: строить здания, возводить Великое сооружение, побеждать соседей
            и копить монеты.
          </li>
          <li>
            <b>Цивилизация.</b> Каждому игроку случайно достаётся цивилизация. Она даёт стартовый ресурс (производится
            всю игру) и Великое сооружение из 3 стадий. Стартовый капитал — {START_COINS}🪙.
          </li>
          <li>
            <b>Соседи.</b> Игроки сидят по кругу. Торговать и воевать можно только с двумя соседями: левым ◀ и правым ▶.
          </li>
          <li>
            <b>Эпохи.</b> Игра идёт три эпохи (I, II, III). В начале эпохи каждый получает руку из {HAND_SIZE} карт этой
            эпохи. Эпоха длится {TURNS_PER_EPOCH} ходов; последняя карта в руке уходит в сброс.
          </li>
          <li>
            <b>Ход.</b> Все ходят одновременно: каждый тайно выбирает одну карту из руки и делает с ней одно из трёх:
            <ul>
              <li>
                <b>построить</b> её — заплатить цену ресурсами и/или монетами, карта ложится в вашу цивилизацию и
                действует до конца игры; две одинаковые карты строить нельзя;
              </li>
              <li>
                <b>построить стадию сооружения</b> — заплатить цену следующей стадии, карта тратится на стадию
                (её эффект не действует); стадии строятся по порядку;
              </li>
              <li>
                <b>продать</b> — сбросить карту и получить 3🪙.
              </li>
            </ul>
            Когда выбрали все, ходы раскрываются, затем оставшиеся руки передаются соседу: в эпохах I и III — влево, во II
            — вправо.
          </li>
          <li>
            <b>Ресурсы.</b> Ресурсы не тратятся: каждая карта сырья или товаров даёт свой ресурс каждый ход заново.
            Недостающее можно купить у соседа (обычно 2🪙 за единицу, монеты получает сосед).
          </li>
          <li>
            <b>Цепочки.</b> Некоторые карты позволяют в следующих эпохах построить определённые карты даром (пометка
            «даром потом»).
          </li>
          <li>
            <b>Конфликты.</b> В конце каждой эпохи ваша ⚔️ сравнивается с каждым из двух соседей. Больше — жетон победы
            (+1/+3/+5⭐ в эпохах I/II/III), меньше — жетон поражения (−1⭐), поровну — ничего.
          </li>
          <li>
            <b>Конец игры.</b> После III эпохи складываются ⭐: конфликты, монеты (3🪙 = 1⭐), сооружение, культура,
            торговля, наука и династии. Побеждает набравший больше всех.
          </li>
        </ul>
      </Section>

      <Section id="icons" title="Значки">
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
      </Section>

      <Section id="scoring" title="Как считаются очки">
        <ul class="rules-list">
          <li>
            <b>Армия.</b> В конце каждой эпохи сравниваете ⚔️ с каждым соседом: победа даёт +1/+3/+5⭐ (эпохи I/II/III),
            поражение −1⭐, ничья — ничего.
          </li>
          <li>
            <b>Наука.</b> За каждую школу: 1 символ — 1⭐, 2 — 3⭐, 3 — 6⭐, 4 — 10⭐ и т. д., плюс 7⭐ за каждый полный набор из трёх
            разных школ.
          </li>
          <li>
            <b>Торговля.</b> Недостающий ресурс можно купить у соседа за 2🪙, если он у него производится картой сырья/товаров
            или стартовым ресурсом цивилизации.
          </li>
        </ul>
      </Section>

      <Section id="types" title="Типы карт">
        {TYPE_ORDER.map((t) => (
          <div key={t} class={`mini t-${t}`}>
            <span class="chip">{TYPE_NAME[t]}</span> — {TYPE_HINT[t]}
          </div>
        ))}
      </Section>

      <Section id="civs" title="Цивилизации и сооружения">
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
      </Section>

      {([1, 2, 3] as Epoch[]).map((e) => (
        <Section key={e} id={`epoch${e}`} title={`Карты эпохи ${EPOCH_NAME[e]}`}>
          <CardList db={db} cards={byEpoch(e, false)} />
        </Section>
      ))}
      <Section id="dynasty" title="Династии (эпоха III)">
        <p class="small muted">В колоду эпохи III случайно попадает на 2 династии больше, чем игроков.</p>
        <CardList db={db} cards={byEpoch(3, true)} />
      </Section>
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

/**
 * Plays a whole game through the UI: two browser "phones" (host + guest)
 * and one bot, against the built app served by `vite preview`.
 * Usage: MQTT_TOKEN=... npm run e2e -- [screenshot dir]
 */
import { spawn } from 'node:child_process';
import { inviteHash } from '../src/ui/invite';
import { chromium, type Locator, type Page } from 'playwright';

const token = process.env.MQTT_TOKEN;
if (!token) {
  console.error('MQTT_TOKEN is required');
  process.exit(2);
}
const shots = process.argv[2];
const PORT = 4173;
const base = `http://localhost:${PORT}/`;

const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors: string[] = [];

async function open(name: string): Promise<Page> {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${base}#t=${encodeURIComponent(token!)}`);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  return page;
}

async function shot(page: Page, file: string) {
  if (shots) await page.screenshot({ path: `${shots}/${file}.png`, fullPage: false });
}

try {
  const host = await open('Мама');
  await host.getByRole('button', { name: 'Создать игру' }).click();
  await host.locator('.room-code').waitFor();
  const room = (await host.locator('.room-code').textContent())!.trim();
  console.log('room', room);
  if ((await host.url()).includes('t=')) throw new Error('token left in the address bar');

  // An invite link with the token: room and token come base64-packed in `#i=`.
  // It points at a room nobody hosts, so the invited player does not join this game.
  const invited = await (await browser.newContext(phone)).newPage();
  await invited.goto(`${base}#${inviteHash('NOHOST', token!)}`);
  await invited.getByLabel('Ваше имя').fill('Гость');
  await invited.getByRole('button', { name: 'Сохранить' }).click();
  await invited.getByText('Ждём хоста комнаты NOHOST').waitFor();
  if (!invited.url().endsWith('#room=NOHOST')) throw new Error(`invite link left ${invited.url()}`);
  await invited.context().close();

  const guest = await open('Петя');
  await guest.getByPlaceholder('Код комнаты').fill(room);
  await guest.getByRole('button', { name: 'Войти', exact: true }).click();
  await host.locator('.players li', { hasText: 'Петя' }).waitFor();
  await host.getByRole('button', { name: 'Добавить бота' }).click();
  await host.locator('.players li', { hasText: 'Бот' }).waitFor();
  await shot(host, '1-lobby');
  await host.getByRole('button', { name: 'Начать игру' }).click();

  const pages = [host, guest];
  for (const p of pages) await p.locator('.cards .card').first().waitFor({ timeout: 15000 });
  await shot(guest, '2-hand');

  // A move can be withdrawn while others choose: the chosen card offers a cancel, not its actions.
  {
    const card = host.locator('.cards .card').first();
    await card.locator('.card-head').click();
    await card.getByRole('button', { name: /^Продать/ }).click();
    await host.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
    await host.locator('.banner.ok').waitFor();
    await host.locator('.cards .card.chosen .card-head').click();
    const chosen = host.locator('.cards .card.chosen');
    if (await chosen.getByRole('button', { name: /^(Построить|Продать|Стадия)/ }).count())
      throw new Error('the chosen card still offers its actions');
    await chosen.getByRole('button', { name: 'Отменить выбор' }).click();
    await host.locator('.banner.ok').waitFor({ state: 'hidden' });
    if (await host.locator('.cards .card.chosen').count()) throw new Error('the withdrawn card is still marked');
  }

  // The neighbours tab shows who is online: the guest and the bot both are.
  await host.getByRole('button', { name: 'Соседи' }).click();
  await host.locator('.other .dot.on').nth(1).waitFor({ timeout: 5000 });
  await shot(host, '2-others');
  await host.getByRole('button', { name: 'Рука' }).click();

  // When everybody has chosen, only the host is asked to end the turn.
  const endTurn = (p: Page) => p.getByRole('dialog').filter({ hasText: 'Завершить ход и перейти' });
  let endChecked = false;
  let cityShot = false;
  let moves = 0;
  const done = (p: Page) => p.getByRole('heading', { name: /Победа|Победил/ }).isVisible();
  while (!(await done(host)) || !(await done(guest))) {
    for (const p of pages) {
      if (await done(p)) continue;
      if (p === host && (await endTurn(host).isVisible())) {
        const before = await host.locator('.bar').textContent();
        if (await endTurn(guest).count()) throw new Error('the guest is asked to end the turn');
        const text = await endTurn(host).innerText();
        if (/Петя|Бот/.test(text)) throw new Error(`the end-turn question tells the moves: ${text}`);
        if (!endChecked) {
          // Cancel leaves a banner to end the turn later.
          endChecked = true;
          await shot(host, '3-end-turn');
          await endTurn(host).getByRole('button', { name: 'Отмена' }).click();
          await guest.getByText('ждём, пока хост завершит ход').waitFor();
          await host.locator('.banner').getByRole('button', { name: 'Завершить ход' }).click();
        } else {
          await endTurn(host).getByRole('button', { name: 'Завершить ход' }).click();
        }
        await host.waitForFunction((prev) => document.querySelector('.bar')?.textContent !== prev, before, { timeout: 15000 });
        continue;
      }
      const summary = p.getByRole('dialog', { name: 'Итоги хода' });
      if (await summary.isVisible()) {
        if (moves > 20 && moves < 25) await shot(p, '4-summary');
        await summary.getByRole('button', { name: 'Дальше' }).click();
      }
      // No bar: the game has just ended on this page.
      const turnKey = await p.locator('.bar').textContent({ timeout: 2000 }).catch(() => null);
      if (turnKey === null) continue;
      if (await p.locator('.banner.ok').isVisible()) continue; // already chose this turn
      if (shots && moves >= 30 && !cityShot && p === host) {
        cityShot = true;
        await host.getByRole('button', { name: 'Город' }).click();
        await shot(host, '4-city');
        await host.getByRole('button', { name: 'Рука' }).click();
      }
      const cards = p.locator('.cards .card');
      if ((await cards.count()) === 0) continue;
      try {
        await pickMove(p, cards, moves === 3);
      } catch (e) {
        // The next turn's summary may pop up over the old hand at any moment:
        // go round again, it is closed first.
        if ((e as Error).name !== 'TimeoutError' || !(await p.locator('.modal-back').count())) throw e;
        continue;
      }
      moves++;
      await p.waitForFunction(
        (prev) => document.querySelector('.banner.ok') || document.querySelector('.bar')?.textContent !== prev || !document.querySelector('.bar'),
        turnKey,
        { timeout: 15000 },
      );
    }
  }
  console.log(`game over after ${moves} UI moves`);
  if (!endChecked) throw new Error('the host was never asked to end the turn');
  await guest.getByRole('button', { name: 'Город' }).isVisible().catch(() => false);
  await shot(host, '5-final');
  // Every player's city at the end, collapsed under the scores.
  if ((await guest.locator('.final-cities details').count()) !== 3) throw new Error('the final screen misses the cities');
  await guest.locator('.final-cities summary').first().click();
  await guest.locator('.final-cities details[open] .group').first().waitFor();
  await shot(guest, '5-cities');
  // Every move of the game can be reviewed on the final screen, with all cards shown.
  await guest.getByRole('button', { name: /^Все ходы партии/ }).click();
  const logItems = guest.locator('.game-log .summary-list:not(.conflicts) li');
  if ((await logItems.count()) !== 54) throw new Error(`expected 54 moves in the game log, got ${await logItems.count()}`);
  if (await guest.locator('.game-log li', { hasText: 'продал(а) карту' }).count()) throw new Error('the game log hides a sold card');
  if (await guest.locator('.game-log li b', { hasText: /^Вы$/ }).count()) throw new Error('the game log says "Вы" instead of a name');
  if (!(await guest.locator('.game-log li b', { hasText: 'Петя' }).count())) throw new Error('the game log does not name the viewer');
  // The conflicts of each epoch follow its last turn: three neighbour pairs, three epochs.
  if ((await guest.locator('.game-log h3', { hasText: 'Конфликты эпохи' }).count()) !== 3) throw new Error('the game log misses conflicts');
  if ((await guest.locator('.game-log .conflicts li').count()) !== 9) throw new Error('expected 9 conflicts in the game log');
  await guest.locator('.game-log h3').nth(10).scrollIntoViewIfNeeded();
  await shot(guest, '6-log');
  const table = await host.locator('table.scores').innerText();
  console.log(table);
  if (moves !== 36) throw new Error(`expected 36 moves by two humans, got ${moves}`);
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.kill();
}

/** Builds the first card that can be built, otherwise sells the first one. */
async function pickMove(p: Page, cards: Locator, withShots: boolean) {
  const click = { timeout: 5000 };
  const n = await cards.count();
  for (let k = 0; k < n; k++) {
    await cards.nth(k).locator('.card-head').click(click);
    const build = cards.nth(k).getByRole('button', { name: /^Построить/ });
    if (await build.count()) {
      if (withShots) await shot(p, '3-actions');
      await build.first().click(click);
      if (withShots) await shot(p, '3-confirm');
      await p.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click(click);
      return;
    }
    await cards.nth(k).locator('.card-head').click(click);
  }
  await cards.first().locator('.card-head').click(click);
  await cards.first().getByRole('button', { name: /^Продать/ }).click(click);
  await p.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click(click);
}

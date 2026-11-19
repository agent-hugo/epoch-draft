/**
 * Plays a whole game through the UI: two browser "phones" (host + guest)
 * and one bot, against the built app served by `vite preview`.
 * Usage: MQTT_TOKEN=... npm run e2e -- [screenshot dir]
 */
import { spawn } from 'node:child_process';
import { chromium, type Page } from 'playwright';

const token = process.env.MQTT_TOKEN;
if (!token) {
  console.error('MQTT_TOKEN is required');
  process.exit(2);
}
const shots = process.argv[2];
const PORT = 4173;
const base = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
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

  let moves = 0;
  const done = (p: Page) => p.getByRole('heading', { name: /Победа|Победил/ }).isVisible();
  while (!(await done(host)) || !(await done(guest))) {
    for (const p of pages) {
      if (await done(p)) continue;
      const summary = p.getByRole('dialog', { name: 'Итоги хода' });
      if (await summary.isVisible()) {
        if (moves > 20 && moves < 25) await shot(p, '4-summary');
        await summary.getByRole('button', { name: 'Дальше' }).click();
      }
      const turnKey = await p.locator('.bar').textContent();
      if (await p.locator('.banner.ok').isVisible()) continue; // already chose this turn
      const cards = p.locator('.cards .card');
      if ((await cards.count()) === 0) continue;
      // Prefer a card that can be built, otherwise sell the first one.
      const n = await cards.count();
      let picked = false;
      for (let k = 0; k < n && !picked; k++) {
        await cards.nth(k).locator('.card-head').click();
        const build = cards.nth(k).getByRole('button', { name: /^Построить/ });
        if (await build.count()) {
          if (moves === 3) await shot(p, '3-actions');
          await build.first().click();
          if (moves === 3) await shot(p, '3-confirm');
          await p.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
          picked = true;
        } else {
          await cards.nth(k).locator('.card-head').click();
        }
      }
      if (!picked) {
        await cards.first().locator('.card-head').click();
        await cards.first().getByRole('button', { name: /^Продать/ }).click();
        await p.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
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
  await guest.getByRole('button', { name: 'Город' }).isVisible().catch(() => false);
  await shot(host, '5-final');
  const table = await host.locator('table.scores').innerText();
  console.log(table);
  if (moves !== 36) throw new Error(`expected 36 moves by two humans, got ${moves}`);
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.kill();
}

/**
 * Help screen, settings tab, replacing a player with a bot and "end game for
 * everyone", through the UI: three phones against the built app served by
 * `vite preview`.
 * Usage: MQTT_TOKEN=... npm run e2e:end -- [screenshot dir]
 */
import { spawn } from 'node:child_process';
import { chromium, type Page } from 'playwright';

const token = process.env.MQTT_TOKEN;
if (!token) {
  console.error('MQTT_TOKEN is required');
  process.exit(2);
}
const shots = process.argv[2];
const PORT = 4174;
const base = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors: string[] = [];

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(what);
}

async function shot(page: Page, file: string) {
  if (shots) await page.screenshot({ path: `${shots}/${file}.png` });
}

async function newPage(name: string): Promise<Page> {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('dialog', (d) => errors.push(`${name}: unexpected native dialog "${d.message()}"`) && void d.dismiss());
  return page;
}

/** Answers the confirmation modal. */
async function confirm(page: Page, ok: string | false) {
  const modal = page.getByRole('dialog');
  await modal.waitFor();
  await modal.getByRole('button', { name: ok || 'Отмена', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
}

async function join(name: string, room: string): Promise<Page> {
  const p = await newPage(name);
  await p.goto(`${base}#t=${encodeURIComponent(token!)}`);
  await p.getByLabel('Ваше имя').fill(name);
  await p.getByRole('button', { name: 'Сохранить' }).click();
  await p.getByPlaceholder('Код комнаты').fill(room);
  await p.getByRole('button', { name: 'Войти' }).click();
  return p;
}

async function sellFirst(page: Page) {
  await page.locator('.cards .card-head').first().click();
  await page.getByRole('button', { name: 'Продать за 3🪙' }).click();
}

const openSections = (p: Page) => p.locator('.reference details[open]').count();

try {
  // Help before logging in.
  const host = await newPage('Мама');
  await host.goto(base);
  await host.getByRole('button', { name: /Справка по игре/ }).click();
  check((await openSections(host)) === 0, 'help sections must start collapsed');
  await host.getByText('Значки', { exact: true }).click();
  await shot(host, 'e1-help-login');
  await host.getByRole('button', { name: 'Закрыть' }).click();
  await host.getByRole('button', { name: /Справка по игре/ }).click();
  check((await openSections(host)) === 1, 'help must remember open sections');
  await host.getByText('Значки', { exact: true }).click();
  await host.getByRole('button', { name: 'Закрыть' }).click();

  await host.getByLabel('Ваше имя').fill('Мама');
  await host.getByLabel('Токен брокера').fill(token!);
  await host.getByRole('button', { name: 'Сохранить' }).click();
  await host.getByRole('button', { name: 'Создать игру' }).click();
  await host.locator('.room-code').waitFor();
  const room = (await host.locator('.room-code').textContent())!.trim();
  console.log('room', room);

  const guest = await join('Петя', room);
  await host.locator('.players li', { hasText: 'Петя' }).waitFor();
  const third = await join('Вася', room);
  await host.locator('.players li', { hasText: 'Вася' }).waitFor();

  // Help from the lobby must not drop the connection.
  await guest.getByRole('button', { name: /Справка по игре/ }).click();
  await guest.getByRole('button', { name: 'Закрыть' }).click();
  await host.getByRole('button', { name: 'Начать игру' }).click();
  for (const p of [host, guest, third]) await p.locator('.cards .card').first().waitFor({ timeout: 15000 });

  // The hand tab tells where the hand goes (epoch I passes to the left).
  const pass = (await host.locator('.pass').textContent()) ?? '';
  check(/рука перейдёт влево ◀ (Петя|Вася)$/.test(pass), `pass hint: ${pass}`);

  // The host hands Вася's seat to a bot; Вася is dropped, the game goes on.
  await host.getByRole('button', { name: 'Настройки' }).click();
  await host.locator('.players li', { hasText: 'Вася' }).getByRole('button', { name: /Заменить/ }).click();
  await confirm(host, false);
  check(await third.locator('.cards .card').first().isVisible(), 'cancel must keep the player');
  await host.locator('.players li', { hasText: 'Вася' }).getByRole('button', { name: /Заменить/ }).click();
  await shot(host, 'e0-confirm');
  await confirm(host, 'Заменить');
  await third.getByRole('heading', { name: 'Вас заменили ботом' }).waitFor({ timeout: 10000 });
  await shot(third, 'e0-replaced');
  check((await host.locator('.settings-tab .players li').count()) === 1, 'replaced player must leave the list');
  await host.getByRole('button', { name: 'Рука' }).click();
  await sellFirst(host);
  await sellFirst(guest);
  for (const p of [host, guest]) await p.locator('.bar', { hasText: 'ход 2/6' }).waitFor({ timeout: 10000 });
  await host.getByRole('button', { name: 'Соседи' }).click();
  await host.locator('.other summary', { hasText: '🤖 Вася' }).waitFor();

  // Help tab keeps its sections across tab switches.
  await guest.getByRole('button', { name: 'Справка' }).click();
  check((await openSections(guest)) === 0, 'in-game help must start collapsed');
  await guest.getByText('Цивилизации и сооружения', { exact: true }).click();
  await guest.getByRole('button', { name: 'Рука' }).click();
  await guest.getByRole('button', { name: 'Справка' }).click();
  check((await openSections(guest)) === 1, 'help tab must remember open sections');
  await shot(guest, 'e2-help-tab');

  // The tab bar sits at the very bottom.
  const gap = await guest.evaluate('innerHeight - document.querySelector(".tabs").getBoundingClientRect().bottom');
  check(gap === 0, `tab bar is ${gap}px above the bottom`);

  await guest.getByRole('button', { name: 'Настройки' }).click();
  await shot(guest, 'e3-settings');
  await guest.getByRole('button', { name: 'Завершить игру для всех' }).click();
  await confirm(guest, false);
  check(await guest.locator('.bar').isVisible(), 'cancel must keep the game');
  await guest.getByRole('button', { name: 'Завершить игру для всех' }).click();
  await confirm(guest, 'Завершить');

  for (const p of [host, guest]) await p.getByRole('heading', { name: 'Игра завершена' }).waitFor({ timeout: 10000 });
  await shot(host, 'e4-ended');
  check(await host.getByText('Петя завершил(а) игру').isVisible(), 'host must see who ended the game');

  // The room stays closed after a reload, and the host does not bring it back.
  await host.reload();
  await host.getByRole('heading', { name: 'Игра завершена' }).waitFor({ timeout: 10000 });
  await host.waitForTimeout(2500);
  check(await host.getByRole('heading', { name: 'Игра завершена' }).isVisible(), 'room reopened after host reload');

  await host.getByRole('button', { name: 'В меню' }).click();
  await host.getByRole('button', { name: 'Создать игру' }).waitFor();

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.kill();
}

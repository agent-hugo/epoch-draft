/**
 * Help screen, settings tab and "end game for everyone", through the UI:
 * host + guest phones and a bot, against the built app served by `vite preview`.
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
  page.on('dialog', (d) => void d.accept());
  return page;
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

  const guest = await newPage('Петя');
  await guest.goto(`${base}#t=${encodeURIComponent(token!)}`);
  await guest.getByLabel('Ваше имя').fill('Петя');
  await guest.getByRole('button', { name: 'Сохранить' }).click();
  await guest.getByPlaceholder('Код комнаты').fill(room);
  await guest.getByRole('button', { name: 'Войти' }).click();
  await host.locator('.players li', { hasText: 'Петя' }).waitFor();

  // Help from the lobby must not drop the connection.
  await guest.getByRole('button', { name: /Справка по игре/ }).click();
  await guest.getByRole('button', { name: 'Закрыть' }).click();
  await host.getByRole('button', { name: 'Добавить бота' }).click();
  await host.getByRole('button', { name: 'Начать игру' }).click();
  for (const p of [host, guest]) await p.locator('.cards .card').first().waitFor({ timeout: 15000 });

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

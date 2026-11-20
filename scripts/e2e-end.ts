/**
 * Help screen, settings tab, replacing a player with a bot, "end game for
 * everyone" and the room list on the home screen, through the UI: three phones against the built app served by
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

const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
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
  await p.getByRole('button', { name: 'Войти', exact: true }).click();
  return p;
}

async function sellFirst(page: Page, screenshot?: string) {
  await page.locator('.cards .card-head').first().click();
  await page.getByRole('button', { name: 'Продать за 3🪙' }).click();
  await page.getByRole('dialog').getByText(/Продать «.+»\?/).waitFor();
  if (screenshot) await shot(page, screenshot);
  await confirm(page, 'Подтвердить');
}

/** Names in a player list, top to bottom. */
const seatNames = async (p: Page, list: string) =>
  (await p.locator(`${list} .players .seat-name`).allInnerTexts()).map((t) => t.trim());

/** In the drag mode of a player list, drags the row with `name` to the top. */
async function dragToTop(page: Page, name: string) {
  const rows = page.locator('.seats-edit li');
  const from = (await rows.filter({ hasText: name }).boundingBox())!;
  const top = (await rows.first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + top.width / 2, top.y + 2, { steps: 12 });
  await page.mouse.up();
}

const openSections = (p: Page) => p.locator('.reference details[open]').count();

try {
  // Help before logging in.
  const host = await newPage('Мама');
  await host.goto(base);
  await host.getByRole('button', { name: /Справка по игре/ }).click();
  check((await openSections(host)) === 0, 'help sections must start collapsed');
  await host.getByText('Правила игры', { exact: true }).click();
  await host.getByText(/Все ходят одновременно/).waitFor();
  await shot(host, 'e1-rules');
  await host.getByText('Правила игры', { exact: true }).click();
  await host.getByText('Значки', { exact: true }).click();
  await shot(host, 'e1-help-login');
  // Outside a room any world can be browsed.
  await host.getByRole('combobox', { name: 'Мир' }).selectOption({ label: 'Космос' });
  await host.locator('.world-line', { hasText: 'Космос' }).waitFor();
  await host.getByText('реголит (сырьё)').waitFor();
  await shot(host, 'e1-help-space');
  await host.getByRole('combobox', { name: 'Мир' }).selectOption({ label: 'Древний мир' });
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

  // The world of the room is shown to everybody; with several worlds the host picks it.
  await guest.getByRole('heading', { name: 'Мир' }).waitFor();
  await guest.getByText('Древний мир', { exact: true }).waitFor();
  await host.getByRole('combobox', { name: 'Мир' }).selectOption({ label: 'Космос' });
  await guest.getByText('Космос', { exact: true }).waitFor();
  check(!(await guest.getByRole('combobox', { name: 'Мир' }).isVisible()), 'only the host picks the world');
  await guest.getByRole('button', { name: /Справка по игре/ }).click();
  check(!(await guest.locator('.help-worlds').isVisible()), 'room help must not offer other worlds');
  await guest.locator('.world-line', { hasText: 'Космос' }).waitFor();
  await guest.getByRole('button', { name: 'Закрыть' }).click();
  await host.getByRole('combobox', { name: 'Мир' }).selectOption({ label: 'Древний мир' });
  await guest.getByText('Древний мир', { exact: true }).waitFor();
  await host.getByRole('heading', { name: 'Мир' }).scrollIntoViewIfNeeded();
  await shot(host, 'e0-lobby');

  // The host reorders the seats: the list is the seating, the one above sits on the left.
  check((await seatNames(guest, '.screen')).join() === 'Мама,Петя,Вася', `lobby order: ${await seatNames(guest, '.screen')}`);
  check(!(await guest.getByRole('button', { name: /Изменить порядок/ }).isVisible()), 'only the host reorders');
  await host.getByRole('button', { name: /Изменить порядок/ }).click();
  await dragToTop(host, 'Вася');
  check((await seatNames(guest, '.screen')).join() === 'Мама,Петя,Вася', 'the order must apply only when done');
  await shot(host, 'e0-reorder');
  await host.getByRole('button', { name: 'Готово' }).click();
  await guest.waitForFunction(() => document.querySelector('.players li')?.textContent?.includes('Вася'));
  check((await seatNames(guest, '.screen')).join() === 'Вася,Мама,Петя', `reordered: ${await seatNames(guest, '.screen')}`);

  // Civilizations picked by the players.
  await host.getByRole('radio', { name: /Выбор игроков/ }).click();
  await host.getByRole('button', { name: /^Египет/ }).click();
  await guest.getByRole('button', { name: /^Египет/ }).and(guest.locator(':disabled')).waitFor();
  // With the host away a pick waits for it, shown as such, and applies when the host is back.
  await host.getByRole('button', { name: 'Выйти' }).click();
  await guest.getByText(/Хост \(Мама\) сейчас не в комнате/).waitFor();
  await guest.getByRole('button', { name: /^Рим/ }).click();
  await guest.getByRole('button', { name: /^Рим.*ждём хоста/ }).waitFor();
  await host.getByRole('button', { name: `Войти в комнату ${room}` }).click();
  await host.locator('.players li', { hasText: 'Рим' }).waitFor();
  await guest.getByRole('button', { name: /^Рим.*ваша/ }).waitFor();
  check(!(await guest.getByText(/сейчас не в комнате/).isVisible()), 'the notice must go when the host is back');
  check(await host.getByRole('button', { name: 'Начать игру' }).isDisabled(), 'start must wait for every pick');
  await host.getByText(/Ещё не выбрали цивилизацию: Вася/).waitFor();
  await shot(guest, 'e0-civ-pick');
  await third.getByRole('button', { name: 'Выбрать случайную' }).click();
  await host.locator('.players li', { hasText: 'Вася' }).locator('.muted', { hasNotText: 'выбирает' }).waitFor();
  await host.getByRole('button', { name: 'Начать игру' }).click();
  for (const p of [host, guest, third]) await p.locator('.cards .card').first().waitFor({ timeout: 15000 });

  // The header shows the neighbours and where the hand goes (epoch I passes to the left).
  const pass = (await host.locator('.neighbours').innerText()).replace(/\s+/g, ' ');
  check(await host.getByText('Великая пирамида').isVisible(), 'host must play Egypt');
  check(await guest.getByText('Колизей').isVisible(), 'guest must play Rome');

  // The expanded card survives a tab switch.
  await host.locator('.cards .card-head').first().click();
  await host.getByRole('button', { name: 'Город' }).click();
  await host.getByRole('button', { name: 'Рука' }).click();
  check(await host.getByRole('button', { name: 'Продать за 3🪙' }).isVisible(), 'card must stay expanded');
  await host.locator('.cards .card-head').first().click();
  check(pass === '◀ Вася ◀ далее Петя ▶', `neighbours: ${pass}`);
  check((await host.locator('.neighbours .next').innerText()).includes('Вася'), 'the hand goes to the left one');
  check(!(await host.getByText(/рука перейдёт/).count()), 'the old pass line must be gone');

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
  // Every player stays in the list, bots too; only humans can be replaced.
  check((await seatNames(host, '.settings-tab')).join() === '🤖 Вася,Мама,Петя', `settings list: ${await seatNames(host, '.settings-tab')}`);
  check((await host.locator('.settings-tab .players li').getByRole('button', { name: /Заменить/ }).count()) === 1, 'only Петя can be replaced');
  // Reordering during the game changes the neighbours.
  await host.getByRole('button', { name: /Изменить порядок/ }).click();
  await dragToTop(host, 'Мама');
  await host.getByRole('button', { name: 'Готово' }).click();
  await host.locator('.neighbours', { hasText: '◀ Петя' }).waitFor();
  const swapped = (await host.locator('.neighbours').innerText()).replace(/\s+/g, ' ');
  check(swapped === '◀ Петя ◀ далее 🤖 Вася ▶', `neighbours after reorder: ${swapped}`);
  await guest.locator('.neighbours', { hasText: '◀ 🤖 Вася' }).waitFor();
  await shot(host, 'e0-reordered');
  await host.getByRole('button', { name: 'Рука' }).click();
  // Cancelling the move confirmation keeps the hand unchosen.
  await guest.locator('.cards .card-head').first().click();
  await guest.getByRole('button', { name: 'Продать за 3🪙' }).click();
  await confirm(guest, false);
  check(!(await guest.locator('.banner.ok').isVisible()), 'cancelled move must not be sent');
  await guest.locator('.cards .card-head').first().click(); // the card stays open after cancel
  await sellFirst(host, 'e0-move-confirm');
  await host.locator('.banner.ok').waitFor();
  await sellFirst(guest);
  await confirm(host, 'Завершить ход');
  for (const p of [host, guest]) await p.locator('.bar', { hasText: 'ход 2/6' }).waitFor({ timeout: 10000 });

  // After the turn everybody sees what each player did.
  const summary = host.getByRole('dialog', { name: 'Итоги хода' });
  await summary.waitFor();
  const text = await summary.innerText();
  check(/Итоги хода 1/.test(text) && /Мама\s+продал\(а\) «/.test(text) && /Петя\s+продал\(а\) карту за 3🪙/.test(text), `summary: ${text}`);
  check(/🤖 Вася/.test(text), `summary must list the bot: ${text}`);
  await shot(host, 'e0-summary');
  for (const p of [host, guest]) await p.getByRole('dialog', { name: 'Итоги хода' }).getByRole('button', { name: 'Дальше' }).click();
  await host.getByRole('button', { name: 'Соседи' }).click();
  await host.locator('.other summary', { hasText: '🤖 Вася' }).waitFor();
  await shot(host, 'e0-others');
  const petya = host.locator('.other', { has: host.locator('summary', { hasText: 'Петя' }) });
  const last = await petya.locator('.last-action').innerText({ timeout: 5000 });
  check(/Последний ход \(I, 1\): продал\(а\) карту/.test(last), `last action in the neighbours tab: ${last}`);

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

  // The home screen lists the rooms on the broker; an ended room is not there.
  await host.locator('.room-list, .rooms :text("Комнат нет.")').first().waitFor();
  check(!(await host.getByRole('button', { name: `Войти в комнату ${room}` }).isVisible()), 'ended room must not be listed');
  await host.getByRole('button', { name: 'Создать игру' }).click();
  await host.locator('.room-code').waitFor();
  const room2 = (await host.locator('.room-code').textContent())!.trim();
  await host.locator('.players li', { hasText: 'Мама' }).waitFor();
  await host.getByRole('button', { name: 'Выйти' }).click();
  const item = host.locator('.room-list li', { hasText: room2 });
  await item.getByText('вы хост').waitFor({ timeout: 10000 });
  // A new room is stamped by its host: the list shows when it was updated.
  await item.getByText('только что').waitFor({ timeout: 5000 });
  await shot(host, 'e5-rooms');
  // Enter from the list, back, then delete it.
  await host.getByRole('button', { name: `Войти в комнату ${room2}` }).click();
  await host.locator('.room-code', { hasText: room2 }).waitFor();
  await host.locator('.players li', { hasText: 'Мама' }).waitFor();
  await host.getByRole('button', { name: 'Выйти' }).click();
  await host.getByRole('button', { name: `Удалить комнату ${room2}` }).click();
  await confirm(host, false);
  check(await item.isVisible(), 'cancel must keep the room');
  await host.getByRole('button', { name: `Удалить комнату ${room2}` }).click();
  await confirm(host, 'Удалить');
  await item.waitFor({ state: 'detached', timeout: 10000 });
  // Opening the deleted room shows it ended.
  await host.goto(`${base}#room=${room2}`);
  await host.getByRole('heading', { name: 'Игра завершена' }).waitFor({ timeout: 10000 });
  check(await host.getByText('Мама завершил(а) игру').isVisible(), 'deleted room must say who ended it');

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.kill();
}

// `npm run test:e2e`: a short night in real browsers against the local dev servers
// (`npm run dev` on :8004 and `npm run server` on :8799). Three contexts on one room
// (host, player, spectator screen) plus bots; asserts every screen ends on the same
// table. Screenshots land in $SHOTS (default ./dist/shots).
//
// Env: PW (path to a playwright package), CHROME (executable), BASE, SHOTS, GAMES.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? 'playwright');
const BASE = process.env.BASE ?? 'http://localhost:8004';
const SHOTS = process.env.SHOTS ?? 'dist/shots';
const GAMES = (process.env.GAMES ?? 'race,quiz,devops,approve').split(',');
mkdirSync(SHOTS, { recursive: true });

const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const errors = [];
async function open(name, query, size = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(`${BASE}/?${query}&dev=1`);
  return page;
}

const alice = await open('alice', `room=${code}`);
await alice.fill('#name', 'Alice');
await alice.click('button.big');
await alice.waitForSelector('.lobby');
const bob = await open('bob', `room=${code}`, { width: 390, height: 844 });   // a phone
await bob.fill('#name', 'Bob');
await bob.click('button.big');
await bob.waitForSelector('.lobby');
const tv = await open('tv', `room=${code}&tv=1`);
await tv.waitForSelector('.roomcode');

for (let i = 0; i < 3; i++) await alice.click('[data-act="bot+"]');
await bob.click('[data-act="avatar"][data-v="dragon"]');
await bob.click('[data-act="hat"][data-v="🎩"]');
await alice.evaluate(g => window.devApp().net.host('settings', { rounds: 4, games: g }), GAMES);
await alice.waitForTimeout(400);
await alice.screenshot({ path: `${SHOTS}/1-lobby.png` });
await bob.screenshot({ path: `${SHOTS}/1-lobby-phone.png`, fullPage: true });
await alice.click('[data-act="start"]');

const phase = p => p.evaluate(() => window.devState()?.phase);
const shot = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60_000) {
  const [s, gid] = await alice.evaluate(() => [window.devState().phase, window.devState().game?.id]);
  if (s === 'podium') break;
  const key = `${s}-${gid}`;
  if (s === 'play') {
    for (const p of [alice, bob]) {
      const kind = await p.evaluate(() => window.devState().game?.kind);
      if (kind === 'bird') await p.keyboard.press('Space');
      else {
        const btn = await p.$('#game button.opt:not([disabled])');
        if (btn) await btn.click().catch(() => {});
        const num = await p.$('#num');
        if (num) { await num.fill('2000'); await num.press('Enter'); }
        // Drawing rounds: scribble a stroke on whichever pad is showing, then vote.
        const pad = await p.$('.gal-pad canvas, .g-board canvas');
        const box = pad && await pad.boundingBox();
        if (box && box.width > 0) {
          const x = box.x + box.width * (0.2 + Math.random() * 0.6), y = box.y + box.height * (0.2 + Math.random() * 0.6);
          await p.mouse.move(x, y); await p.mouse.down();
          await p.mouse.move(x + 60, y + 40, { steps: 6 }); await p.mouse.move(x + 20, y + 90, { steps: 6 });
          await p.mouse.up();
        }
        const vote = await p.$('[data-vote]');
        if (vote) await vote.click().catch(() => {});
      }
    }
    if (!shot.has(key)) {
      await alice.waitForTimeout(6000);
      shot.add(key);
      await alice.screenshot({ path: `${SHOTS}/2-play-${gid}.png` });
      await bob.screenshot({ path: `${SHOTS}/2-play-${gid}-phone.png` });
      await tv.screenshot({ path: `${SHOTS}/2-play-${gid}-tv.png` });
    }
    const step = await alice.evaluate(() => window.devState().gv?.step);
    if (step === 'rev' && !shot.has(`rev-${gid}`)) {
      shot.add(`rev-${gid}`);
      await alice.waitForTimeout(400);
      await alice.screenshot({ path: `${SHOTS}/2-reveal-${gid}.png`, fullPage: true });
      await bob.screenshot({ path: `${SHOTS}/2-reveal-${gid}-phone.png`, fullPage: true });
    }
    if (!shot.has('wall') && await alice.$('.gal-wall canvas')) {
      shot.add('wall');
      await alice.waitForTimeout(1500);
      await alice.screenshot({ path: `${SHOTS}/2-play-gallery-wall.png`, fullPage: true });
    }
    if (!shot.has('reveal') && await alice.$('.gal-cap .chip')) {
      shot.add('reveal');
      await alice.screenshot({ path: `${SHOTS}/2-play-gallery-reveal.png`, fullPage: true });
    }
    await alice.waitForTimeout(140);
  } else {
    if (!shot.has(key)) {
      shot.add(key);
      await alice.waitForTimeout(500);
      await alice.screenshot({ path: `${SHOTS}/3-${s}-${gid}.png`, fullPage: true });
      if (s === 'results') await bob.screenshot({ path: `${SHOTS}/3-${s}-${gid}-phone.png`, fullPage: true });
    }
    // Keep the night moving: the host skips the intro and results timers.
    await alice.waitForTimeout(1500);
    await alice.evaluate(() => window.devApp().net.host('next'));
  }
}

await alice.waitForTimeout(800);
await alice.screenshot({ path: `${SHOTS}/4-podium.png`, fullPage: true });
await tv.screenshot({ path: `${SHOTS}/4-podium-tv.png`, fullPage: true });
const tables = await Promise.all([alice, bob, tv].map(p => p.evaluate(() => JSON.stringify(window.devState().players.map(x => [x.name, x.points])))));
const phases = await Promise.all([alice, bob, tv].map(phase));
const history = await alice.evaluate(() => window.devState().history.map(o => `${o.game}: ${o.headline}`));
await browser.close();

console.log(history.join('\n'));
console.log('tables:', tables[0]);
const ok = phases.every(p => p === 'podium') && tables.every(t => t === tables[0]) && history.length === 4;
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'));
console.log(ok && !errors.length ? 'e2e passed' : `e2e FAILED (phases ${phases.join(',')})`);
process.exit(ok && !errors.length ? 0 : 1);

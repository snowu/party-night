// `node tests/feel.mjs`: plays ?try=hockey against the local dev servers with a
// simulated network (LAG, JIT ms; SECS long), logs where the puck is drawn every
// frame, and counts teleports: a frame-to-frame move the puck can't physically make.
// Env as for e2e.mjs (PW, CHROME, BASE).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const LAG = process.env.LAG ?? '60', JIT = process.env.JIT ?? '30', SECS = Number(process.env.SECS ?? 25);
const MAX_SPEED = 2.6;   // HOCKEY.maxPuck
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`${process.env.BASE ?? 'http://localhost:8004'}/?dev=1&try=hockey&lag=${LAG}&jitter=${JIT}`);
await p.waitForSelector('.hk-big:not([hidden])', { timeout: 15000 });
await p.waitForFunction(() => { const v = window.devState()?.gv; return v?.phase === 'play' && window.devApp().now() > v.startAt; }, null, { timeout: 15000 });
await p.evaluate(() => { window.devPuckLog = []; });
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  const bx = await (await p.$('.hk-big')).boundingBox();
  if (!bx) break;
  const x = bx.x + bx.width * (0.25 + Math.random() * 0.5);
  await p.mouse.move(x, bx.y + bx.height * 0.92); await p.mouse.move(x + (Math.random() - 0.5) * 80, bx.y + bx.height * 0.52, { steps: 8 });
}
const log = await p.evaluate(() => window.devPuckLog);
await b.close();
let jumps = 0, frames = 0, worst = 0; const byOwner = [0, 0], samples = [];
for (let i = 1; i < log.length; i++) {
  const [t0, x0, y0, , n0] = log[i - 1], [t1, x1, y1, o1, n1] = log[i];
  if (n0 !== n1 || Number.isNaN(x0) || Number.isNaN(x1)) continue;
  frames++;
  const d = Math.hypot(x1 - x0, y1 - y0), max = MAX_SPEED * (t1 - t0) / 1000 + 0.01;
  if (d > max) { jumps++; byOwner[o1]++; worst = Math.max(worst, d); if (d > 0.1 && samples.length < 10) samples.push(`${d.toFixed(3)} in ${(t1 - t0).toFixed(0)}ms owner ${log[i - 1][3]}→${o1} | drawn (${x0.toFixed(2)},${y0.toFixed(2)})→(${x1.toFixed(2)},${y1.toFixed(2)}) predicted (${log[i-1][8].toFixed(2)},${log[i-1][9].toFixed(2)})→(${log[i][8].toFixed(2)},${log[i][9].toFixed(2)}) off (${log[i][6].toFixed(2)},${log[i][7].toFixed(2)})`); }
}
console.log(`lag ${LAG}±${JIT}: ${frames} frames, ${jumps} teleports (${(100 * jumps / Math.max(1, frames)).toFixed(1)}%), worst ${worst.toFixed(3)} units; while I own it ${byOwner[1]}, while not ${byOwner[0]}`);
console.log(samples.join('\n'));
if (errs.length) console.log('errors', errs);

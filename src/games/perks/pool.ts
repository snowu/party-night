// Trick Shot (client). Aim by dragging back from anywhere, like a slingshot; let
// go to shoot. My shot plays out straight away from the shared sim (shared/pool.ts),
// which is the same sim the server scores with. At the reveal every shot is
// replayed side by side from the shots the server hands back.
import { POCKETS, POOL, quantize, rack, shoot, step, type Layout, type Shot, type Table } from '../../../shared/pool.ts';
import { chip, esc, tickTimers, type App, type GameClient } from '../../app.ts';
import { gains, head, waiting } from '../social/views.ts';
import { canPlay } from '../social/wrap.ts';

const RAIL = 0.07;                       // rail width, table units
const FULL_PULL = 0.5;                   // a drag this long (table units) is full power
const BALLS = ['#ffd23f', '#2f6fdf', '#e5395b', '#8b5cf6', '#ff8a3d', '#2e9e57', '#9c2b3c', '#111111'];

const STEP_MS = POOL.dt * 1000;

// Run a table forward to `ms` after it was shot.
function advance(t: Table, ms: number) {
  const want = Math.floor(ms / STEP_MS);
  while (!t.done && t.steps < want) step(t);
}

function fit(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr);
  if (w && cv.width !== w) { cv.width = w; cv.height = Math.round((w * (POOL.h + 2 * RAIL)) / (POOL.w + 2 * RAIL)); }
  return cv.width / (POOL.w + 2 * RAIL);
}

interface Aim { sx: number; sy: number; cx: number; cy: number }

function drawTable(cv: HTMLCanvasElement, t: Table, aim: Aim | null) {
  const g = cv.getContext('2d')!, S = fit(cv), L = t.L;
  const X = (x: number) => (x + RAIL) * S, Y = (y: number) => (y + RAIL) * S;
  g.fillStyle = '#6b3b1f'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#0f7a4a'; g.fillRect(X(0), Y(0), POOL.w * S, POOL.h * S);
  g.fillStyle = '#05140c';
  for (const [px, py] of POCKETS) { g.beginPath(); g.arc(X(px), Y(py), L.pocket * S, 0, Math.PI * 2); g.fill(); }
  for (const [px, py, pr] of L.pegs) {
    g.beginPath(); g.arc(X(px), Y(py), pr * S, 0, Math.PI * 2);
    g.fillStyle = '#ff3d9a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, S * 0.01); g.stroke();
  }
  const cue = t.balls[0];
  if (aim && !cue.in) {
    const { dx, dy, p } = pull(aim);
    if (p > 0) {
      const len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      g.setLineDash([S * 0.03, S * 0.03]);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = Math.max(2, S * 0.008);
      g.beginPath(); g.moveTo(X(cue.x), Y(cue.y)); g.lineTo(X(cue.x + ux * (0.3 + p * 0.9)), Y(cue.y + uy * (0.3 + p * 0.9))); g.stroke();
      g.setLineDash([]);
      // The cue stick, pulled back as far as the shot is hard.
      const back = cue.r + 0.03 + p * 0.25;
      g.strokeStyle = '#e8c48a'; g.lineWidth = Math.max(4, S * 0.022); g.lineCap = 'round';
      g.beginPath(); g.moveTo(X(cue.x - ux * back), Y(cue.y - uy * back)); g.lineTo(X(cue.x - ux * (back + 0.8)), Y(cue.y - uy * (back + 0.8))); g.stroke();
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(S * 0.07)}px Inter, sans-serif`; g.textAlign = 'center';
      g.fillText(`${Math.round(p * 100)}%`, X(cue.x), Y(cue.y) - (cue.r + 0.05) * S);
    }
  }
  for (const b of t.balls) {
    if (b.in) continue;
    g.beginPath(); g.arc(X(b.x), Y(b.y), b.r * S, 0, Math.PI * 2);
    g.fillStyle = b.n === 0 ? (L.cueM > 1 ? '#2b2d42' : '#fdfdf7') : BALLS[(b.n - 1) % BALLS.length];
    g.fill();
    g.beginPath(); g.arc(X(b.x - b.r * 0.35), Y(b.y - b.r * 0.35), b.r * S * 0.3, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
  }
}

// The shot a drag gives: back from where you pressed, out the other way.
function pull(a: Aim) {
  const dx = a.sx - a.cx, dy = a.sy - a.cy, len = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, p: Math.min(1, len / FULL_PULL) };
}

export const poolGame = (): GameClient => {
  let root: HTMLElement, app: App, main: HTMLCanvasElement;
  let raf = 0, stage = -1, layout: Layout | null = null;
  let table: Table | null = null, shotAt = 0, fired = false, aim: Aim | null = null;
  let replays: Array<{ id: string; t: Table; cv: HTMLCanvasElement; cap: HTMLElement; done: boolean }> = [];
  let revAt = 0, revStage = -1;
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as any;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };
  const canAim = () => { const v = gv(); return !!v && v.step === 'q' && v.mine === null && !fired && canPlay(app) && !v.bench.includes(app.me); };

  // Pointer → table units.
  const at = (e: PointerEvent) => {
    const r = main.getBoundingClientRect(), u = r.width / (POOL.w + 2 * RAIL);
    return [(e.clientX - r.left) / u - RAIL, (e.clientY - r.top) / u - RAIL];
  };
  function onDown(e: PointerEvent) {
    if (!canAim()) return;
    main.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    aim = { sx: x, sy: y, cx: x, cy: y };
  }
  function onMove(e: PointerEvent) {
    if (!aim) return;
    [aim.cx, aim.cy] = at(e);
  }
  function onUp() {
    if (!aim) return;
    const { dx, dy, p } = pull(aim), len = Math.sqrt(dx * dx + dy * dy);
    aim = null;
    if (p < 0.05 || !canAim() || !table) return;
    const shot: Shot = { x: quantize((dx / len) * p * POOL.maxSpeed), y: quantize((dy / len) * p * POOL.maxSpeed) };
    fired = true;
    shoot(table, shot);
    shotAt = performance.now();
    app.net.game({ k: 'ans', i: gv().stage, v: shot });
    client.update(app);
  }
  const onCancel = () => { aim = null; };

  function buildReplays(v: any) {
    const grid = root.querySelector<HTMLElement>('.pool-grid')!;
    const ids = Object.keys(v.rev.shots);
    grid.innerHTML = ids.length ? ids.map(id => `<div class="pool-card" data-id="${esc(id)}"><canvas></canvas><div class="pool-cap">${chip(app.player(id))}<span class="muted">rolling…</span></div></div>`).join('')
      : '<p class="center muted">Nobody took a shot.</p>';
    replays = ids.map(id => {
      const card = grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)!;
      const t = rack(layout!);
      shoot(t, v.rev.shots[id]);
      return { id, t, cv: card.querySelector('canvas')!, cap: card.querySelector('.pool-cap')!, done: false };
    });
    revAt = performance.now();
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const v = gv();
    if (!v || !layout) return;
    if (v.step === 'q' && table) {
      const rolling = shotAt && !table.done;
      if (shotAt) advance(table, now - shotAt);
      drawTable(main, table, aim);
      if (rolling && table.done) client.update(app);   // show what went in
    }
    if (v.step === 'rev') {
      for (const r of replays) {
        advance(r.t, now - revAt);
        drawTable(r.cv, r.t, null);
        if (r.t.done && !r.done) {
          r.done = true;
          const res = v.rev.res[r.id];
          r.cap.innerHTML = `${chip(app.player(r.id))}<b>${res.pots ? `${'🎱'.repeat(Math.min(res.pots, 6))} ${res.pots}` : '0'}${res.scratch ? ' 🙈' : ''}</b>`;
        }
      }
      if (replays.every(r => r.done)) set('.pool-foot', gains(app, v.rev.gains));
    }
  }

  const client: GameClient = {
    mount(r, a) {
      root = r; app = a;
      root.className = 'pool';
      root.innerHTML = `<div class="pool-head"></div><canvas class="pool-table"></canvas><div class="pool-grid"></div><div class="pool-foot"></div>`;
      main = root.querySelector('canvas')!;
      main.addEventListener('pointerdown', onDown);
      main.addEventListener('pointermove', onMove);
      main.addEventListener('pointerup', onUp);
      main.addEventListener('pointercancel', onCancel);
      raf = requestAnimationFrame(frame);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      if (v.stage !== stage) {
        stage = v.stage; layout = v.layout; table = rack(v.layout);
        shotAt = 0; fired = false; aim = null; replays = [];
        root.querySelector('.pool-grid')!.innerHTML = '';
      }
      // Back after a reload with my shot already in: play it again.
      if (v.mine && !fired && table) { fired = true; shoot(table, v.mine); shotAt = performance.now(); }
      const rev = v.step === 'rev';
      if (rev && revStage !== stage) { revStage = stage; buildReplays(v); }
      main.hidden = rev;
      main.classList.toggle('aiming', canAim());
      set('.pool-head', `${head(v, 'Table')}<h2 class="prompt">${esc(layout!.name)}</h2><p class="center muted">${esc(layout!.tag)}</p>`);
      if (!rev) {
        const done = table?.done;
        const mineLine = !canPlay(app) ? '' : canAim() ? '<p class="center">Drag back from anywhere, let go to shoot.</p>'
          : !done ? '<p class="center muted">Rolling…</p>'
          : `<p class="center"><b>${table!.pots ? `🎱 Potted ${table!.pots}` : 'Nothing went in'}</b>${table!.scratch ? ' · 🙈 scratch' : ''}</p>`;
        set('.pool-foot', mineLine + waiting(app, v));
      } else if (replays.some(r => !r.done)) set('.pool-foot', '<p class="center muted">Instant replay…</p>');
    },
    unmount() {
      cancelAnimationFrame(raf);
      root.innerHTML = '';
    },
  };
  return client;
};

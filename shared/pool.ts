// ─── TRICK SHOT (shared sim) ──────────────────────────────────────────────────
// The billiards sim both halves run: the server to score a shot, every screen to
// replay it. A shot is fully reproducible from {layout, shot}, so this must stay
// deterministic: fixed steps, and nothing but + - * / and Math.sqrt (both exact
// in every JS engine; Math.sin, Math.hypot and friends are not).
//
// The table is 2 × 1 with six pockets: the corners and the middle of each long rail.

export const POOL = { w: 2, h: 1, r: 0.03, maxSpeed: 6, bounce: 0.99, dt: 1 / 120, maxSteps: 120 * 10 };
export const POCKETS: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];

export interface Layout {
  name: string;
  tag: string;
  cue: [number, number];
  cueR: number;
  cueM: number;                           // the cue ball's mass (object balls weigh 1)
  balls: Array<[number, number]>;
  pegs: Array<[number, number, number]>;  // fixed bumpers: x, y, radius
  kick: number;                           // bumper bounce (above 1 speeds a ball up)
  rail: number;                           // rail bounce
  friction: number;                       // speed lost per second, flat
  drag: number;                           // share of speed lost per second
  pocket: number;                         // pocket radius
}

export interface Ball { n: number; x: number; y: number; vx: number; vy: number; r: number; m: number; in: boolean }
export interface Table { L: Layout; balls: Ball[]; steps: number; done: boolean; pots: number; scratch: boolean }
export interface Shot { x: number; y: number }

export const quantize = (v: number) => Math.round(v * 1000) / 1000;

export function rack(L: Layout): Table {
  const balls: Ball[] = [{ n: 0, x: L.cue[0], y: L.cue[1], vx: 0, vy: 0, r: L.cueR, m: L.cueM, in: false }];
  L.balls.forEach(([x, y], i) => balls.push({ n: i + 1, x, y, vx: 0, vy: 0, r: POOL.r, m: 1, in: false }));
  return { L, balls, steps: 0, done: false, pots: 0, scratch: false };
}

export function shoot(t: Table, s: Shot) {
  t.balls[0].vx = s.x;
  t.balls[0].vy = s.y;
}

const nearPocket = (L: Layout, b: Ball, extra: number) =>
  POCKETS.some(([px, py]) => (b.x - px) * (b.x - px) + (b.y - py) * (b.y - py) < (L.pocket + extra) * (L.pocket + extra));

function cap(b: Ball) {
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (sp > POOL.maxSpeed) { b.vx = (b.vx / sp) * POOL.maxSpeed; b.vy = (b.vy / sp) * POOL.maxSpeed; }
}

export function step(t: Table) {
  if (t.done) return;
  const { L } = t, dt = POOL.dt, live = t.balls.filter(b => !b.in);
  let moving = false;
  for (const b of live) {
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp === 0) continue;
    const next = sp * (1 - L.drag * dt) - L.friction * dt;
    if (next <= 0.004) { b.vx = 0; b.vy = 0; continue; }
    b.vx = (b.vx / sp) * next; b.vy = (b.vy / sp) * next;
    b.x += b.vx * dt; b.y += b.vy * dt;
    moving = true;
  }
  // Ball on ball: a near-elastic bump (lossier and a packed rack soaks a break up);
  // heavier balls barely notice lighter ones.
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r, d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rel > 0) {
      const J = ((1 + POOL.bounce) * rel) / (1 / a.m + 1 / b.m);
      a.vx -= (J / a.m) * nx; a.vy -= (J / a.m) * ny;
      b.vx += (J / b.m) * nx; b.vy += (J / b.m) * ny;
    }
    const over = min - d, wa = b.m / (a.m + b.m), wb = a.m / (a.m + b.m);
    a.x -= nx * over * wa; a.y -= ny * over * wa;
    b.x += nx * over * wb; b.y += ny * over * wb;
  }
  for (const b of live) {
    for (const [px, py, pr] of L.pegs) {
      const dx = b.x - px, dy = b.y - py, min = pr + b.r, d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= (1 + L.kick) * vn * nx; b.vy -= (1 + L.kick) * vn * ny; cap(b); }
      b.x = px + nx * min; b.y = py + ny * min;
    }
    // In a pocket, or past the rail line through a pocket's mouth: it dropped.
    const off = b.x < 0 || b.x > POOL.w || b.y < 0 || b.y > POOL.h;
    if (off || POCKETS.some(([px, py]) => (b.x - px) * (b.x - px) + (b.y - py) * (b.y - py) < L.pocket * L.pocket)) {
      b.in = true; b.vx = 0; b.vy = 0;
      if (b.n === 0) t.scratch = true; else t.pots++;
      continue;
    }
    // Rails, except across a pocket's mouth.
    if (nearPocket(L, b, b.r)) continue;
    if (b.x < b.r) { b.x = b.r; b.vx = -b.vx * L.rail; cap(b); }
    if (b.x > POOL.w - b.r) { b.x = POOL.w - b.r; b.vx = -b.vx * L.rail; cap(b); }
    if (b.y < b.r) { b.y = b.r; b.vy = -b.vy * L.rail; cap(b); }
    if (b.y > POOL.h - b.r) { b.y = POOL.h - b.r; b.vy = -b.vy * L.rail; cap(b); }
  }
  t.steps++;
  if (!moving || t.steps >= POOL.maxSteps) t.done = true;
}

export function simulate(L: Layout, s: Shot): { pots: number; scratch: boolean; steps: number } {
  const t = rack(L);
  shoot(t, s);
  while (!t.done) step(t);
  return { pots: t.pots, scratch: t.scratch, steps: t.steps };
}

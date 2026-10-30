// ─── AIR HOCKEY (shared) ──────────────────────────────────────────────────────
// A knockout tournament of quick 1v1 duels on a proper table, 1 wide × 2 long.
// Side 0 defends the goal at y = 2 and plays in y ≥ 1; side 1 defends y = 0 and
// plays in y ≤ 1. Everyone sees their own goal at the bottom (side 1's view is
// turned round).
//
// Whoever's half the puck is in runs the puck (their phone, or the server for a
// bot or a phone that went quiet) and passes it on when it crosses the centre
// line, so your own hits are instant. Both halves run this same step.

export const HOCKEY = {
  W: 1, L: 2,
  goalW: 0.36,
  puckR: 0.04,
  malletR: 0.075,
  firstTo: 3,
  matchMs: 35000,
  overtimeMs: 15000,      // golden goal after a draw; still level after this, a coin decides
  countdownMs: 3000,
  breakMs: 5000,
  tickMs: 33,             // the room ticks this fast while an air hockey round is on
  sendMs: 33,             // mallet and puck updates from whoever has them
  dt: 1 / 120,
  maxPuck: 4,
  maxSwing: 3.5,          // a mallet never hits harder than this
  glide: 0.12,            // share of speed lost per second: it's an air table
  rail: 0.9,              // share of speed kept off a rail
  hit: 0.9,               // share of a hit the puck keeps
};

export interface Puck { x: number; y: number; vx: number; vy: number }
export interface Mallet { x: number; y: number; vx: number; vy: number }

export const GOAL0 = (HOCKEY.W - HOCKEY.goalW) / 2, GOAL1 = GOAL0 + HOCKEY.goalW;

// Which side's half a point is in.
export const sideOf = (y: number) => (y >= HOCKEY.L / 2 ? 0 : 1);

// The nearest place in a side's half where its mallet may be.
export function clampMallet(side: number, x: number, y: number): [number, number] {
  const r = HOCKEY.malletR, mid = HOCKEY.L / 2;
  const cx = Math.max(r, Math.min(HOCKEY.W - r, x));
  const cy = side === 0 ? Math.max(mid, Math.min(HOCKEY.L - r, y)) : Math.max(r, Math.min(mid, y));
  return [cx, cy];
}
export const homeOf = (side: number): [number, number] => [HOCKEY.W / 2, side === 0 ? HOCKEY.L - 0.25 : 0.25];

const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

// One fixed step. Returns the side whose goal the puck just went into, or -1.
export function stepPuck(p: Puck, mallets: Mallet[], dt = HOCKEY.dt): number {
  const k = 1 - HOCKEY.glide * dt;
  p.vx *= k; p.vy *= k;
  p.x += p.vx * dt; p.y += p.vy * dt;
  const r = HOCKEY.puckR, mr = HOCKEY.malletR;
  for (const m of mallets) {
    const dx = p.x - m.x, dy = p.y - m.y, d = len(dx, dy), min = r + mr;
    if (d >= min || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const rel = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
    if (rel < 0) { p.vx -= (1 + HOCKEY.hit) * rel * nx; p.vy -= (1 + HOCKEY.hit) * rel * ny; }
    p.x = m.x + nx * min; p.y = m.y + ny * min;
  }
  const sp = len(p.vx, p.vy);
  if (sp > HOCKEY.maxPuck) { p.vx *= HOCKEY.maxPuck / sp; p.vy *= HOCKEY.maxPuck / sp; }
  // Side rails.
  if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx) * HOCKEY.rail; }
  if (p.x > HOCKEY.W - r) { p.x = HOCKEY.W - r; p.vx = -Math.abs(p.vx) * HOCKEY.rail; }
  // End rails, open across the goal mouths.
  const mouth = p.x > GOAL0 && p.x < GOAL1;
  if (p.y < r) {
    if (!mouth) { p.y = r; p.vy = Math.abs(p.vy) * HOCKEY.rail; }
    else if (p.y < -r) return 1;
  }
  if (p.y > HOCKEY.L - r) {
    if (!mouth) { p.y = HOCKEY.L - r; p.vy = -Math.abs(p.vy) * HOCKEY.rail; }
    else if (p.y > HOCKEY.L + r) return 0;
  }
  return -1;
}

// Move a mallet to (nx, ny), updating its swing: smoothed, so a jumpy pointer or
// a late update doesn't count as a slapshot, and capped.
export function moveMallet(m: Mallet, nx: number, ny: number, dtSec: number, smooth = 0.35) {
  if (dtSec > 0) {
    const vx = m.vx + ((nx - m.x) / dtSec - m.vx) * smooth, vy = m.vy + ((ny - m.y) / dtSec - m.vy) * smooth;
    const sp = len(vx, vy), k = sp > HOCKEY.maxSwing ? HOCKEY.maxSwing / sp : 1;
    m.vx = vx * k; m.vy = vy * k;
  }
  m.x = nx; m.y = ny;
}

export type Phase = 'count' | 'play' | 'break';
export interface TableView {
  ids: [string, string];
  score: [number, number];
  ot: boolean;            // golden goal
  winner: number;         // -1 while playing, else the winning side
  coin: boolean;          // decided by a coin flip
}
export interface HockeyView {
  phase: Phase;
  stage: number;          // bracket round, 0-based
  stages: number;
  label: string;          // "Quarter-finals", "Final"…
  startAt: number;        // this round's puck drop
  endAt: number;          // regulation time
  nextAt: number;         // end of the break
  tables: TableView[];
  bye: string | null;
  alive: string[];        // still in the tournament
  me: { t: number; s: number } | null;
}
// A snapshot, {t:'hk'}, every tick: per table [m0x, m0y, m1x, m1y, px, py, pvx, pvy, pAt, n].
// n counts puck resets (goals), so a stale state from before a goal is ignored.
export interface HockeyFrame { t: 'hk'; at: number; T: number[][] }

// What a bracket round is called, from how many are still in.
export const stageLabel = (alive: number, stage: number) => alive <= 2 ? 'Final' : alive <= 4 ? 'Semi-finals' : `Round ${stage + 1}`;

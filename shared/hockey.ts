// Air Hockey Royale geometry both halves read. The table is a unit circle; seat i
// owns the slice [i, i+1) × 2π/n. Its zone is the outer part of that slice (from
// ZONE_IN to the rim), where its mallet may go; the middle GOAL of its stretch of
// rim is its goal mouth, the rest is wall. The centre belongs to nobody.
export const HOCKEY = {
  countdownMs: 3000,
  capMs: 75000,
  tickMs: 33,             // the room ticks this fast while a hockey round is on
  frameMs: 50,            // puck and mallet snapshots to every screen
  goal: 0.4,              // share of a slice's rim that is goal mouth…
  goalMax: 0.5,           // …but never wider than this (radians): about three mallets
  zoneIn: 0.42,           // mallets stay outside this radius
  malletSpeed: 3.2,       // table units a second
  puckR: 0.045,
  bigR: 0.07,
  lives: (n: number) => n <= 3 ? 3 : n <= 7 ? 2 : 1,   // a big table needs fewer to get through
  malletR: (n: number) => Math.min(0.085, Math.max(0.045, 0.5 / n)),
};

const TAU = Math.PI * 2;

export interface Slice { a0: number; a1: number; g0: number; g1: number; mid: number }

export function slice(i: number, n: number): Slice {
  const w = TAU / n, a0 = i * w, a1 = a0 + w, edge = (w - Math.min(HOCKEY.goalMax, w * HOCKEY.goal)) / 2;
  return { a0, a1, g0: a0 + edge, g1: a1 - edge, mid: a0 + w / 2 };
}

// Signed smallest difference between two angles.
export const angDiff = (a: number, b: number) => ((a - b + Math.PI * 3) % TAU) - Math.PI;
export const normAng = (a: number) => ((a % TAU) + TAU) % TAU;

// The nearest point to (x, y) where seat i's mallet is allowed to be.
export function clampToZone(i: number, n: number, x: number, y: number): [number, number] {
  const s = slice(i, n), mr = HOCKEY.malletR(n);
  const r = Math.max(HOCKEY.zoneIn + mr, Math.min(1 - mr, Math.sqrt(x * x + y * y)));
  const half = Math.max(0, (s.a1 - s.a0) / 2 - Math.asin(Math.min(1, mr / r)));
  const a = s.mid + Math.max(-half, Math.min(half, angDiff(Math.atan2(y, x), s.mid)));
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// Where a mallet waits: in front of its goal.
export const home = (i: number, n: number): [number, number] => clampToZone(i, n, Math.cos(slice(i, n).mid) * 0.8, Math.sin(slice(i, n).mid) * 0.8);

// Mallet movement both halves share, so my own mallet on my screen moves exactly
// as fast as the server's copy of it.
export function approach(p: [number, number], target: [number, number], dtSec: number, speed = HOCKEY.malletSpeed): [number, number] {
  const dx = target[0] - p[0], dy = target[1] - p[1], d = Math.sqrt(dx * dx + dy * dy), step = speed * dtSec;
  return d <= step ? [target[0], target[1]] : [p[0] + (dx / d) * step, p[1] + (dy / d) * step];
}

export interface HockeySeat { id: string; lives: number; out: number; goals: number }  // out: ms into the round, 0 = still in
export interface HockeyView { startAt: number; endAt: number; seats: HockeySeat[] }
// A snapshot, {t:'hockey'}: at (server ms), pucks [x, y, vx, vy, big], mallets [x, y] by seat.
export interface HockeyFrame { t: 'hockey'; at: number; b: number[][]; m: number[][] }

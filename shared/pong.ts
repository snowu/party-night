// Ping Pong Royale geometry both halves read. The table is a unit circle; seat i
// owns the slice [i, i+1) × 2π/n, and the middle GOAL of that slice is its goal
// mouth, the rest is wall. A paddle slides along its own goal mouth, at position
// p ∈ [0, 1] from the slice's start to its end.
export const PONG = {
  lives: (n: number) => n <= 3 ? 3 : n <= 7 ? 2 : 1,   // a big table needs fewer to get through
  countdownMs: 3000,
  capMs: 75000,
  tickMs: 33,             // the room ticks this fast while a pong round is on
  frameMs: 50,            // ball and paddle snapshots to every screen
  goal: 0.7,              // share of a slice that is goal mouth
  pad: 0.25,              // paddle width, as a share of the goal mouth
  padSpeed: 3,            // p units a second: across the whole mouth in a third of a second
  ballR: 0.035,
  bigR: 0.065,
};

const TAU = Math.PI * 2;

export interface Slice { a0: number; a1: number; g0: number; g1: number; half: number }

export function slice(i: number, n: number): Slice {
  const w = TAU / n, a0 = i * w, a1 = a0 + w;
  const g0 = a0 + (w * (1 - PONG.goal)) / 2, g1 = a1 - (w * (1 - PONG.goal)) / 2;
  const half = Math.min((g1 - g0) / 2, Math.max(0.05, ((g1 - g0) * PONG.pad) / 2));
  return { a0, a1, g0, g1, half };
}

// The paddle's centre angle for position p.
export const padAngle = (s: Slice, p: number) => s.g0 + s.half + (s.g1 - s.g0 - 2 * s.half) * p;

// Signed smallest difference between two angles.
export const angDiff = (a: number, b: number) => ((a - b + Math.PI * 3) % TAU) - Math.PI;
export const normAng = (a: number) => ((a % TAU) + TAU) % TAU;

// Paddle movement both halves share, so my own paddle on my screen moves exactly
// as fast as the server's copy of it.
export const approach = (p: number, target: number, dtSec: number, speed = PONG.padSpeed) =>
  Math.abs(target - p) <= speed * dtSec ? target : p + Math.sign(target - p) * speed * dtSec;

export interface PongSeat { id: string; lives: number; out: number; saves: number; goals: number }  // out: ms into the round, 0 = still in
export interface PongView { startAt: number; endAt: number; seats: PongSeat[] }
// A snapshot, {t:'pong'}: at (server ms), balls [x, y, vx, vy, big], paddles p by seat.
export interface PongFrame { t: 'pong'; at: number; b: number[][]; p: number[] }

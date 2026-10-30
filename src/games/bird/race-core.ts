// ─── RACE CORE ────────────────────────────────────────────────────────────────
// The pure, DOM-free half of the bird games (ported from LPB's multiplayer.ts):
// course tuning, coins, warps and bonks. Every client builds the same course from
// the round seed, so this must stay deterministic: no wall clock, no Math.random.
import { C, SPEED_UP_TICKS, createState, defOf, mulberry32, type GameState, type Pipe, type StateOpts } from './physics-core.ts';

// Race tuning, the knobs to turn if races feel too hard/easy: 3.5→4.5 px/tick, at
// least 1.25s between pipes, gaps 20% wider than LPB's solo mode and within 190px
// of the last one so the course flows; lighter gravity and a terminal velocity.
export const RACE_OPTS = {
  splitPowerUpRng: true, powerUps: false, startLevel: 3, maxSpeedLevel: 5, minIntervalMs: 1250, firstPipeX: 480,
  gapMul: 1.2, maxGapShift: 190,
  gravity: 0.4, flap: -8.2, maxFall: 8, softBounds: true,
} satisfies StateOpts;

// One Life has no bonks to save you, so it's gentler still.
export const ONE_LIFE_OPTS = { ...RACE_OPTS, gapMul: 1.35, maxSpeedLevel: 4 } satisfies StateOpts;

export const raceState = (seed: number, oneLife = false) => createState(seed, oneLife ? ONE_LIFE_OPTS : RACE_OPTS);

export const ITEM_GRAB_PX = 34;     // how close to the gap centre you must pass to grab a coin
// Rubber-band warp (kart-racer style): a coin throws you further the further you
// trail the leader. A nudge at the front, a real catch-up at the back.
export const WARP_MIN_PX = 150;
export const WARP_MAX_PX = 700;
export const WARP_PER_PX_BEHIND = 0.6;
export const SLINGSHOT_PX = 260;    // flap within the GO window for a launch boost
export const SLINGSHOT_WINDOW_MS = 250;

// Distance a clean, warp-free run covers in `sec` seconds (mirrors step()'s ramp).
export function courseLength(sec: number, opts: StateOpts = RACE_OPTS): number {
  let speed = C.PIPE_SPEED + (opts.startLevel ?? 0) * C.SPEED_UP_AMOUNT;
  const top = C.PIPE_SPEED + (opts.maxSpeedLevel ?? 99) * C.SPEED_UP_AMOUNT;
  let dist = 0;
  for (let t = 0; t < sec * 60; t++) {
    if (t > 0 && t % Math.round(SPEED_UP_TICKS) === 0 && speed < top) speed += C.SPEED_UP_AMOUNT;
    dist += speed;
  }
  return dist;
}

export type Coin = '' | 'warp' | 'atk';

// What sits in pipe n's gap: deterministic from the seed + spawn index, so every
// racer sees the same coins on the same pipes. ~1 in 7 warps, ~1 in 14 attacks.
export function coinAt(seed: number, n: number, coins: boolean, attacks: boolean): Coin {
  if (n < 1 || !coins) return '';
  const r = mulberry32((seed ^ Math.imul(n, 0x9E3779B1)) >>> 0)();
  if (r < 0.15) return 'warp';
  if (attacks && r < 0.22 && n > 4) return 'atk';
  return '';
}

// Judge each pipe once as its centre passes the bird: returns the coin grabbed, if any.
export function passItems(s: GameState, seen: WeakSet<Pipe>, coinOf: (n: number) => Coin): Coin {
  for (const p of s.pipes) {
    if (seen.has(p) || p.x + C.PIPE_W / 2 > C.PLAYER_X) continue;
    seen.add(p);
    const coin = coinOf(p.n);
    if (coin && Math.abs(s.player.y - (p.topH + p.gap / 2)) <= ITEM_GRAB_PX) return coin;
  }
  return '';
}

export const warpDistance = (dist: number, leadDist: number) =>
  Math.min(WARP_MAX_PX, WARP_MIN_PX + Math.max(0, leadDist - dist) * WARP_PER_PX_BEHIND);

// Jump `px` along the course and clear the runway. Position, speed and control are
// untouched, so there is nothing to recover from.
export function warp(s: GameState, px: number) {
  const r = C.PLAYER_SIZE / 2;
  s.dist += px;
  s.pipes = s.pipes.filter(p => p.x + C.PIPE_W <= C.PLAYER_X - r || p.x >= C.PLAYER_X + px);
}

// Hit something: a short stumble (world in slow-mo, pass-through) and a little hop,
// never a stop. Control stays with the player throughout.
export function bonk(s: GameState) {
  s.player.vy = -4;
  s.activeEffects.push({ defId: 'bonk', expiryTick: s.tick + defOf('bonk')!.durationTicks });
}

// Rate Limited (an attack on the leader): the same slow-mo as a bonk, minus the hop.
export function rateLimit(s: GameState) {
  s.activeEffects.push({ defId: 'bonk', expiryTick: s.tick + 60 });
}

// The bots' (and the tests') autopilot: aim at the next gap's centre plus an error
// that shrinks with skill, react with a lag. `noise` returns 0..1.
export interface Brain { skill: number; lastFlapTick: number; aimPipe: unknown; aimErr: number; zoneOutUntil: number }
export const newBrain = (skill: number): Brain => ({ skill, lastFlapTick: -99, aimPipe: null, aimErr: 0, zoneOutUntil: 0 });

export function decide(s: GameState, b: Brain, noise: () => number): boolean {
  if (s.tick < b.zoneOutUntil) return false;
  if (noise() < (1 - b.skill) * 0.0025) { b.zoneOutUntil = s.tick + 25; return false; }
  const r0 = C.PLAYER_SIZE / 2;
  const pipe = s.pipes.find(p => p.x + C.PIPE_W > C.PLAYER_X - r0);
  if (pipe !== b.aimPipe) {
    b.aimPipe = pipe;
    b.aimErr = pipe ? (noise() - 0.5) * pipe.gap * (1 - b.skill) * 0.9 : 0;
  }
  const target = pipe ? pipe.topH + pipe.gap * 0.55 + b.aimErr : C.GROUND / 2;
  const lag = 6 + Math.round((1 - b.skill) * 10);
  if (s.player.y < target || s.player.vy < 0 || s.tick - b.lastFlapTick < lag) return false;
  b.lastFlapTick = s.tick;
  return true;
}

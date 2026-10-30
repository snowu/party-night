// Ping Pong Royale: everyone defends a slice of one round table. The server runs
// the physics (fixed 120Hz steps) and sends snapshots at 20Hz; phones only send
// where they want their paddle. A ball that gets past your paddle costs a life;
// last one standing wins. Balls curve with spin, speed up on every hit, and more
// of them join as the round goes on.
//
// Lag: a phone is 50-150ms behind, so a paddle counts as there if it was there
// in any of the last few samples. Close calls go to the defender.
import { PONG, angDiff, approach, normAng, padAngle, slice, type PongSeat, type PongView } from '../../../shared/pong.ts';
import { placesByScore } from '../../../shared/points.ts';
import type { Award } from '../../../shared/protocol.ts';
import { mostAward, pick, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

const DT = 1 / 120, STEP_MS = 1000 / 120;
const SPEED0 = 0.6, SPEED_MAX = 1.8, BOOST = 1.07;
const MAGNUS = 0.8;              // how hard spin bends a ball's path
const BALL_EVERY_MS = 6000, MAX_BALLS = 8, RESPAWN_MS = 1000;
const RAMP = 0.012;              // served balls get this much faster per second of play
const HISTORY = 4;               // paddle samples kept (~130ms at 33ms ticks)
const MIN_INWARD = 0.25;         // a wall bounce always sends a ball at least this much back in

interface Ball { x: number; y: number; vx: number; vy: number; r: number; spin: number; big: boolean; last: string; miss: boolean }
interface Seat extends PongSeat {
  p: number; target: number; vel: number; hist: number[];
  bot: { skill: number; nextAt: number } | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Pong implements ServerGame {
  result: RoundResult | null = null;
  tickMs = PONG.tickMs;
  startAt: number;
  endAt: number;
  simAt: number;
  seats: Seat[];
  balls: Ball[] = [];
  nextBallAt: number;
  lastFrame = 0;

  constructor(public ctx: GameCtx, now: number) {
    this.startAt = now + PONG.countdownMs;
    this.endAt = this.startAt + PONG.capMs;
    this.simAt = this.startAt;
    this.nextBallAt = this.startAt;
    this.seats = ctx.players.map(p => ({
      id: p.id, lives: PONG.lives(ctx.players.length), out: 0, saves: 0, goals: 0,
      p: 0.5, target: 0.5, vel: 0, hist: [],
      bot: p.bot ? { skill: 0.25 + ctx.rng() * 0.45, nextAt: 0 } : null,
    }));
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  alive() { return this.seats.filter(s => !s.out); }

  onMessage(from: string, msg: any) {
    const s = this.seats.find(x => x.id === from);
    if (msg?.k === 'pad' && s && !s.bot) s.target = Math.max(0, Math.min(1, Number(msg.p) || 0));
  }

  onTick(now: number) {
    if (this.result || now < this.startAt) return;
    const n = this.seats.length;
    for (const s of this.seats) {
      s.hist.unshift(padAngle(slice(this.seats.indexOf(s), n), s.p));
      s.hist.length = Math.min(s.hist.length, HISTORY);
      if (s.bot && !s.out) this.aimBot(s, now);
    }
    // Catch up in fixed steps; a stalled tick never fast-forwards more than half a second.
    this.simAt = Math.max(this.simAt, now - 500);
    while (this.simAt + STEP_MS <= now && !this.result) {
      this.simAt += STEP_MS;
      this.step(this.simAt);
    }
    if (this.result) return;
    const wanted = Math.min(MAX_BALLS, Math.ceil(this.alive().length * 0.6), 1 + Math.floor((now - this.startAt) / BALL_EVERY_MS));
    if (this.balls.length < wanted && now >= this.nextBallAt) { this.serve(now); this.nextBallAt = now + 600; }
    if (now >= this.endAt || this.alive().length <= (n > 1 ? 1 : 0)) return this.finish();
    if (now - this.lastFrame >= PONG.frameMs) {
      this.lastFrame = now;
      this.ctx.toAll({ t: 'pong', at: now, b: this.balls.map(b => [r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), b.big ? 1 : 0]), p: this.seats.map(s => r3(s.p)) });
    }
  }

  // A new ball from the middle, aimed roughly at someone still in.
  serve(now: number) {
    const rng = this.ctx.rng, n = this.seats.length;
    const target = pick(rng, this.alive());
    const sl = slice(this.seats.indexOf(target), n);
    const a = (sl.g0 + sl.g1) / 2 + (rng() - 0.5) * 0.5;
    const big = rng() < 0.2;
    const sp = Math.min(SPEED_MAX, SPEED0 * (1 + RAMP * (now - this.startAt) / 1000)) * (big ? 0.75 : 1);
    this.balls.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: big ? PONG.bigR : PONG.ballR, spin: 0, big, last: '', miss: false });
  }

  step(now: number) {
    const n = this.seats.length;
    this.seats.forEach((s, i) => {
      const sl = slice(i, n), before = padAngle(sl, s.p);
      s.p = approach(s.p, s.target, DT, s.bot ? PONG.padSpeed * (0.45 + 0.45 * s.bot.skill) : PONG.padSpeed);
      s.vel = (padAngle(sl, s.p) - before) / DT;
    });
    for (const b of this.balls) {
      // Spin bends the path without changing the speed.
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy), k = b.spin * MAGNUS * (b.big ? 2 : 1) * DT;
      const vx = b.vx - b.vy * k, vy = b.vy + b.vx * k, s2 = Math.sqrt(vx * vx + vy * vy) || 1;
      b.vx = (vx / s2) * sp; b.vy = (vy / s2) * sp;
      b.spin *= 1 - 0.6 * DT;
      b.x += b.vx * DT; b.y += b.vy * DT;
    }
    this.collideBalls();
    for (const b of [...this.balls]) this.rim(b, now);
  }

  collideBalls() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy), min = a.r + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    }
  }

  rim(b: Ball, now: number) {
    const d = Math.sqrt(b.x * b.x + b.y * b.y);
    if (d + b.r < 0.99) { b.miss = false; return; }
    if (d + b.r < 1) return;
    const n = this.seats.length, nx = b.x / d, ny = b.y / d;
    const a = normAng(Math.atan2(b.y, b.x));
    const i = Math.min(n - 1, Math.floor(a / ((Math.PI * 2) / n)));
    const seat = this.seats[i], sl = slice(i, n);
    const mouth = !seat.out && a >= sl.g0 && a <= sl.g1;
    const outward = b.vx * nx + b.vy * ny > 0;
    if (!mouth) {
      if (outward) this.bounce(b, nx, ny, seat.out ? 1.12 : 1);
      b.x = nx * (1 - b.r); b.y = ny * (1 - b.r);
      return;
    }
    if (!b.miss && outward) {
      const hit = [padAngle(sl, seat.p), ...(seat.bot ? [] : seat.hist)].find(p => Math.abs(angDiff(a, p)) <= sl.half + b.r);
      if (hit !== undefined) {
        // Breakout rules: where it lands on the paddle sets the angle out; the
        // paddle's own movement puts spin on it.
        const off = Math.max(-1, Math.min(1, angDiff(a, hit) / sl.half)) * 0.75;
        const sp = Math.min(SPEED_MAX, Math.sqrt(b.vx * b.vx + b.vy * b.vy) * BOOST);
        const c = Math.cos(off), s = Math.sin(off);
        b.vx = (-nx * c + ny * s) * sp; b.vy = (-ny * c - nx * s) * sp;
        b.spin = Math.max(-6, Math.min(6, seat.vel * 2 + (this.ctx.rng() - 0.5)));
        b.x = nx * (1 - b.r); b.y = ny * (1 - b.r);
        b.last = seat.id;
        seat.saves++;
        return;
      }
      b.miss = true;
    }
    if (d - b.r > 1) this.goal(b, seat, now);
  }

  bounce(b: Ball, nx: number, ny: number, e: number) {
    const sp = Math.min(SPEED_MAX, Math.sqrt(b.vx * b.vx + b.vy * b.vy) * e);
    const vn = b.vx * nx + b.vy * ny;
    let tx = b.vx - vn * nx, ty = b.vy - vn * ny;
    const inward = Math.max(MIN_INWARD * sp, Math.abs(vn) * e);
    const tl = Math.sqrt(tx * tx + ty * ty) || 1, keep = Math.sqrt(Math.max(0, sp * sp - inward * inward));
    tx = (tx / tl) * keep; ty = (ty / tl) * keep;
    b.vx = tx - nx * inward; b.vy = ty - ny * inward;
  }

  goal(b: Ball, seat: Seat, now: number) {
    this.balls = this.balls.filter(x => x !== b);
    this.nextBallAt = Math.max(this.nextBallAt, now + RESPAWN_MS);
    seat.lives--;
    const by = this.seats.find(s => s.id === b.last && s !== seat);
    if (by) by.goals++;
    if (seat.lives <= 0) {
      seat.out = Math.max(1, Math.round(now - this.startAt));
      this.ctx.event(`💥 ${this.name(seat.id)} is out${by ? `, courtesy of ${this.name(by.id)}` : ''}`);
    } else this.ctx.send(seat.id, { t: 'event', text: `💔 ${seat.lives} ${seat.lives === 1 ? 'life' : 'lives'} left` });
    this.ctx.changed();
  }

  // Bots watch for the ball that reaches their mouth first and head for where it
  // will land, a little off and a little late depending on skill.
  aimBot(s: Seat, now: number) {
    const bot = s.bot!;
    if (now < bot.nextAt) return;
    bot.nextAt = now + 90 + this.ctx.rng() * 260 * (1.2 - bot.skill);
    const sl = slice(this.seats.indexOf(s), this.seats.length);
    let best: { t: number; a: number } | null = null;
    for (const b of this.balls) {
      const R = 1 - b.r, pv = b.x * b.vx + b.y * b.vy, vv = b.vx * b.vx + b.vy * b.vy;
      const disc = pv * pv - vv * (b.x * b.x + b.y * b.y - R * R);
      if (vv === 0 || disc < 0) continue;
      const t = (-pv + Math.sqrt(disc)) / vv;
      const a = normAng(Math.atan2(b.y + b.vy * t, b.x + b.vx * t));
      if (a < sl.g0 - 0.1 || a > sl.g1 + 0.1 || (best && best.t < t)) continue;
      best = { t, a };
    }
    if (!best) { s.target = 0.5; return; }
    if (this.ctx.rng() < 0.2) return;   // distracted

    const err = (this.ctx.rng() - 0.5) * 4.4 * sl.half * (1.1 - bot.skill);
    s.target = Math.max(0, Math.min(1, (best.a + err - sl.g0 - sl.half) / (sl.g1 - sl.g0 - 2 * sl.half || 1)));
  }

  finish() {
    // Still in beats out; then more lives, then more goals scored. Out players
    // rank by how long they lasted.
    const score = (s: Seat) => s.out ? s.out : 1e9 + s.lives * 1e6 + s.goals;
    const ranking = placesByScore(this.seats, score).map(({ item: s, place }) => ({
      id: s.id, place, stat: s.out ? `💥 out at ${Math.round(s.out / 1000)}s` : `${'❤️'.repeat(s.lives)} left`,
    }));
    const alive = this.alive();
    const headline = alive.length === 1 ? `🏓 ${this.name(alive[0].id)} is the last one at the table`
      : alive.length ? `🏓 Time! ${alive.length} people still standing`
      : '🏓 Nobody survived the ping pong table';
    const awards = [
      mostAward(this.ctx.players, id => this.seats.find(s => s.id === id)?.saves ?? 0, '🧱', 'Brick Wall', n => `returned ${n} balls`),
      mostAward(this.ctx.players, id => this.seats.find(s => s.id === id)?.goals ?? 0, '🌀', 'Top Spin', n => `scored on teammates ${n}×`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view(): PongView {
    return { startAt: this.startAt, endAt: this.endAt, seats: this.seats.map(({ id, lives, out, saves, goals }) => ({ id, lives, out, saves, goals })) };
  }
}

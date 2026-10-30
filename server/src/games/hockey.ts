// Air Hockey Royale: everyone guards a goal on the rim of one round table, with a
// mallet they drag anywhere in their own zone. The server runs the physics (fixed
// 120Hz steps) and sends snapshots at 20Hz; phones only send where they want their
// mallet. The puck takes its speed from how hard the mallet hits it. A puck in your
// goal costs a life; last one standing wins, and goals scored break ties.
//
// Lag: a phone is 50-150ms behind, so a mallet counts as guarding the goal mouth
// if it was there in any of the last few samples. Close calls go to the defender.
import { HOCKEY, angDiff, approach, clampToZone, home, normAng, slice, type HockeySeat, type HockeyView } from '../../../shared/hockey.ts';
import { placesByScore } from '../../../shared/points.ts';
import type { Award } from '../../../shared/protocol.ts';
import { mostAward, pick, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

const DT = 1 / 120, STEP_MS = 1000 / 120;
const SERVE = 0.6, MIN_SPEED = 0.3, MAX_SPEED = 2.6;
const GLIDE = 0.2;               // share of speed lost per second: it's an air table
const HIT = 0.9;                 // how much of a hit the puck keeps (1 = perfectly bouncy)
const BALL_EVERY_MS = 8000, MAX_PUCKS = 6, RESPAWN_MS = 1000;
const HISTORY = 4;               // mallet samples kept (~130ms at 33ms ticks)
const MIN_INWARD = 0.25;         // a wall bounce always sends a puck at least this much back in
const BOT_SPEED = 3.2;           // bots' mallets are slower than a hand, by design
const KMH = 40;                  // table units a second → km/h, for the Slapshot award

type V = [number, number];
interface Puck { x: number; y: number; vx: number; vy: number; r: number; big: boolean; last: string; miss: boolean }
interface Seat extends HockeySeat {
  m: V; target: V; vel: V; hist: V[];
  blocks: number; slap: number;
  bot: { skill: number; nextAt: number } | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export class Hockey implements ServerGame {
  result: RoundResult | null = null;
  tickMs = HOCKEY.tickMs;
  startAt: number;
  endAt: number;
  simAt: number;
  n: number;
  mr: number;
  seats: Seat[];
  pucks: Puck[] = [];
  nextPuckAt: number;
  lastFrame = 0;

  constructor(public ctx: GameCtx, now: number) {
    this.startAt = now + HOCKEY.countdownMs;
    this.endAt = this.startAt + HOCKEY.capMs;
    this.simAt = this.startAt;
    this.nextPuckAt = this.startAt;
    this.n = ctx.players.length;
    this.mr = HOCKEY.malletR(this.n);
    this.seats = ctx.players.map((p, i) => ({
      id: p.id, lives: HOCKEY.lives(this.n), out: 0, goals: 0, blocks: 0, slap: 0,
      m: home(i, this.n), target: home(i, this.n), vel: [0, 0], hist: [],
      bot: p.bot ? { skill: 0.25 + ctx.rng() * 0.5, nextAt: 0 } : null,
    }));
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  alive() { return this.seats.filter(s => !s.out); }

  onMessage(from: string, msg: any) {
    const i = this.seats.findIndex(x => x.id === from), s = this.seats[i];
    if (msg?.k !== 'mallet' || !s || s.bot) return;
    const x = Number(msg.x), y = Number(msg.y);
    if (Number.isFinite(x) && Number.isFinite(y)) s.target = clampToZone(i, this.n, x, y);
  }

  onTick(now: number) {
    if (this.result || now < this.startAt) return;
    this.seats.forEach((s, i) => {
      s.hist.unshift([s.m[0], s.m[1]]);
      s.hist.length = Math.min(s.hist.length, HISTORY);
      if (s.bot && !s.out) this.aimBot(s, i, now);
    });
    // Catch up in fixed steps; a stalled tick never fast-forwards more than half a second.
    this.simAt = Math.max(this.simAt, now - 500);
    while (this.simAt + STEP_MS <= now && !this.result) {
      this.simAt += STEP_MS;
      this.step(this.simAt);
    }
    const wanted = Math.min(MAX_PUCKS, Math.ceil(this.alive().length * 0.6), 1 + Math.floor((now - this.startAt) / BALL_EVERY_MS));
    if (this.pucks.length < wanted && now >= this.nextPuckAt) { this.serve(); this.nextPuckAt = now + 600; }
    if (now >= this.endAt || this.alive().length <= (this.n > 1 ? 1 : 0)) return this.finish();
    if (now - this.lastFrame >= HOCKEY.frameMs) {
      this.lastFrame = now;
      this.ctx.toAll({
        t: 'hockey', at: now,
        b: this.pucks.map(b => [r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), b.big ? 1 : 0]),
        m: this.seats.map(s => [r3(s.m[0]), r3(s.m[1])]),
      });
    }
  }

  // A new puck from the middle, sent at a wall between two goals, so nobody
  // loses a life to a serve they never touched.
  serve() {
    const rng = this.ctx.rng;
    const a = slice(this.seats.indexOf(pick(rng, this.alive())), this.n).a0 + (rng() - 0.5) * 0.3;
    const big = rng() < 0.2;
    this.pucks.push({ x: 0, y: 0, vx: Math.cos(a) * SERVE, vy: Math.sin(a) * SERVE, r: big ? HOCKEY.bigR : HOCKEY.puckR, big, last: '', miss: false });
  }

  step(now: number) {
    for (const s of this.seats) {
      if (s.out) continue;
      const before = s.m;
      s.m = approach(s.m, s.target, DT, s.bot ? BOT_SPEED * (0.45 + 0.45 * s.bot.skill) : HOCKEY.malletSpeed);
      s.vel = [(s.m[0] - before[0]) / DT, (s.m[1] - before[1]) / DT];
    }
    for (const b of this.pucks) {
      // Air table: barely any friction, and a puck never quite stops.
      const sp = len(b.vx, b.vy), next = Math.max(MIN_SPEED, sp * (1 - GLIDE * DT));
      if (sp > 0) { b.vx *= next / sp; b.vy *= next / sp; }
      b.x += b.vx * DT; b.y += b.vy * DT;
    }
    this.collidePucks();
    for (const b of this.pucks) this.seats.forEach(s => { if (!s.out) this.mallet(b, s, s.m, s.vel); });
    for (const b of [...this.pucks]) this.rim(b, now);
  }

  collidePucks() {
    const bs = this.pucks;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy), min = a.r + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    }
  }

  // Puck on mallet: the mallet doesn't give, so the puck bounces off it and picks
  // up the mallet's own speed. Returns whether they touched.
  mallet(b: Puck, s: Seat, m: V, vel: V): boolean {
    const dx = b.x - m[0], dy = b.y - m[1], d = len(dx, dy), min = b.r + this.mr;
    if (d >= min || d === 0) return false;
    const nx = dx / d, ny = dy / d;
    const rel = (b.vx - vel[0]) * nx + (b.vy - vel[1]) * ny;
    if (rel < 0) {
      const outward = b.x * b.vx + b.y * b.vy > 0;   // was heading for the rim
      b.vx -= (1 + HIT) * rel * nx; b.vy -= (1 + HIT) * rel * ny;
      const sp = len(b.vx, b.vy);
      if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
      s.slap = Math.max(s.slap, Math.min(sp, MAX_SPEED));
      if (outward) s.blocks++;
      b.last = s.id;
    }
    b.x = m[0] + nx * min; b.y = m[1] + ny * min;
    return true;
  }

  rim(b: Puck, now: number) {
    const d = len(b.x, b.y);
    if (d + b.r < 0.99) { b.miss = false; return; }
    if (d + b.r < 1) return;
    const nx = b.x / d, ny = b.y / d;
    const a = normAng(Math.atan2(b.y, b.x));
    const i = Math.min(this.n - 1, Math.floor(a / ((Math.PI * 2) / this.n)));
    const seat = this.seats[i], sl = slice(i, this.n);
    const mouth = !seat.out && a >= sl.g0 && a <= sl.g1;
    const outward = b.vx * nx + b.vy * ny > 0;
    if (!mouth) {
      if (outward) this.bounce(b, nx, ny, seat.out ? 1.12 : 1);
      b.x = nx * (1 - b.r); b.y = ny * (1 - b.r);
      return;
    }
    if (!b.miss && outward) {
      // The defender's benefit of the doubt: was their mallet here a moment ago?
      if (!seat.bot && seat.hist.some(m => this.mallet(b, seat, m, [0, 0]))) return;
      b.miss = true;
    }
    if (d - b.r > 1) this.goal(b, seat, now);
  }

  bounce(b: Puck, nx: number, ny: number, e: number) {
    const sp = Math.min(MAX_SPEED, len(b.vx, b.vy) * e);
    const vn = b.vx * nx + b.vy * ny;
    let tx = b.vx - vn * nx, ty = b.vy - vn * ny;
    const inward = Math.max(MIN_INWARD * sp, Math.abs(vn) * e);
    const tl = len(tx, ty) || 1, keep = Math.sqrt(Math.max(0, sp * sp - inward * inward));
    tx = (tx / tl) * keep; ty = (ty / tl) * keep;
    b.vx = tx - nx * inward; b.vy = ty - ny * inward;
  }

  goal(b: Puck, seat: Seat, now: number) {
    this.pucks = this.pucks.filter(x => x !== b);
    this.nextPuckAt = Math.max(this.nextPuckAt, now + RESPAWN_MS);
    seat.lives--;
    const by = this.seats.find(s => s.id === b.last && s !== seat);
    if (by) by.goals++;
    if (seat.lives <= 0) {
      seat.out = Math.max(1, Math.round(now - this.startAt));
      this.ctx.event(`🥅 ${this.name(seat.id)} is out${by ? `, courtesy of ${this.name(by.id)}` : ''}`);
    } else this.ctx.send(seat.id, { t: 'event', text: `💔 ${seat.lives} ${seat.lives === 1 ? 'life' : 'lives'} left` });
    this.ctx.changed();
  }

  // Bots: if a puck is in their zone and they're between it and their goal, they
  // go through it; otherwise they get between their goal and the biggest threat.
  // A little off and a little late, depending on skill.
  aimBot(s: Seat, i: number, now: number) {
    const bot = s.bot!;
    if (now < bot.nextAt) return;
    bot.nextAt = now + 90 + this.ctx.rng() * 260 * (1.2 - bot.skill);
    if (this.ctx.rng() < 0.15) return;   // distracted
    const sl = slice(i, this.n), gx = Math.cos(sl.mid), gy = Math.sin(sl.mid);
    const inZone = (b: Puck) => len(b.x, b.y) > HOCKEY.zoneIn && Math.abs(angDiff(Math.atan2(b.y, b.x), sl.mid)) < (sl.a1 - sl.a0) / 2;
    const err = () => (this.ctx.rng() - 0.5) * 0.25 * (1.1 - bot.skill);
    const mine = this.pucks.filter(inZone).sort((a, b) => len(a.x - gx, a.y - gy) - len(b.x - gx, b.y - gy))[0];
    if (mine) {
      const behind = len(s.m[0] - gx, s.m[1] - gy) < len(mine.x - gx, mine.y - gy);
      // Strike through the puck, away from the goal; or circle back behind it.
      const ux = mine.x - gx, uy = mine.y - gy, ul = len(ux, uy) || 1;
      s.target = behind
        ? clampToZone(i, this.n, mine.x + (ux / ul) * 0.15 + err(), mine.y + (uy / ul) * 0.15 + err())
        : clampToZone(i, this.n, mine.x - (ux / ul) * 0.2 + err(), mine.y - (uy / ul) * 0.2 + err());
      return;
    }
    let best: { t: number; a: number } | null = null;
    for (const b of this.pucks) {
      const R = 1 - b.r, pv = b.x * b.vx + b.y * b.vy, vv = b.vx * b.vx + b.vy * b.vy;
      const disc = pv * pv - vv * (b.x * b.x + b.y * b.y - R * R);
      if (vv === 0 || disc < 0) continue;
      const t = (-pv + Math.sqrt(disc)) / vv;
      const a = Math.atan2(b.y + b.vy * t, b.x + b.vx * t);
      if (Math.abs(angDiff(a, sl.mid)) > (sl.a1 - sl.a0) / 2 || (best && best.t < t)) continue;
      best = { t, a };
    }
    const a = best ? best.a : sl.mid;
    s.target = clampToZone(i, this.n, Math.cos(a) * 0.85 + err(), Math.sin(a) * 0.85 + err());
  }

  finish() {
    // Still in beats out; then more lives, then more goals. Out players rank by
    // how long they lasted, then goals.
    const score = (s: Seat) => (s.out ? s.out * 1000 : 1e12 + s.lives * 1e6) + s.goals;
    const goals = (s: Seat) => s.goals ? ` · ${s.goals} goal${s.goals === 1 ? '' : 's'}` : '';
    const ranking = placesByScore(this.seats, score).map(({ item: s, place }) => ({
      id: s.id, place, stat: (s.out ? `🥅 out at ${Math.round(s.out / 1000)}s` : `${'❤️'.repeat(s.lives)} left`) + goals(s),
    }));
    const alive = this.alive();
    const headline = alive.length === 1 ? `🏒 ${this.name(alive[0].id)} is the last one at the table`
      : alive.length ? `🏒 Time! ${alive.length} people still standing`
      : '🏒 Nobody survived the air hockey table';
    const seat = (id: string) => this.seats.find(s => s.id === id);
    const awards = [
      mostAward(this.ctx.players, id => seat(id)?.goals ?? 0, '🎯', 'Sniper', n => `scored ${n} goal${n === 1 ? '' : 's'}`),
      mostAward(this.ctx.players, id => seat(id)?.blocks ?? 0, '🧱', 'Brick Wall', n => `blocked ${n} shots`),
      mostAward(this.ctx.players, id => Math.round((seat(id)?.slap ?? 0) * KMH), '⚡', 'Slapshot', n => `hit it at ${n} km/h`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view(): HockeyView {
    return { startAt: this.startAt, endAt: this.endAt, seats: this.seats.map(({ id, lives, out, goals }) => ({ id, lives, out, goals })) };
  }
}

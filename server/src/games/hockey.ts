// Air Hockey: a knockout tournament of quick 1v1 duels, every match of a bracket
// round at once. First to 3, or the most goals after 35s; a draw goes to golden
// goal, then a coin. An odd one out gets a bye (never the same person twice if
// it can be helped). Knocked-out players watch the tables still going.
//
// The puck is run by whoever's half it's in (shared/hockey.ts): the phones send
// it on, the server relays it, keeps score, and runs it itself for a bot's half
// or for a phone that has gone quiet.
import { HOCKEY, clampMallet, homeOf, moveMallet, sideOf, stageLabel, stepPuck, type HockeyView, type Mallet, type Phase, type Puck } from '../../../shared/hockey.ts';
import { placesByScore } from '../../../shared/points.ts';
import type { Award } from '../../../shared/protocol.ts';
import { mostAward, pick, shuffle, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

const QUIET_MS = 600;            // a phone that owns the puck but hasn't sent it this long: the server takes over
const CATCH_UP_MS = 500;

interface Side { id: string; m: Mallet; target: [number, number]; lastM: number; lastP: number; skill: number; nextAim: number }
interface Table {
  sides: [Side, Side];
  score: [number, number];
  puck: Puck & { at: number; n: number };
  ownSince: number;
  ot: boolean;
  winner: number;
  coin: boolean;
  goal: number;                  // the side that just conceded, during the slow-mo pause; else -1
  resumeAt: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

export class Hockey implements ServerGame {
  result: RoundResult | null = null;
  tickMs = HOCKEY.tickMs;
  phase: Phase = 'count';
  stage = -1;
  stages: number;
  alive: string[];
  out = new Map<string, number>();           // id → bracket round they went out in
  byes = new Set<string>();
  bye: string | null = null;
  tables: Table[] = [];
  startAt = 0;
  endAt = 0;
  nextAt = 0;
  gf = new Map<string, number>();
  ga = new Map<string, number>();
  cleanSheets = new Map<string, number>();
  golden = new Map<string, number>();
  skill = new Map<string, number>();

  constructor(public ctx: GameCtx, now: number) {
    this.alive = ctx.players.map(p => p.id);
    this.stages = Math.max(1, Math.ceil(Math.log2(this.alive.length)));
    for (const p of ctx.players) if (p.bot) this.skill.set(p.id, 0.3 + ctx.rng() * 0.5);
    this.nextStage(now);
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  isBot(id: string) { return !!this.ctx.players.find(p => p.id === id)?.bot; }
  add(m: Map<string, number>, id: string, n = 1) { m.set(id, (m.get(id) ?? 0) + n); }

  // Pair up whoever is still in; an odd one out goes straight through.
  nextStage(now: number) {
    this.stage++;
    const rng = this.ctx.rng;
    let pool = shuffle(rng, this.alive);
    this.bye = null;
    if (pool.length % 2) {
      const fresh = pool.filter(id => !this.byes.has(id));
      this.bye = pick(rng, fresh.length ? fresh : pool);
      this.byes.add(this.bye);
      pool = pool.filter(id => id !== this.bye);
    }
    this.phase = 'count';
    this.startAt = now + HOCKEY.countdownMs;
    this.endAt = this.startAt + HOCKEY.matchMs;
    this.tables = [];
    const side = (id: string, s: number): Side => {
      const [x, y] = homeOf(s);
      return { id, m: { x, y, vx: 0, vy: 0 }, target: [x, y], lastM: now, lastP: 0, skill: this.skill.get(id) ?? 0.5, nextAim: 0 };
    };
    for (let i = 0; i + 1 < pool.length; i += 2) {
      const t: Table = { sides: [side(pool[i], 0), side(pool[i + 1], 1)], score: [0, 0], puck: { x: 0, y: 0, vx: 0, vy: 0, at: now, n: 0 }, ownSince: now, ot: false, winner: -1, coin: false, goal: -1, resumeAt: 0 };
      this.drop(t, rng() < 0.5 ? 0 : 1, now);
      this.tables.push(t);
    }
    if (this.bye) this.ctx.event(`🎟️ ${this.name(this.bye)} gets a bye`);
    this.ctx.changed();
  }

  // Puck down in one side's half, still.
  drop(t: Table, side: number, now: number) {
    t.puck = { x: HOCKEY.W / 2, y: side === 0 ? 1.35 : 0.65, vx: 0, vy: 0, at: now, n: t.puck.n + 1 };
    t.ownSince = now;
  }

  // A player's table while it's being played, and through the replay of its last goal.
  where(id: string): { t: Table; s: number } | null {
    for (const t of this.tables) for (const s of [0, 1]) if (t.sides[s].id === id && (t.winner < 0 || t.goal >= 0)) return { t, s };
    return null;
  }

  // Does the server run this side's half (a bot, or a phone that isn't sending)?
  serverRuns(t: Table, s: number, now: number) {
    const side = t.sides[s];
    return this.isBot(side.id) || !this.ctx.connected(side.id) || now - Math.max(t.ownSince, side.lastP) > QUIET_MS;
  }

  onMessage(from: string, msg: any, now: number) {
    const w = this.phase === 'break' ? null : this.where(from);
    if (!w || w.t.winner >= 0) return;
    const { t, s } = w, side = t.sides[s], p = t.puck;
    if (msg?.k === 'm') {
      const [x, y] = clampMallet(s, Number(msg.x) || 0, Number(msg.y) || 0);
      moveMallet(side.m, x, y, (now - side.lastM) / 1000, 0.5);
      side.lastM = now;
      return;
    }
    // Only whoever has the puck may move it on, and never with a state from before a goal.
    if (this.phase !== 'play' || t.goal >= 0 || msg?.n !== p.n || sideOf(p.y) !== s) return;
    if (msg.k === 'p') {
      const at = Math.min(now, Number(msg.at) || 0);
      if (at < p.at) return;
      const was = sideOf(p.y);
      t.puck = { x: num(msg.x, -0.2, HOCKEY.W + 0.2), y: num(msg.y, -0.2, HOCKEY.L + 0.2), vx: num(msg.vx, -HOCKEY.maxPuck, HOCKEY.maxPuck), vy: num(msg.vy, -HOCKEY.maxPuck, HOCKEY.maxPuck), at, n: p.n };
      side.lastP = now;
      if (sideOf(t.puck.y) !== was) t.ownSince = now;
    } else if (msg.k === 'goal') this.concede(t, s, now);
  }

  concede(t: Table, s: number, now: number) {
    const scorer = 1 - s, ids = t.sides.map(x => x.id);
    t.score[scorer]++;
    this.add(this.gf, ids[scorer]);
    this.add(this.ga, ids[s]);
    for (const id of ids) if (!this.isBot(id)) this.ctx.send(id, { t: 'event', text: `🥅 ${this.name(ids[scorer])} scores · ${t.score[0]}–${t.score[1]}` });
    if (t.ot) this.add(this.golden, ids[scorer]);
    // Hold the puck in the net while every screen plays the goal in slow motion.
    t.goal = s;
    t.resumeAt = now + HOCKEY.goalMs;
    t.puck.vx = t.puck.vy = 0;
    if (t.ot || t.score[scorer] >= HOCKEY.firstTo) this.win(t, scorer);
    this.ctx.changed();
  }

  win(t: Table, side: number, coin = false) {
    t.winner = side;
    t.coin = coin;
    const w = t.sides[side].id, l = t.sides[1 - side].id;
    if (t.score[1 - side] === 0 && !coin) this.add(this.cleanSheets, w);
    this.out.set(l, this.stage);
    this.alive = this.alive.filter(id => id !== l);
    this.ctx.event(`${coin ? '🪙' : '🏒'} ${this.name(w)} beats ${this.name(l)} ${Math.max(...t.score)}–${Math.min(...t.score)}${coin ? ' on a coin flip' : ''}`);
    this.ctx.changed();
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.phase === 'count' && now >= this.startAt) {
      this.phase = 'play';
      for (const t of this.tables) { t.puck.at = now; t.ownSince = now; }
      this.ctx.changed();
    }
    if (this.phase === 'play') {
      for (const t of this.tables) {
        if (t.winner < 0) this.run(t, now);
        else if (t.goal >= 0 && now >= t.resumeAt) { t.goal = -1; this.ctx.changed(); }   // the winning goal's replay is over
      }
      if (this.tables.every(t => t.winner >= 0)) { this.phase = 'break'; this.nextAt = now + HOCKEY.breakMs + HOCKEY.goalMs; this.ctx.changed(); }
    } else if (this.phase === 'break' && now >= this.nextAt) {
      if (this.alive.length > 1) this.nextStage(now);
      else return this.finish();
    }
    this.ctx.toAll({
      t: 'hk', at: now,
      T: this.tables.map(t => [...t.sides.flatMap(x => [r3(x.m.x), r3(x.m.y)]), r3(t.puck.x), r3(t.puck.y), r3(t.puck.vx), r3(t.puck.vy), Math.round(t.puck.at), t.puck.n, t.goal]),
    });
  }

  run(t: Table, now: number) {
    for (const s of [0, 1]) {
      const side = t.sides[s];
      if (this.isBot(side.id) || !this.ctx.connected(side.id)) this.aim(t, s, now);
    }
    if (t.goal >= 0) {
      if (now < t.resumeAt) return;
      this.drop(t, t.goal, now);
      t.goal = -1;
      this.ctx.changed();
    }
    // Run the puck while it's in a half the server has, until it crosses to a phone.
    const p = t.puck;
    p.at = Math.max(p.at, now - CATCH_UP_MS);
    while (p.at + HOCKEY.dt * 1000 <= now && this.serverRuns(t, sideOf(p.y), now)) {
      const was = sideOf(p.y);
      const g = stepPuck(p, t.sides.map(x => x.m));
      p.at += HOCKEY.dt * 1000;
      if (g >= 0) return this.concede(t, g, now);
      if (sideOf(p.y) !== was) t.ownSince = now;
    }
    if (now >= this.endAt + (t.ot ? HOCKEY.overtimeMs : 0)) {
      if (t.score[0] !== t.score[1]) this.win(t, t.score[0] > t.score[1] ? 0 : 1);
      else if (!t.ot) { t.ot = true; this.ctx.changed(); }
      else this.win(t, this.ctx.rng() < 0.5 ? 0 : 1, true);
    }
  }

  // Bots (and a phone that dropped): strike a puck in their half from the goal
  // side, otherwise guard the goal, a little late and a little off.
  aim(t: Table, s: number, now: number) {
    const side = t.sides[s], p = t.puck, rng = this.ctx.rng;
    const gy = s === 0 ? HOCKEY.L : 0, dir = s === 0 ? -1 : 1;
    if (now >= side.nextAim) {
      side.nextAim = now + 80 + rng() * 220 * (1.2 - side.skill);
      const noise = () => (rng() - 0.5) * 0.18 * (1.1 - side.skill);
      if (sideOf(p.y) === s) {
        const behind = Math.abs(side.m.y - gy) < Math.abs(p.y - gy) - 0.02;
        const dx = p.x - HOCKEY.W / 2, dy = p.y - gy, d = Math.sqrt(dx * dx + dy * dy) || 1;
        side.target = behind
          ? clampMallet(s, p.x + (dx / d) * 0.15 + noise(), p.y + (dy / d) * 0.15 + noise())
          : clampMallet(s, p.x - (dx / d) * 0.2 + noise(), p.y - (dy / d) * 0.2 + noise());
      } else side.target = clampMallet(s, HOCKEY.W / 2 + (p.x - HOCKEY.W / 2) * 0.6 + noise(), gy + dir * 0.25);
    }
    const speed = 1.1 + 0.9 * side.skill, dt = this.tickMs / 1000;
    const dx = side.target[0] - side.m.x, dy = side.target[1] - side.m.y, d = Math.sqrt(dx * dx + dy * dy), step = Math.min(d, speed * dt);
    moveMallet(side.m, side.m.x + (d ? (dx / d) * step : 0), side.m.y + (d ? (dy / d) * step : 0), dt, 0.6);
  }

  finish() {
    const champ = this.alive[0];
    const gd = (id: string) => (this.gf.get(id) ?? 0) - (this.ga.get(id) ?? 0);
    const reached = (id: string) => (id === champ ? this.stages + 1 : this.out.get(id) ?? 0);
    const score = (id: string) => reached(id) * 1e6 + (gd(id) + 1000) * 1e3 + (this.gf.get(id) ?? 0);
    const labelAt = (stage: number) => {
      let n = this.ctx.players.length;
      for (let i = 0; i < stage; i++) n = Math.ceil(n / 2);
      return stageLabel(n, stage);
    };
    const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
    const ranking = placesByScore(this.ctx.players.map(p => p.id), score).map(({ item: id, place }) => ({
      id, place, stat: `${id === champ ? '🏆 champion' : `out in the ${labelAt(this.out.get(id) ?? 0)}`} · ${signed(gd(id))}`,
    }));
    const headline = champ ? `🏒 ${this.name(champ)} wins the air hockey tournament` : '🏒 Nobody won. Somehow.';
    const awards = [
      mostAward(this.ctx.players, id => this.gf.get(id) ?? 0, '🎯', 'Sniper', n => `scored ${n} goal${n === 1 ? '' : 's'}`),
      mostAward(this.ctx.players, id => this.cleanSheets.get(id) ?? 0, '🧤', 'Clean Sheet', n => `won ${n} match${n === 1 ? '' : 'es'} without conceding`),
      mostAward(this.ctx.players, id => this.golden.get(id) ?? 0, '⚡', 'Golden Goal', n => `won ${n === 1 ? 'a match' : `${n} matches`} in overtime`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view(forId: string | null): HockeyView {
    const w = forId ? this.where(forId) : null;
    const label = stageLabel(this.alive.length + this.tables.filter(t => t.winner >= 0).length, this.stage);
    return {
      phase: this.phase, stage: this.stage, stages: this.stages, label,
      startAt: this.startAt, endAt: this.endAt, nextAt: this.nextAt,
      tables: this.tables.map(t => ({ ids: [t.sides[0].id, t.sides[1].id], score: [...t.score] as [number, number], ot: t.ot, winner: t.winner, coin: t.coin })),
      bye: this.bye, alive: this.alive,
      me: w ? { t: this.tables.indexOf(w.t), s: w.s } : null,
    };
  }
}

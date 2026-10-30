// Trick Shot: everyone gets the same table and one shot, all at once. Balls
// potted score, sinking the cue ball costs. Three tables, each a little sillier.
// The server simulates every shot (shared/pool.ts) to score it, and the reveal
// hands every screen the shots so they can replay them side by side.
import { POOL, quantize, simulate, type Layout, type Shot } from '../../../shared/pool.ts';
import { StagedGame } from './staged.ts';
import { mostAward, shuffle, type GameCtx, type Seat } from './types.ts';

const TABLES = 3;
const POT = 250, SCRATCH = 250, BEST = 250;
const R = POOL.r;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const base = { cue: [0.45, 0.5] as [number, number], cueR: R, cueM: 1, pegs: [] as Layout['pegs'], kick: 1, rail: 0.85, friction: 0.2, drag: 0.25, pocket: 0.085 };

// A triangle rack pointing at the cue ball, apex at (x, y).
function triangle(x: number, y: number, rows: number, gap = 0.002): Array<[number, number]> {
  const out: Array<[number, number]> = [], dx = (2 * R + gap) * 0.866, dy = 2 * R + gap;
  for (let row = 0; row < rows; row++) for (let k = 0; k <= row; k++) out.push([round3(x + row * dx), round3(y + (k - row / 2) * dy)]);
  return out;
}

// n balls dropped at random, clear of the cue ball, the pegs and each other.
function scatter(rng: () => number, n: number, avoid: Array<[number, number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let tries = 0; out.length < n && tries < 2000; tries++) {
    const x = round3(0.75 + rng() * 1.1), y = round3(0.12 + rng() * 0.76);
    const clear = (px: number, py: number, pr: number) => (x - px) ** 2 + (y - py) ** 2 > (pr + R + 0.03) ** 2;
    if (avoid.every(([px, py, pr]) => clear(px, py, pr)) && out.every(([px, py]) => clear(px, py, R))) out.push([x, y]);
  }
  return out;
}

const LAYOUTS: Array<(rng: () => number) => Layout> = [
  () => ({ ...base, name: 'Break Room Classic', tag: 'A normal pool table. Break the rack.', balls: triangle(1.3, 0.5, 5) }),
  rng => ({ ...base, name: 'Freshly Waxed', tag: 'Facilities polished the felt. Nothing ever stops.', friction: 0.08, drag: 0.08, balls: scatter(rng, 7, [[0.45, 0.5, R]]) }),
  rng => ({ ...base, name: 'Bouncy Castle', tag: 'The rails are made of trampoline.', rail: 1.08, balls: scatter(rng, 7, [[0.45, 0.5, R]]) }),
  rng => {
    const pegs: Layout['pegs'] = [[1, 0.5, 0.06], [1.35, 0.27, 0.05], [1.35, 0.73, 0.05], [0.7, 0.25, 0.04], [0.7, 0.75, 0.04]];
    return { ...base, name: 'Pinball Wizard', tag: 'Someone installed bumpers. Nobody asked why.', pegs, kick: 1.3, balls: scatter(rng, 7, [[0.45, 0.5, R], ...pegs]) };
  },
  () => ({ ...base, name: 'Bowling Night', tag: 'Wrong ball. Roll with it.', cue: [0.35, 0.5], cueR: 0.07, cueM: 4, balls: triangle(1.35, 0.5, 4, 0.03) }),
  rng => ({ ...base, name: 'Black Hole Pockets', tag: 'Pockets the size of the backlog. Something will go in.', pocket: 0.13, balls: scatter(rng, 8, [[0.45, 0.5, R]]) }),
];

export class TrickShot extends StagedGame {
  layouts: Layout[];
  skill = new Map<string, number>();
  pots = new Map<string, number>();
  scratches = new Map<string, number>();
  bestShot = { id: '', pots: 0 };

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    // The classic table first, so everyone learns the controls on a normal one.
    this.layouts = [LAYOUTS[0], ...shuffle(ctx.rng, LAYOUTS.slice(1)).slice(0, TABLES - 1)].map(f => f(ctx.rng));
    for (const p of ctx.players) if (p.bot) this.skill.set(p.id, ctx.rng());
  }

  stages() { return TABLES; }
  stageMs() { return 25000; }

  valid(_from: string, v: any) {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
    v.x = quantize(v.x); v.y = quantize(v.y);
    const sp = Math.sqrt(v.x * v.x + v.y * v.y);
    return sp > 0.05 && sp <= POOL.maxSpeed + 0.01;
  }

  // A bot lines up a handful of rough shots at random balls in its head and takes the best.
  botAnswer(bot: Seat): Shot {
    const L = this.layouts[this.stage], rng = this.ctx.rng;
    const tries = 2 + Math.round((this.skill.get(bot.id) ?? 0.5) * 10);
    let best: { s: Shot; score: number } | null = null;
    for (let i = 0; i < tries; i++) {
      const [tx, ty] = L.balls[Math.floor(rng() * L.balls.length)];
      const a = Math.atan2(ty - L.cue[1], tx - L.cue[0]) + (rng() - 0.5) * 0.4, sp = POOL.maxSpeed * (0.35 + rng() * 0.65);
      const s = { x: quantize(Math.cos(a) * sp), y: quantize(Math.sin(a) * sp) };
      const r = simulate(L, s);
      const score = r.pots - (r.scratch ? 1.5 : 0) + rng() * 0.1;
      if (!best || score > best.score) best = { s, score };
    }
    return best!.s;
  }

  reveal() {
    const L = this.layouts[this.stage];
    const res: Record<string, { pots: number; scratch: boolean }> = {}, gains: Record<string, number> = {};
    let longest = 0;
    for (const [id, a] of this.answers) {
      const r = simulate(L, a.v);
      longest = Math.max(longest, r.steps);
      res[id] = { pots: r.pots, scratch: r.scratch };
      this.pots.set(id, (this.pots.get(id) ?? 0) + r.pots);
      if (r.scratch) this.scratches.set(id, (this.scratches.get(id) ?? 0) + 1);
      if (r.pots > this.bestShot.pots) this.bestShot = { id, pots: r.pots };
      gains[id] = Math.max(0, r.pots * POT - (r.scratch ? SCRATCH : 0));
    }
    const top = Math.max(0, ...Object.values(res).map(r => r.pots));
    for (const id of Object.keys(res)) {
      if (top > 0 && res[id].pots === top) gains[id] += BEST;
      this.add(id, gains[id]);
    }
    // Long enough to watch the slowest shot roll out, plus a beat for the scores.
    this.revMs = Math.min(15000, Math.max(5000, longest * POOL.dt * 1000 + 3000));
    return { shots: Object.fromEntries([...this.answers].map(([id, a]) => [id, { x: a.v.x, y: a.v.y }])), res, gains, top };
  }

  stageView() { return { layout: this.layouts[this.stage] }; }
  statFor(id: string) { return `${this.pots.get(id) ?? 0} potted`; }

  headline() {
    const top = [...this.pots].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `🎱 ${this.name(top[0])} potted ${top[1]} ball${top[1] === 1 ? '' : 's'}` : '🎱 Nobody potted anything. The table is decorative.';
  }

  awards() {
    return [
      this.bestShot.pots >= 3 ? { emoji: '🎯', title: 'Trick Shot', desc: `potted ${this.bestShot.pots} in one shot`, id: this.bestShot.id } : null,
      mostAward(this.ctx.players, id => this.scratches.get(id) ?? 0, '🙈', 'Scratch Artist', n => `sank the cue ball ${n}×`),
    ].filter(a => !!a);
  }
}

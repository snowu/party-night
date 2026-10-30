// Planning Poker: estimate a number. Closest without going over wins (Price is
// Right rules); going over is over budget and scores nothing.
import { ESTIMATES } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, pick, shuffle, type GameCtx, type Seat } from './types.ts';

const QUESTIONS = 4;
const PRIZES = [1000, 700, 500, 300, 200];
const MIN_PRIZE = 100;
const EXACT = 500;

export class Planning extends StagedGame {
  qs: [string, number][];
  over = new Map<string, number>();
  exact = new Map<string, number>();
  lines: string[] = [];

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.qs = shuffle(ctx.rng, ESTIMATES).slice(0, QUESTIONS);
  }

  stages() { return QUESTIONS; }
  stageMs() { return 18000; }
  valid(_from: string, v: any) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e13; }
  botAnswer(_bot: Seat) { return Math.round(this.qs[this.stage][1] * (0.6 + this.ctx.rng() * 0.6)); }

  reveal() {
    const answer = this.qs[this.stage][1];
    const guesses = [...this.answers].map(([id, a]) => ({ id, v: a.v as number, over: a.v > answer }))
      .sort((a, b) => Number(a.over) - Number(b.over) || (a.over ? a.v - b.v : b.v - a.v));
    const under = guesses.filter(g => !g.over);
    const gains: Record<string, number> = {};
    for (const g of guesses) {
      if (g.over) { this.over.set(g.id, (this.over.get(g.id) ?? 0) + 1); continue; }
      const place = under.findIndex(o => o.v === g.v);
      gains[g.id] = (PRIZES[place] ?? MIN_PRIZE) + (g.v === answer ? EXACT : 0);
      if (g.v === answer) this.exact.set(g.id, (this.exact.get(g.id) ?? 0) + 1);
      this.add(g.id, gains[g.id]);
    }
    if (guesses.length >= 3 && !under.length) this.lines.push('Everyone went over budget. Very realistic.');
    return { answer, guesses, gains };
  }

  stageView() { return { q: this.qs[this.stage][0] }; }

  headline() {
    const top = [...this.scores].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `🃏 ${this.name(top[0])} estimates like a seasoned PM` : '🃏 Every estimate was over budget. Ship it anyway.';
  }
  roast() { return this.lines.length ? pick(this.ctx.rng, this.lines) : ''; }
  awards() {
    return [
      mostAward(this.ctx.players, id => this.exact.get(id) ?? 0, '🎯', 'Accurate Estimate', n => `exactly right ${n}×. Suspicious.`),
      mostAward(this.ctx.players.filter(p => !p.bot), id => (this.over.get(id) ?? 0) >= 2 ? this.over.get(id)! : 0, '💸', 'Over Budget', n => `went over ${n}×`),
    ].filter(a => !!a);
  }
}

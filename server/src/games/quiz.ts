// Pop Quiz: four multiple-choice questions, then one closest-number guess.
import { CLOSEST, QUIZ } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, shuffle, type GameCtx, type Seat } from './types.ts';

const MC = 4;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

export class Quiz extends StagedGame {
  qs: Array<{ text: string; options: string[]; correct: number }>;
  closest: [string, number];
  fastest = new Map<string, number>();   // quickest right answer, ms
  missed = new Map<string, number>();

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.qs = shuffle(ctx.rng, QUIZ).slice(0, MC).map(([text, right, ...wrong]) => {
      const options = shuffle(ctx.rng, [right, ...wrong]);
      return { text, options, correct: options.indexOf(right) };
    });
    this.closest = shuffle(ctx.rng, CLOSEST)[0];
  }

  stages() { return MC + 1; }
  stageMs(i: number) { return i < MC ? 12000 : 20000; }
  isClosest() { return this.stage >= MC; }

  valid(_from: string, v: any) {
    if (this.isClosest()) return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e13;
    return Number.isInteger(v) && v >= 0 && v < this.qs[this.stage].options.length;
  }

  botAnswer(_bot: Seat) {
    if (this.isClosest()) return Math.round(this.closest[1] * (0.5 + this.ctx.rng()));
    const q = this.qs[this.stage];
    return this.ctx.rng() < 0.55 ? q.correct : Math.floor(this.ctx.rng() * q.options.length);
  }

  reveal() {
    const gains: Record<string, number> = {};
    for (const p of this.ctx.players) if (!this.answers.has(p.id)) this.missed.set(p.id, (this.missed.get(p.id) ?? 0) + 1);
    if (!this.isClosest()) {
      const q = this.qs[this.stage];
      const counts = q.options.map(() => 0);
      for (const [id, a] of this.answers) {
        counts[a.v]++;
        if (a.v !== q.correct) continue;
        gains[id] = this.speedPts(a.t);
        this.add(id, gains[id]);
        this.fastest.set(id, Math.min(this.fastest.get(id) ?? Infinity, a.t));
      }
      return { correct: q.correct, counts, gains };
    }
    const answer = this.closest[1];
    const guesses = [...this.answers].map(([id, a]) => ({ id, v: a.v as number, off: Math.abs(a.v - answer) }))
      .sort((a, b) => a.off - b.off);
    const PRIZES = [1500, 900, 500];
    for (const g of guesses) {
      const place = guesses.findIndex(o => o.off === g.off);
      gains[g.id] = (PRIZES[place] ?? 100) + (g.off === 0 ? 500 : 0);
      this.add(g.id, gains[g.id]);
    }
    return { answer, guesses, gains };
  }

  stageView() {
    if (this.isClosest()) return { q: { text: this.closest[0], options: [], closest: true } };
    const q = this.qs[this.stage];
    return { q: { text: q.text, options: q.options, closest: false } };
  }

  headline() {
    const top = [...this.scores].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `🧠 ${this.name(top[0])} tops the quiz with ${fmt(top[1])}` : '🧠 Nobody scored. Bold strategy.';
  }

  awards() {
    return [
      mostAward(this.ctx.players, id => this.fastest.has(id) ? 20000 - this.fastest.get(id)! : 0, '⚡', 'Quick Draw',
        n => `right answer in ${((20000 - n) / 1000).toFixed(1)}s`),
      mostAward(this.ctx.players.filter(p => !p.bot), id => (this.missed.get(id) ?? 0) >= 2 ? this.missed.get(id)! : 0, '👻', 'Ghost',
        n => `didn't answer ${n}×`),
    ].filter(a => !!a);
  }
}

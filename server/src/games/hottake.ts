// Hot Takes: agree or disagree, then guess what share of the team agrees.
import { HOT_TAKES } from './content.ts';
import { StagedGame } from './staged.ts';
import { pick, shuffle, type GameCtx, type Seat } from './types.ts';

const TAKES = 2;

export class HotTake extends StagedGame {
  takes: string[];
  lines: string[] = [];
  mind = new Map<string, number>();   // closest call, % off

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.takes = shuffle(ctx.rng, HOT_TAKES).slice(0, TAKES);
  }

  stages() { return TAKES; }
  stageMs() { return 20000; }
  revMs = 5500;
  valid(_from: string, v: any) { return v && typeof v.agree === 'boolean' && Number.isInteger(v.pct) && v.pct >= 0 && v.pct <= 100; }
  botAnswer(_bot: Seat) { return { agree: this.ctx.rng() < 0.5, pct: Math.round(this.ctx.rng() * 100) }; }

  reveal() {
    const all = [...this.answers];
    const agree = all.filter(([, a]) => a.v.agree).map(([id]) => id);
    const disagree = all.filter(([, a]) => !a.v.agree).map(([id]) => id);
    const pct = all.length ? Math.round(100 * agree.length / all.length) : 0;
    const gains: Record<string, number> = {};
    for (const [id, a] of all) {
      const off = Math.abs(a.v.pct - pct);
      gains[id] = Math.max(0, 1000 - 25 * off);
      this.add(id, gains[id]);
      this.mind.set(id, Math.min(this.mind.get(id) ?? 101, off));
    }
    if (all.length >= 3 && agree.length === 1) this.lines.push(`${this.name(agree[0])} is the only one who agrees that "${this.takes[this.stage]}". Brave.`);
    if (all.length >= 3 && disagree.length === 1) this.lines.push(`${this.name(disagree[0])} alone disagrees that "${this.takes[this.stage]}". Brave.`);
    if (all.length >= 2 && agree.length === disagree.length) this.lines.push('A perfect split. Enjoy the next retro.');
    return { pct, agree, disagree, gains, guesses: Object.fromEntries(all.map(([id, a]) => [id, a.v.pct as number])) };
  }

  stageView() { return { take: this.takes[this.stage] }; }
  roast() { return this.lines.length ? pick(this.ctx.rng, this.lines) : ''; }
  headline() {
    const best = [...this.mind].sort((a, b) => a[1] - b[1])[0];
    return best ? `🔥 ${this.name(best[0])} read the room best (off by ${best[1]}%)` : '🔥 Nobody had an opinion. Unusual.';
  }
  awards() {
    const best = [...this.mind].sort((a, b) => a[1] - b[1])[0];
    return best && best[1] <= 5 ? [{ emoji: '🔮', title: 'Mind Reader', desc: `guessed the room within ${best[1]}%`, id: best[0] }] : [];
  }
}

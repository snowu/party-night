// Performance Review (two truths and a lie): everyone writes two real work
// achievements and one fabrication, then the room spots the lie in a few of them.
import { BOT_REVIEWS } from './content.ts';
import { StagedGame } from './staged.ts';
import { pick, shuffle, type GameCtx, type Seat } from './types.ts';

const MAX_REVIEWS = 4;
const MAX_LEN = 80;

interface Review { id: string; statements: string[]; lie: number }

export class PerfReview extends StagedGame {
  reviews: Review[] = [];
  fooled = new Map<string, number>();

  constructor(ctx: GameCtx, now: number) { super(ctx, now); }

  stages() { return 1 + this.reviews.length; }
  stageMs(i: number) { return i === 0 ? 75000 : 15000; }
  review() { return this.reviews[this.stage - 1]; }
  bench() { return this.stage === 0 ? new Set<string>() : new Set([this.review().id]); }

  onMessage(from: string, msg: any, now: number) {
    if (this.stage === 0 && msg?.k === 'ans' && Array.isArray(msg.v?.s)) {
      msg = { ...msg, v: { s: msg.v.s.map((t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)), lie: msg.v.lie } };
    }
    super.onMessage(from, msg, now);
  }

  valid(_from: string, v: any) {
    if (this.stage > 0) return Number.isInteger(v) && v >= 0 && v < 3;
    return Array.isArray(v?.s) && v.s.length === 3 && v.s.every((t: string) => t.length > 0) && [0, 1, 2].includes(v.lie);
  }

  botAnswer(_bot: Seat) {
    if (this.stage === 0) return { s: [...pick(this.ctx.rng, BOT_REVIEWS)], lie: 2 };
    return Math.floor(this.ctx.rng() * 3);
  }

  reveal() {
    if (this.stage === 0) {
      // Humans first; bots only fill in when there aren't enough of them.
      const all = shuffle(this.ctx.rng, [...this.answers]);
      const human = (id: string) => !this.ctx.players.find(p => p.id === id)?.bot;
      const chosen = [...all.filter(([id]) => human(id)), ...all.filter(([id]) => !human(id))].slice(0, MAX_REVIEWS);
      this.reviews = chosen.map(([id, a]) => {
        const order = shuffle(this.ctx.rng, [0, 1, 2]);
        return { id, statements: order.map(i => a.v.s[i]), lie: order.indexOf(a.v.lie) };
      });
      if (this.reviews.length < 2) this.reviews = [];
      this.revMs = 2000;
      return { reviews: this.reviews.length };
    }
    this.revMs = 5000;
    const r = this.review();
    const gains: Record<string, number> = {};
    const picks: Record<string, number> = {};
    let fooled = 0;
    for (const [id, a] of this.answers) {
      picks[id] = a.v;
      if (a.v === r.lie) { gains[id] = this.speedPts(a.t); this.add(id, gains[id]); }
      else fooled++;
    }
    gains[r.id] = 300 * fooled;
    this.add(r.id, gains[r.id]);
    this.fooled.set(r.id, fooled);
    return { author: r.id, lie: r.lie, picks, gains };
  }

  stageView(forId: string | null) {
    if (this.stage === 0) return { review: null };
    const r = this.review();
    return { review: { author: r.id, statements: r.statements, mine: r.id === forId } };
  }

  headline() {
    if (!this.reviews.length) return '📋 Not enough self-reviews submitted. HR will be in touch.';
    const top = [...this.fooled].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `📋 ${this.name(top[0])} fooled ${top[1]} reviewer${top[1] === 1 ? '' : 's'}. Promotion incoming.` : '📋 Every lie was spotted. Brutal calibration.';
  }
  awards() {
    const top = [...this.fooled].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? [{ emoji: '📈', title: 'Exceeds Expectations', desc: `fooled ${top[1]} reviewers`, id: top[0] }] : [];
  }
}

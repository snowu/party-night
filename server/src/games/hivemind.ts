// Alignment Meeting (Family Feud rules): everyone types one answer; you score for
// every teammate who typed the same thing. Original thinking is not rewarded.
import { HIVEMIND, lev, norm } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, shuffle, type GameCtx, type Seat } from './types.ts';

const PROMPTS = 3;
const PER_MATCH = 250;

const key = (t: string) => norm(t).replace(/ /g, '').replace(/s$/, '');

export class Hivemind extends StagedGame {
  prompts: [string, string[]][];
  matched = new Map<string, number>();
  alone = new Map<string, number>();

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.prompts = shuffle(ctx.rng, HIVEMIND).slice(0, PROMPTS);
  }

  stages() { return PROMPTS; }
  stageMs() { return 20000; }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k === 'ans' && typeof msg.v === 'string') msg = { ...msg, v: msg.v.replace(/\s+/g, ' ').trim().slice(0, 30) };
    super.onMessage(from, msg, now);
  }
  valid(_from: string, v: any) { return typeof v === 'string' && !!key(v); }

  // Bots lean on the popular answers, like real people do.
  botAnswer(_bot: Seat) {
    const xs = this.prompts[this.stage][1];
    return xs[Math.floor(this.ctx.rng() ** 2 * xs.length)];
  }

  reveal() {
    // Group answers by spelling, give or take a plural, spacing or a one-letter typo.
    const groups: Array<{ k: string; text: string; ids: string[] }> = [];
    for (const [id, a] of this.answers) {
      const k = key(a.v);
      const g = groups.find(g => g.k === k || (k.length >= 5 && lev(g.k, k) <= 1));
      if (g) g.ids.push(id); else groups.push({ k, text: a.v, ids: [id] });
    }
    groups.sort((a, b) => b.ids.length - a.ids.length);
    const gains: Record<string, number> = {};
    for (const g of groups) for (const id of g.ids) {
      if (g.ids.length < 2) { this.alone.set(id, (this.alone.get(id) ?? 0) + 1); continue; }
      gains[id] = PER_MATCH * (g.ids.length - 1);
      this.add(id, gains[id]);
      this.matched.set(id, (this.matched.get(id) ?? 0) + g.ids.length - 1);
    }
    return { groups: groups.map(({ text, ids }) => ({ text, ids })), gains };
  }

  stageView() { return { prompt: this.prompts[this.stage][0] }; }

  headline() {
    const top = [...this.matched].sort((a, b) => b[1] - a[1])[0];
    return top ? `🤝 ${this.name(top[0])} is the most aligned person in the room` : '🤝 Zero alignment. Schedule a follow-up.';
  }
  awards() {
    return [
      mostAward(this.ctx.players, id => this.matched.get(id) ?? 0, '🤝', 'Fully Aligned', n => `matched ${n} answer${n === 1 ? '' : 's'}`),
      mostAward(this.ctx.players.filter(p => !p.bot), id => (this.alone.get(id) ?? 0) >= 2 ? this.alone.get(id)! : 0, '🦄', 'Thought Leader',
        n => `the only one to say it, ${n}×`),
    ].filter(a => !!a);
  }
}

// Root Cause Analysis (Fibbage rules): a true fact with a blank. Everyone writes
// a believable fake, then picks the real answer out of the pile. Finding the
// truth scores; so does every teammate who falls for your fake.
import { ROOT_CAUSES, guessMatches, norm } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, pick, shuffle, type GameCtx, type Seat } from './types.ts';

const FACTS = 2;
const MAX_LEN = 40;

interface Option { text: string; truth: boolean; authors: string[] }

export class RootCause extends StagedGame {
  facts: [string, string, string[]][];
  options: Option[] = [];
  fooled = new Map<string, number>();
  found = new Map<string, number>();

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.facts = shuffle(ctx.rng, ROOT_CAUSES).slice(0, FACTS);
  }

  stages() { return FACTS * 2; }
  stageMs(i: number) { return i % 2 ? 18000 : 30000; }
  writing() { return this.stage % 2 === 0; }
  fact() { return this.facts[this.stage >> 1]; }

  onMessage(from: string, msg: any, now: number) {
    if (this.writing() && msg?.k === 'ans' && typeof msg.v === 'string') msg = { ...msg, v: msg.v.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN) };
    super.onMessage(from, msg, now);
  }

  valid(from: string, v: any) {
    if (!this.writing()) return Number.isInteger(v) && v >= 0 && v < this.options.length && !this.options[v].authors.includes(from);
    if (typeof v !== 'string' || !norm(v)) return false;
    if (guessMatches(v, this.fact()[1])) {
      this.ctx.send(from, { t: 'event', text: '🤫 That\'s the real answer. Write a fake one.' });
      return false;
    }
    return true;
  }

  botAnswer(bot: Seat) {
    if (this.writing()) {
      const used = new Set([...this.answers.values()].map(a => norm(a.v)));
      return pick(this.ctx.rng, this.fact()[2].filter(f => !used.has(norm(f))).concat(this.fact()[2]));
    }
    const mine = this.options.map((o, i) => [o, i] as const).filter(([o]) => !o.authors.includes(bot.id));
    const truth = this.options.findIndex(o => o.truth);
    return this.ctx.rng() < 0.4 ? truth : pick(this.ctx.rng, mine)[1];
  }

  reveal() {
    if (this.writing()) {
      // Same fake from two people is one option with two authors.
      const lies = new Map<string, Option>();
      for (const [id, a] of this.answers) {
        const k = norm(a.v);
        const o: Option = lies.get(k) ?? { text: a.v, truth: false, authors: [] };
        o.authors.push(id);
        lies.set(k, o);
      }
      this.options = shuffle(this.ctx.rng, [{ text: this.fact()[1], truth: true, authors: [] }, ...lies.values()]);
      this.revMs = 1500;
      return { fakes: lies.size };
    }
    this.revMs = 6000;
    const gains: Record<string, number> = {};
    const picks: Record<string, number> = {};
    const add = (id: string, n: number) => { gains[id] = (gains[id] ?? 0) + n; this.add(id, n); };
    for (const [id, a] of this.answers) {
      picks[id] = a.v;
      const o = this.options[a.v];
      if (o.truth) { add(id, 1000); this.found.set(id, (this.found.get(id) ?? 0) + 1); }
      else for (const au of o.authors) { add(au, 500); this.fooled.set(au, (this.fooled.get(au) ?? 0) + 1); }
    }
    return { options: this.options, picks, gains };
  }

  stageView(forId: string | null) {
    const [q] = this.fact();
    if (this.writing()) return { phase: 'write', prompt: q, options: null };
    return { phase: 'pick', prompt: q, options: this.options.map(o => ({ text: o.text, mine: !!forId && o.authors.includes(forId) })) };
  }

  headline() {
    const top = [...this.fooled].sort((a, b) => b[1] - a[1])[0];
    return top ? `🔍 ${this.name(top[0])}'s root cause fooled ${top[1]} of you` : '🔍 Nobody fell for a single fake. Blameless postmortem.';
  }
  awards() {
    return [
      mostAward(this.ctx.players, id => this.fooled.get(id) ?? 0, '🤥', 'Creative Writing', n => `fooled ${n} teammate${n === 1 ? '' : 's'}`),
      mostAward(this.ctx.players, id => (this.found.get(id) ?? 0) === FACTS ? FACTS : 0, '🔍', 'Actually Read the Logs', () => 'found every real root cause'),
    ].filter(a => !!a);
  }
}

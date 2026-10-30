// Who Wrote It: everyone answers a prompt, then up to three answers come back as
// "who wrote this?" stages. Guessing right scores; fooling people scores the author.
import { BOT_WRITES, WRITE_PROMPTS } from './content.ts';
import { StagedGame } from './staged.ts';
import { pick, shuffle, type GameCtx, type Seat } from './types.ts';

const MAX_ENTRIES = 3;

export class Who extends StagedGame {
  prompt: string;
  entries: Array<{ id: string; text: string }> = [];
  fooled = new Map<string, number>();
  lines: string[] = [];

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.prompt = pick(ctx.rng, WRITE_PROMPTS);
  }

  stages() { return 1 + this.entries.length; }
  stageMs(i: number) { return i === 0 ? 40000 : 15000; }
  entry() { return this.entries[this.stage - 1]; }
  bench() { return this.stage === 0 ? new Set<string>() : new Set([this.entry().id]); }

  valid(from: string, v: any) {
    if (this.stage === 0) return typeof v === 'string' && v.trim().length > 0 && v.length <= 120;
    return this.scores.has(v) && v !== from;
  }

  onMessage(from: string, msg: any, now: number) {
    if (this.stage === 0 && msg?.k === 'ans' && typeof msg.v === 'string') msg = { ...msg, v: msg.v.replace(/\s+/g, ' ').trim().slice(0, 120) };
    super.onMessage(from, msg, now);
  }

  botAnswer(bot: Seat) {
    if (this.stage === 0) return pick(this.ctx.rng, BOT_WRITES);
    return pick(this.ctx.rng, this.ctx.players.filter(p => p.id !== bot.id)).id;
  }

  reveal() {
    if (this.stage === 0) {
      this.revMs = 2500;
      this.entries = shuffle(this.ctx.rng, [...this.answers].map(([id, a]) => ({ id, text: a.v as string }))).slice(0, MAX_ENTRIES);
      if (this.entries.length < 2) this.entries = [];
      return { entries: this.entries.length };
    }
    this.revMs = 4500;
    const { id: author } = this.entry();
    const gains: Record<string, number> = {};
    let fooled = 0, right = 0;
    for (const [id, a] of this.answers) {
      if (a.v === author) { gains[id] = this.speedPts(a.t); this.add(id, gains[id]); right++; }
      else fooled++;
    }
    gains[author] = 300 * fooled;
    this.add(author, gains[author]);
    this.fooled.set(author, fooled);
    const voters = this.answers.size;
    if (voters >= 2 && !right) this.lines.push(`Nobody suspected ${this.name(author)}. Undercover legend.`);
    if (voters >= 2 && right === voters) this.lines.push(`Everyone knew it was ${this.name(author)}. Very on brand.`);
    return { author, gains, picks: Object.fromEntries([...this.answers].map(([id, a]) => [id, a.v])) };
  }

  stageView(forId: string | null) {
    if (this.stage === 0) return { prompt: this.prompt, entry: null };
    const e = this.entry();
    return { prompt: this.prompt, entry: { text: e.text, mine: e.id === forId } };
  }

  headline() {
    if (!this.entries.length) return '✍️ Not enough answers to guess from. Writer\'s block all round.';
    const top = [...this.fooled].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `✍️ ${this.name(top[0])} fooled ${top[1]} of you` : '✍️ Nobody fooled anybody. You know each other too well.';
  }
  roast() { return this.lines.length ? pick(this.ctx.rng, this.lines) : ''; }
  awards() {
    const top = [...this.fooled].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? [{ emoji: '🕵️', title: 'Undercover', desc: `fooled ${top[1]} people`, id: top[0] }] : [];
  }
}

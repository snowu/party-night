// Code Review (Quiplash rules): players are paired (or grouped) on a prompt, write
// an answer, then everyone else votes on which one to merge. Votes are points.
import { BOT_QUIPS, REVIEW_PROMPTS } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, pick, shuffle, type GameCtx, type Seat } from './types.ts';

const MAX_GROUPS = 5;
const MAX_LEN = 80;
const POT = 1000;          // split between a matchup's authors by vote share
const UNANIMOUS = 250;

interface Matchup { prompt: string; entries: Array<{ id: string; text: string }> }

export class CodeReview extends StagedGame {
  groups: Array<{ prompt: string; ids: string[] }> = [];
  matchups: Matchup[] = [];
  votes = new Map<string, number>();
  lines: string[] = [];

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    // With three players two write and one votes; otherwise everyone writes and
    // every group still has at least two voters outside it.
    const order = shuffle(ctx.rng, ctx.players.map(p => p.id));
    const authors = order.length <= 3 ? order.slice(0, 2) : order;
    const k = Math.min(MAX_GROUPS, Math.floor(authors.length / 2));
    const prompts = shuffle(ctx.rng, REVIEW_PROMPTS);
    this.groups = Array.from({ length: k }, (_, i) => ({ prompt: prompts[i], ids: [] as string[] }));
    authors.forEach((id, i) => this.groups[i % k].ids.push(id));
  }

  stages() { return 1 + this.matchups.length; }
  stageMs(i: number) { return i === 0 ? 45000 : 14000; }
  matchup() { return this.matchups[this.stage - 1]; }
  groupOf(id: string | null) { return id ? this.groups.find(g => g.ids.includes(id)) : undefined; }
  bench() {
    if (this.stage === 0) return new Set(this.ctx.players.map(p => p.id).filter(id => !this.groupOf(id)));
    return new Set(this.matchup().entries.map(e => e.id));
  }

  onMessage(from: string, msg: any, now: number) {
    if (this.stage === 0 && msg?.k === 'ans' && typeof msg.v === 'string') msg = { ...msg, v: msg.v.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN) };
    super.onMessage(from, msg, now);
  }

  valid(_from: string, v: any) {
    if (this.stage === 0) return typeof v === 'string' && v.length > 0;
    return Number.isInteger(v) && v >= 0 && v < this.matchup().entries.length;
  }

  botAnswer(_bot: Seat) {
    if (this.stage === 0) return pick(this.ctx.rng, BOT_QUIPS);
    return Math.floor(this.ctx.rng() * this.matchup().entries.length);
  }

  reveal() {
    if (this.stage === 0) {
      const gains: Record<string, number> = {};
      for (const g of this.groups) {
        const entries = shuffle(this.ctx.rng, g.ids.filter(id => this.answers.has(id)).map(id => ({ id, text: this.answers.get(id)!.v as string })));
        if (entries.length >= 2) this.matchups.push({ prompt: g.prompt, entries });
        else if (entries.length === 1) {
          // Nobody else showed up to review: merged on the author's own approval.
          gains[entries[0].id] = POT / 2;
          this.add(entries[0].id, POT / 2);
          this.lines.push(`${this.name(entries[0].id)} approved their own PR. Bold.`);
        }
      }
      this.revMs = 2500;
      return { matchups: this.matchups.length, gains };
    }
    this.revMs = 5500;
    const m = this.matchup();
    const counts = m.entries.map(() => 0);
    for (const a of this.answers.values()) counts[a.v]++;
    const total = counts.reduce((x, y) => x + y, 0);
    const gains: Record<string, number> = {};
    m.entries.forEach((e, i) => {
      gains[e.id] = total ? Math.round(POT * counts[i] / total) : 0;
      if (total >= 2 && counts[i] === total) {
        gains[e.id] += UNANIMOUS;
        this.lines.push(`Unanimous approval for ${this.name(e.id)}. No notes.`);
      }
      this.add(e.id, gains[e.id]);
      this.votes.set(e.id, (this.votes.get(e.id) ?? 0) + counts[i]);
    });
    const picks = Object.fromEntries([...this.answers].map(([id, a]) => [id, a.v]));
    return { authors: m.entries.map(e => e.id), counts, picks, gains };
  }

  stageView(forId: string | null) {
    if (this.stage === 0) return { prompt: this.groupOf(forId)?.prompt ?? null, matchup: null };
    const m = this.matchup();
    return { prompt: m.prompt, matchup: { texts: m.entries.map(e => e.text), mine: m.entries.findIndex(e => e.id === forId) } };
  }

  headline() {
    const top = [...this.votes].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `✅ ${this.name(top[0])} collected ${top[1]} approval${top[1] === 1 ? '' : 's'}` : '✅ Every PR is still waiting for review.';
  }
  roast() { return this.lines.length ? pick(this.ctx.rng, this.lines) : ''; }
  awards() {
    return [mostAward(this.ctx.players, id => this.votes.get(id) ?? 0, '✅', 'LGTM', n => `${n} approval${n === 1 ? '' : 's'}`)].filter(a => !!a);
  }
}

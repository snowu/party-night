// Most Likely To: vote for a teammate; voting with the room scores, and whoever
// the room picks walks away with the title.
import { MOST_LIKELY } from './content.ts';
import { StagedGame } from './staged.ts';
import { pick, shuffle, type GameCtx, type Seat } from './types.ts';
import type { Award } from '../../../shared/protocol.ts';

const PROMPTS = 3;

export class MostLikely extends StagedGame {
  prompts: string[];
  titles: Award[] = [];
  lines: string[] = [];

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.prompts = shuffle(ctx.rng, MOST_LIKELY).slice(0, PROMPTS);
  }

  stages() { return PROMPTS; }
  stageMs() { return 15000; }
  valid(_from: string, v: any) { return this.scores.has(v); }
  botAnswer(bot: Seat) { return pick(this.ctx.rng, this.ctx.players.filter(p => p.id !== bot.id)).id; }

  reveal() {
    const counts: Record<string, number> = {};
    for (const a of this.answers.values()) counts[a.v] = (counts[a.v] ?? 0) + 1;
    const most = Math.max(0, ...Object.values(counts));
    const winners = Object.keys(counts).filter(id => counts[id] === most);
    const gains: Record<string, number> = {};
    for (const [id, a] of this.answers) {
      if (a.v === id) this.lines.push(`${this.name(id)} voted for themselves. Respect.`);
      if (!winners.includes(a.v)) continue;
      gains[id] = 500;
      this.add(id, 500);
    }
    const title = this.prompts[this.stage].replace(/^Most likely to /, '');
    for (const id of winners) this.titles.push({ emoji: '👑', title: 'By popular vote', desc: `most likely to ${title}`, id });
    if (winners.length === 1 && most >= 3 && most === this.answers.size) this.lines.push(`Unanimous. ${this.name(winners[0])}, you know what you did.`);
    return { counts, winners, gains };
  }

  stageView() { return { prompt: this.prompts[this.stage] }; }
  headline() {
    const t = this.titles[0];
    return t ? `👑 ${this.name(t.id)} is ${t.desc}` : '👑 Nobody voted. Cowards.';
  }
  roast() { return this.lines.length ? pick(this.ctx.rng, this.lines) : ''; }
  awards() { return this.titles; }
}

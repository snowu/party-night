// Shared engine for the social rounds: a fixed run of stages, each an answer
// window then a short reveal. Answers arrive as {k:'ans', i, v}; a stage closes
// at its deadline or a moment after everyone who can answer has. Bots answer on
// a random schedule. Subclasses only say what a stage is and how it scores.
import type { Award } from '../../../shared/protocol.ts';
import { placesByScore } from '../../../shared/points.ts';
import type { GameCtx, RoundResult, Seat, ServerGame } from './types.ts';

export interface Answer { v: any; t: number }   // t = ms into the stage

export abstract class StagedGame implements ServerGame {
  result: RoundResult | null = null;
  scores = new Map<string, number>();
  answers = new Map<string, Answer>();        // current stage
  stage = 0;
  step: 'q' | 'rev' = 'q';
  stageAt = 0;
  endsAt = 0;
  rev: unknown = null;                        // the current stage's reveal, for the view
  botAt = new Map<string, number>();          // bot id → when it answers this stage
  revMs = 4000;

  constructor(public ctx: GameCtx, now: number) {
    for (const p of ctx.players) this.scores.set(p.id, 0);
  }

  // ── what a subclass defines ──
  abstract stages(): number;
  abstract stageMs(i: number): number;
  abstract valid(from: string, v: any): boolean;
  abstract reveal(): unknown;                 // score this.answers, return the reveal view
  abstract stageView(forId: string | null): unknown;
  botAnswer(_bot: Seat): any { return null; }  // null = the bot sits it out
  bench(): Set<string> { return new Set(); }  // who can't answer this stage
  awards(): Award[] { return []; }
  headline(): string { return ''; }
  roast(): string { return ''; }
  statFor(id: string): string { return `${(this.scores.get(id) ?? 0).toLocaleString('en-US')} pts`; }

  // ── engine ──
  start(now: number) { this.openStage(now); }

  add(id: string, n: number) { this.scores.set(id, (this.scores.get(id) ?? 0) + n); }
  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  speedPts(t: number, max = 1000) { return Math.round(max * (1 - 0.5 * Math.min(1, t / this.stageMs(this.stage)))); }

  answerers(): Seat[] {
    const bench = this.bench();
    return this.ctx.players.filter(p => !bench.has(p.id) && this.ctx.connected(p.id));
  }

  openStage(now: number) {
    this.step = 'q';
    this.answers = new Map();
    this.rev = null;
    this.stageAt = now;
    this.endsAt = now + this.stageMs(this.stage);
    this.botAt = new Map();
    const bench = this.bench();
    for (const p of this.ctx.players) {
      if (p.bot && !bench.has(p.id)) this.botAt.set(p.id, now + this.stageMs(this.stage) * (0.15 + this.ctx.rng() * 0.6));
    }
    this.ctx.changed();
  }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k !== 'ans' || this.step !== 'q' || msg.i !== this.stage) return;
    if (this.answers.has(from) || this.bench().has(from) || !this.scores.has(from)) return;
    if (!this.valid(from, msg.v)) return;
    this.answers.set(from, { v: msg.v, t: now - this.stageAt });
    this.checkAllIn(now);
    this.ctx.changed();
  }

  checkAllIn(now: number, delay = 700) {
    const live = this.answerers();
    if (live.length && live.every(p => this.answers.has(p.id))) this.endsAt = Math.min(this.endsAt, now + delay);
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.step === 'q') {
      for (const [id, at] of this.botAt) {
        if (now < at) continue;
        this.botAt.delete(id);
        const v = this.botAnswer(this.ctx.players.find(p => p.id === id)!);
        if (v !== null && v !== undefined) this.onMessage(id, { k: 'ans', i: this.stage, v }, now);
      }
      if (now >= this.endsAt) {
        this.rev = this.reveal();
        this.step = 'rev';
        this.endsAt = now + this.revMs;
        this.ctx.changed();
      }
    } else if (now >= this.endsAt) {
      if (this.stage + 1 < this.stages()) {
        this.stage++;
        this.openStage(now);
      } else this.finish();
    }
  }

  finish() {
    const ranking = placesByScore(this.ctx.players, p => this.scores.get(p.id) ?? 0)
      .map(({ item, place }) => ({ id: item.id, place, stat: this.statFor(item.id) }));
    this.result = { ranking, awards: this.awards(), headline: this.headline(), roast: this.roast() };
  }

  view(forId: string | null) {
    return {
      stage: this.stage,
      stages: this.stages(),
      step: this.step,
      endsAt: this.endsAt,
      stageMs: this.stageMs(this.stage),
      answered: [...this.answers.keys()],
      bench: [...this.bench()],
      mine: forId ? this.answers.get(forId)?.v ?? null : null,
      rev: this.step === 'rev' ? this.rev : null,
      scores: Object.fromEntries(this.scores),
      ...(this.stageView(forId) as object),
    };
  }
}

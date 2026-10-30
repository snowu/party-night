// Incident Response: wait for the page, then ack it faster than anyone else.
// Acking before it fires is a false alarm and scores nothing. Reaction times are
// measured on each player's own screen, so lag doesn't count against anyone.
import { ALERTS } from './content.ts';
import { StagedGame } from './staged.ts';
import { mostAward, shuffle, type GameCtx, type Seat } from './types.ts';

const PAGES = 5;
const PRIZES = [1000, 750, 550, 400, 300, 200];
const MIN_PRIZE = 150;

export class Incident extends StagedGame {
  alerts: string[];
  fireAt = 0;
  botMs = new Map<string, number | 'early'>();
  best = new Map<string, number>();
  falseAlarms = new Map<string, number>();

  constructor(ctx: GameCtx, now: number) {
    super(ctx, now);
    this.alerts = shuffle(ctx.rng, ALERTS).slice(0, PAGES);
  }

  stages() { return PAGES; }
  stageMs() { return 8000; }

  openStage(now: number) {
    super.openStage(now);
    this.revMs = 3000;
    this.fireAt = now + 1500 + this.ctx.rng() * 3500;
    // Bots react 250-600ms after the page, and now and then jump the gun.
    this.botMs = new Map();
    for (const id of this.botAt.keys()) {
      const early = this.ctx.rng() < 0.08;
      const ms = early ? 'early' as const : Math.round(250 + this.ctx.rng() * 350);
      this.botMs.set(id, ms);
      this.botAt.set(id, ms === 'early' ? this.fireAt - 400 : this.fireAt + ms);
    }
  }

  valid(_from: string, v: any) { return v === 'early' || (typeof v === 'number' && v >= 0 && v <= 5000); }
  botAnswer(bot: Seat) { return this.botMs.get(bot.id) ?? null; }

  reveal() {
    const acks = [...this.answers].filter(([, a]) => typeof a.v === 'number').map(([id, a]) => ({ id, ms: Math.round(a.v) })).sort((a, b) => a.ms - b.ms);
    const early = [...this.answers].filter(([, a]) => a.v === 'early').map(([id]) => id);
    const gains: Record<string, number> = {};
    acks.forEach(x => {
      const place = acks.findIndex(o => o.ms === x.ms);
      gains[x.id] = PRIZES[place] ?? MIN_PRIZE;
      this.add(x.id, gains[x.id]);
      this.best.set(x.id, Math.min(this.best.get(x.id) ?? Infinity, x.ms));
    });
    for (const id of early) this.falseAlarms.set(id, (this.falseAlarms.get(id) ?? 0) + 1);
    return { acks, early, gains };
  }

  stageView() { return { alert: this.alerts[this.stage], fireAt: this.fireAt }; }

  statFor(id: string) {
    const b = this.best.get(id);
    return `${(this.scores.get(id) ?? 0).toLocaleString('en-US')} pts${b === undefined ? '' : ` · best ${b}ms`}`;
  }
  headline() {
    const top = [...this.best].sort((a, b) => a[1] - b[1])[0];
    return top ? `🚨 ${this.name(top[0])} acked a page in ${top[1]}ms` : '🚨 Nobody acked a single page. Customers noticed first.';
  }
  awards() {
    return [
      mostAward(this.ctx.players, id => this.best.has(id) ? 10000 - this.best.get(id)! : 0, '⚡', 'Fastest Ack', n => `${10000 - n}ms`),
      mostAward(this.ctx.players, id => this.falseAlarms.get(id) ?? 0, '🙈', 'Alert Fatigue', n => `${n} false alarm${n === 1 ? '' : 's'}`),
    ].filter(a => !!a);
  }
}

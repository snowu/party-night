// On-Call Rotation (hot potato): one player holds the pager and passes it by
// tapping a teammate. A hidden timer goes off; whoever holds it then is out.
// A few incidents later, the last ones standing win.
import type { Award } from '../../../shared/protocol.ts';
import { mostAward, pick, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

const MAX_INCIDENTS = 5;
const FUSE_MIN = 6000, FUSE_SPREAD = 9000;
const PASS_GAP_MS = 300;          // no instant ping-pong
const IDLE_PASS_MS = 2500;        // a disconnected holder passes on automatically
const BOOM_MS = 3000;
const LEAD_MS = 2500;

export class OnCall implements ServerGame {
  result: RoundResult | null = null;
  alive: string[];
  out: string[] = [];
  incidents: number;
  incident = 0;
  phase: 'wait' | 'live' | 'boom' = 'wait';
  holder = '';
  heldAt = 0;
  fuseAt = 0;
  nextAt: number;
  botPassAt = 0;
  passes = new Map<string, number>();
  heldMs = new Map<string, number>();

  constructor(public ctx: GameCtx, now: number) {
    this.alive = ctx.players.map(p => p.id);
    this.incidents = Math.max(1, Math.min(MAX_INCIDENTS, this.alive.length - 1));
    this.nextAt = now + LEAD_MS;
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  isBot(id: string) { return !!this.ctx.players.find(p => p.id === id)?.bot; }

  begin(now: number) {
    this.incident++;
    this.phase = 'live';
    this.fuseAt = now + FUSE_MIN + this.ctx.rng() * FUSE_SPREAD;
    this.give(pick(this.ctx.rng, this.alive), now);
  }

  give(id: string, now: number) {
    if (this.holder) this.heldMs.set(this.holder, (this.heldMs.get(this.holder) ?? 0) + now - this.heldAt);
    this.holder = id;
    this.heldAt = now;
    this.botPassAt = now + 600 + this.ctx.rng() * 2200;
    this.ctx.changed();
  }

  pass(from: string, to: string, now: number) {
    if (this.phase !== 'live' || from !== this.holder || to === from || !this.alive.includes(to) || now - this.heldAt < PASS_GAP_MS) return;
    this.passes.set(from, (this.passes.get(from) ?? 0) + 1);
    this.give(to, now);
  }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k === 'pass') this.pass(from, String(msg.to), now);
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.phase === 'wait' && now >= this.nextAt) return this.begin(now);
    if (this.phase === 'boom' && now >= this.nextAt) {
      if (this.incident < this.incidents && this.alive.length > 1) return this.begin(now);
      return this.finish();
    }
    if (this.phase !== 'live') return;
    if (now >= this.fuseAt) {
      this.give(this.holder, now);   // bank the last holder's time
      const victim = this.holder;
      this.alive = this.alive.filter(id => id !== victim);
      this.out.push(victim);
      this.phase = 'boom';
      this.nextAt = now + BOOM_MS;
      this.ctx.event(`📟 ${this.name(victim)} was holding the pager at 3am`);
      this.ctx.changed();
      return;
    }
    const others = this.alive.filter(id => id !== this.holder);
    const away = !this.isBot(this.holder) && !this.ctx.connected(this.holder) && now - this.heldAt > IDLE_PASS_MS;
    if (others.length && ((this.isBot(this.holder) && now >= this.botPassAt) || away)) this.pass(this.holder, pick(this.ctx.rng, others), now);
  }

  finish() {
    // Survivors share first; the first one paged comes last.
    const ranking = [
      ...this.alive.map(id => ({ id, place: 1, stat: '😴 slept through' })),
      ...[...this.out].reverse().map((id, i) => ({ id, place: this.alive.length + i + 1, stat: `📟 paged in incident ${this.out.indexOf(id) + 1}` })),
    ];
    const headline = this.alive.length === 1 ? `😴 ${this.name(this.alive[0])} slept through every incident` : `😴 ${this.alive.length} people slept through the night`;
    const awards = [
      mostAward(this.ctx.players, id => this.passes.get(id) ?? 0, '🥔', 'Not My Problem', n => `passed the pager ${n}×`),
      mostAward(this.ctx.players, id => Math.round((this.heldMs.get(id) ?? 0) / 1000), '🧯', 'Incident Commander', n => `held the pager for ${n}s`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view() {
    return { phase: this.phase, holder: this.holder, heldAt: this.heldAt, alive: this.alive, out: this.out, incident: this.incident, incidents: this.incidents, startsAt: this.phase === 'wait' ? this.nextAt : 0 };
  }
}

// Server half of Bird Race. Every client flies its own copy of the seeded course
// and reports {d, st, fm, bk} about twice a second (the host reports for the bots
// it runs); positions for drawing go peer to peer over the relay. This module only
// decides who finished and when the round closes, so every screen shows the same
// result.
import { ATTACKS, COUNTDOWN_MS, FINISH_GRACE_MS, PX_PER_M, RACE, STALE_MS, medal, ordinal, type BirdSt, type BirdView } from '../../../shared/bird.ts';
import type { BirdPub } from '../../../shared/bird.ts';
import type { Award } from '../../../shared/protocol.ts';
import { mostAward, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

interface Rec extends BirdPub { at: number; hits: number }

const metres = (d: number) => `${Math.round(d / PX_PER_M).toLocaleString('en-US')}m`;

export class Bird implements ServerGame {
  result: RoundResult | null = null;
  startAt: number;
  birds = new Map<string, Rec>();
  firstFinishAt = 0;
  finished = 0;
  dirty = false;
  lastPush = 0;

  constructor(public ctx: GameCtx, now: number) {
    this.startAt = now + COUNTDOWN_MS;
    for (const p of ctx.players) this.birds.set(p.id, { id: p.id, st: 'fly', d: 0, fm: 0, bk: 0, at: this.startAt, hits: 0 });
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k === 'atk') {
      // The host sends attacks on behalf of its bots, so trust `by` when it names one.
      const by = this.birds.get(String(msg.by)) ?? this.birds.get(from), target = this.birds.get(String(msg.target));
      const atk = ATTACKS.find(a => a.id === msg.kind);
      if (!by || !target || !atk) return;
      by.hits++;
      this.ctx.event(`🎯 ${this.name(by.id)} hit ${this.name(target.id)} with ${atk.name}`);
      return;
    }
    if (msg?.k !== 'rep') return;
    const b = this.birds.get(String(msg.id));
    if (!b || b.st === 'fin' || this.result) return;
    b.d = Math.max(0, Number(msg.d) || 0);
    b.bk = Math.max(0, Math.round(Number(msg.bk) || 0));
    b.at = now;
    if (b.st === 'gone') b.st = 'fly';   // wifi blip: back in
    if (msg.st === 'fin') {
      b.st = 'fin';
      b.fm = Math.max(0, Number(msg.fm) || now - this.startAt);
      this.finished++;
      if (!this.firstFinishAt) this.firstFinishAt = now;
      this.ctx.event(`🏁 ${this.name(b.id)} finished ${ordinal(this.finished)} ${medal(this.finished)}`);
      this.ctx.changed();
    }
    this.dirty = true;
  }

  onTick(now: number) {
    if (this.result || now < this.startAt) return;
    for (const b of this.birds.values()) {
      if (b.st === 'fly' && now - b.at > STALE_MS) { b.st = 'gone'; this.dirty = true; }
    }
    if (this.over(now)) return this.finish();
    if (this.dirty && now - this.lastPush >= 1000) {
      this.dirty = false;
      this.lastPush = now;
      this.ctx.changed();
    }
  }

  over(now: number): boolean {
    if (now - this.startAt > RACE.capMs) return true;
    if (![...this.birds.values()].some(b => b.st === 'fly')) return true;
    return !!this.firstFinishAt && now - this.firstFinishAt > FINISH_GRACE_MS;
  }

  finish() {
    const key = (b: Rec): [number, number] => b.st === 'fin' ? [0, b.fm] : b.st === 'gone' ? [2, -b.d] : [1, -b.d];
    const sorted = [...this.birds.values()].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    const ranking = sorted.map((b, i) => ({
      id: b.id, place: i + 1,
      stat: b.st === 'fin' ? `🏁 ${(b.fm / 1000).toFixed(1)}s` : b.st === 'gone' ? `left at ${metres(b.d)}` : metres(b.d),
    }));
    const w = sorted[0];
    const headline = !w ? '' : w.st === 'fin' ? `🏁 ${this.name(w.id)} wins in ${(w.fm / 1000).toFixed(1)}s` : `🏁 Nobody finished. ${this.name(w.id)} got furthest`;
    const [a, b] = sorted;
    const photoFinish = a?.st === 'fin' && b?.st === 'fin' && b.fm - a.fm < 300 ? { a: a.id, b: b.id, margin: b.fm - a.fm } : null;
    const awards: (Award | null)[] = [];
    const fins = sorted.filter(x => x.st === 'fin');
    if (fins.length >= 3) {
      const last = fins[fins.length - 1];
      awards.push({ emoji: '🐢', title: 'Scenic Route', desc: `finished last in ${(last.fm / 1000).toFixed(1)}s`, id: last.id });
    }
    awards.push(mostAward(this.ctx.players, id => this.birds.get(id)?.bk ?? 0, '🤕', 'Most Bonks', n => `bonked ${n}×`));
    awards.push(mostAward(this.ctx.players, id => this.birds.get(id)?.hits ?? 0, '🎯', 'Sharpshooter', n => `hit the leader ${n}×`));
    this.result = { ranking, headline, awards: awards.filter((x): x is Award => !!x), photoFinish };
  }

  view(): BirdView {
    return {
      startAt: this.startAt,
      courseSec: RACE.courseSec,
      capAt: this.startAt + RACE.capMs,
      birds: [...this.birds.values()].map(({ id, st, d, fm, bk }) => ({ id, st: st as BirdSt, d, fm, bk })),
    };
  }
}

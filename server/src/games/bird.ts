// Server half of the bird games. Every client flies its own copy of the seeded
// course and reports {d, st, fm, bk} about twice a second (the host reports for
// the bots it runs); positions for drawing go peer to peer over the relay. This
// module only decides who finished, who is out, and when the round closes, so
// every screen shows the same result.
import { BIRD, FINISH_GRACE_MS, PX_PER_M, STALE_MS, COUNTDOWN_MS, medal, ordinal, type BirdPub, type BirdSt, type BirdView } from '../../../shared/bird.ts';
import type { Award, Ranking } from '../../../shared/protocol.ts';
import { ATTACKS } from '../../../shared/bird.ts';
import { shuffle, mostAward, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

interface Rec extends BirdPub { at: number; outSeq: number; hits: number }

const metres = (d: number) => `${Math.round(d / PX_PER_M).toLocaleString('en-US')}m`;

export class Bird implements ServerGame {
  result: RoundResult | null = null;
  v;
  startAt: number;
  birds = new Map<string, Rec>();
  firstFinishAt = 0;
  finished = 0;
  outSeq = 0;
  nextElimAt = 0;
  dirty = false;
  lastPush = 0;

  constructor(public ctx: GameCtx, now: number, public variant: string) {
    this.v = BIRD[variant];
    this.startAt = now + COUNTDOWN_MS;
    const order = variant === 'devops' ? shuffle(ctx.rng, ctx.players) : ctx.players;
    order.forEach((p, i) => this.birds.set(p.id, {
      id: p.id, st: 'fly', d: 0, fm: 0, bk: 0, at: this.startAt, outSeq: 0, hits: 0,
      ...(variant === 'devops' ? { team: i % 2 ? 'ops' as const : 'dev' as const } : {}),
    }));
    if (this.v.elimFirstMs) this.nextElimAt = this.startAt + this.v.elimFirstMs;
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k === 'atk') {
      // The host sends attacks on behalf of its bots, so trust `by` when it names one.
      const by = this.birds.get(String(msg.by)) ?? this.birds.get(from), target = this.birds.get(String(msg.target));
      const atk = ATTACKS.find(a => a.id === msg.kind);
      if (!by || !target || !atk || !this.v.attacks) return;
      by.hits++;
      this.ctx.event(`🎯 ${this.name(by.id)} hit ${this.name(target.id)} with ${atk.name}`);
      return;
    }
    if (msg?.k !== 'rep') return;
    const b = this.birds.get(String(msg.id));
    if (!b || b.st === 'fin' || b.st === 'out' || this.result) return;
    b.d = Math.max(0, Number(msg.d) || 0);
    b.bk = Math.max(0, Math.round(Number(msg.bk) || 0));
    b.at = now;
    if (b.st === 'gone') b.st = 'fly';   // wifi blip: back in
    if (msg.st === 'fin' && this.v.courseSec) {
      b.st = 'fin';
      b.fm = Math.max(0, Number(msg.fm) || now - this.startAt);
      this.finished++;
      if (!this.firstFinishAt) this.firstFinishAt = now;
      this.ctx.event(`🏁 ${this.name(b.id)} finished ${ordinal(this.finished)} ${medal(this.finished)}`);
      this.ctx.changed();
    } else if (msg.st === 'out' && !this.v.bonks) {
      b.st = 'out';
      b.outSeq = ++this.outSeq;
      this.ctx.event(`💥 ${this.name(b.id)} is out at ${metres(b.d)}`);
      this.ctx.changed();
    }
    this.dirty = true;
  }

  onTick(now: number) {
    if (this.result || now < this.startAt) return;
    const all = [...this.birds.values()];
    for (const b of all) {
      if (b.st === 'fly' && now - b.at > STALE_MS) { b.st = 'gone'; this.dirty = true; }
    }
    if (this.nextElimAt && now >= this.nextElimAt) {
      const left = all.filter(b => b.st === 'fly' || b.st === 'gone');
      if (left.length > 1) {
        const victim = left.sort((a, b) => Number(b.st === 'gone') - Number(a.st === 'gone') || a.d - b.d)[0];
        victim.st = 'out';
        victim.outSeq = ++this.outSeq;
        this.ctx.event(`🔒 ${this.name(victim.id)} has been deprovisioned`);
        this.ctx.changed();
      }
      this.nextElimAt += this.v.elimEveryMs!;
    }
    if (this.over(now)) return this.finish();
    if (this.dirty && now - this.lastPush >= 1000) {
      this.dirty = false;
      this.lastPush = now;
      this.ctx.changed();
    }
  }

  over(now: number): boolean {
    const t = now - this.startAt;
    if (t > this.v.capMs) return true;
    if (this.v.durationMs) return t >= this.v.durationMs;
    const flying = [...this.birds.values()].filter(b => b.st === 'fly');
    if (this.v.elimEveryMs) return flying.length + [...this.birds.values()].filter(b => b.st === 'gone').length <= 1 && this.birds.size > 1 || !flying.length;
    if (!flying.length) return true;
    return !!this.firstFinishAt && now - this.firstFinishAt > FINISH_GRACE_MS;
  }

  totals() {
    const t = { dev: 0, ops: 0 };
    for (const b of this.birds.values()) if (b.team) t[b.team] += b.d;
    return t;
  }

  finish() {
    const all = [...this.birds.values()];
    const p = (id: string) => this.name(id);
    let ranking: Ranking[];
    let headline: string;
    const awards: (Award | null)[] = [];
    let photoFinish: RoundResult['photoFinish'] = null;

    if (this.variant === 'devops') {
      const t = this.totals();
      const win: 'dev' | 'ops' | null = t.dev === t.ops ? null : t.dev > t.ops ? 'dev' : 'ops';
      const winners = all.filter(b => !win || b.team === win);
      ranking = all.map(b => ({ id: b.id, place: !win || b.team === win ? 1 : winners.length + 1, stat: `${b.team === 'dev' ? '💻' : '🛠️'} ${metres(b.d)}` }));
      headline = win ? `${win === 'dev' ? '💻 Dev' : '🛠️ Ops'} win by ${metres(Math.abs(t.dev - t.ops))}` : '🤝 A dead heat. Blame is shared equally.';
      const mvp = winners.sort((a, b) => b.d - a.d)[0];
      if (mvp && win) awards.push({ emoji: '🦸', title: 'MVP', desc: `${metres(mvp.d)} for ${win === 'dev' ? 'Dev' : 'Ops'}`, id: mvp.id });
    } else {
      const key = (b: Rec): [number, number] => {
        if (this.variant === 'leastpriv') return b.st === 'fly' ? [0, -b.d] : b.st === 'out' ? [1, -b.outSeq] : [2, -b.d];
        return b.st === 'fin' ? [0, b.fm] : b.st === 'gone' ? [2, -b.d] : [1, -b.d];
      };
      const sorted = all.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
      ranking = sorted.map((b, i) => ({
        id: b.id, place: i + 1,
        stat: b.st === 'fin' ? `🏁 ${(b.fm / 1000).toFixed(1)}s`
          : this.variant === 'leastpriv' && b.st === 'out' ? `🔒 out at ${metres(b.d)}`
          : b.st === 'out' ? `💥 ${metres(b.d)}` : b.st === 'gone' ? `left at ${metres(b.d)}` : metres(b.d),
      }));
      const w = sorted[0];
      headline = !w ? '' : this.variant === 'leastpriv' ? `🔐 ${p(w.id)} is the last one with access`
        : w.st === 'fin' ? `🏁 ${p(w.id)} wins in ${(w.fm / 1000).toFixed(1)}s${this.v.bonks ? '' : ' without a scratch'}`
        : this.variant === 'onelife' ? `💥 ${p(w.id)} survived longest (${metres(w.d)})` : `🏁 Nobody finished. ${p(w.id)} got furthest`;
      const [a, b] = sorted;
      if (a?.st === 'fin' && b?.st === 'fin' && b.fm - a.fm < 300) photoFinish = { a: a.id, b: b.id, margin: b.fm - a.fm };
      const fins = sorted.filter(x => x.st === 'fin');
      if (this.variant === 'race' && fins.length >= 3) {
        const last = fins[fins.length - 1];
        awards.push({ emoji: '🐢', title: 'Scenic Route', desc: `finished last in ${(last.fm / 1000).toFixed(1)}s`, id: last.id });
      }
    }
    if (this.v.bonks) awards.push(mostAward(this.ctx.players, id => this.birds.get(id)?.bk ?? 0, '🤕', 'Most Bonks', n => `bonked ${n}×`));
    if (this.v.attacks) awards.push(mostAward(this.ctx.players, id => this.birds.get(id)?.hits ?? 0, '🎯', 'Sharpshooter', n => `hit the leader ${n}×`));
    this.result = { ranking, headline, awards: awards.filter((a): a is Award => !!a), photoFinish };
  }

  view(): BirdView {
    return {
      variant: this.variant,
      startAt: this.startAt,
      courseSec: this.v.courseSec,
      capAt: this.startAt + this.v.capMs,
      endsAt: this.v.durationMs ? this.startAt + this.v.durationMs : 0,
      nextElimAt: this.nextElimAt,
      birds: [...this.birds.values()].map(({ id, st, d, fm, bk, team }) => ({ id, st: st as BirdSt, d, fm, bk, team })),
      totals: this.variant === 'devops' ? this.totals() : null,
    };
  }
}

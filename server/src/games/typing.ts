// Typing Race: everyone types the same two sentences; every right letter moves
// you along your lane. First to the end wins; once someone finishes, the rest
// have a few seconds left, then they're placed by how far they got.
import { placesByScore } from '../../../shared/points.ts';
import type { Award } from '../../../shared/protocol.ts';
import { TYPING, wpm, type Lane, type TypingView } from '../../../shared/typing.ts';
import { mostAward, shuffle, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

// Plain English, nothing only engineers can type quickly.
const SENTENCES = [
  'The meeting could have been an email.',
  'Please mute yourself when you are not talking.',
  'Someone left the fridge door open again.',
  'We will circle back on that next sprint.',
  'Have you tried turning it off and on again?',
  'The coffee machine is the real team lead.',
  'Nobody reads the release notes, so here is a joke.',
  'The deadline was yesterday, but the vibes are great.',
  'I am sharing my screen, can you see it now?',
  'Sorry, you were on mute for the whole update.',
  'This ticket was one point and it took a month.',
  'Ship it on a Friday afternoon, what could go wrong?',
  'My calendar is a solid wall of meetings.',
  'The printer is jammed and so are my feelings.',
  'Who booked a retro at nine on a Monday?',
  'Let me just quickly share one more slide.',
  'The roadmap is more of a rough sketch.',
  'Everything is fine, the dashboard is just very red.',
  'We need a meeting to plan the next meeting.',
  'Let us take this offline and never speak of it again.',
];

interface Racer extends Lane { lastAt: number; cps: number; pauseTo: number; bot: boolean }

export class TypingRace implements ServerGame {
  result: RoundResult | null = null;
  tickMs = TYPING.tickMs;
  phase: TypingView['phase'] = 'count';
  text: string;
  startAt: number;
  endAt: number;
  doneAt = 0;
  lastTick: number;
  racers: Racer[];

  constructor(public ctx: GameCtx, now: number) {
    const [a, b] = shuffle(ctx.rng, SENTENCES);
    this.text = `${a} ${b}`;
    this.startAt = now + TYPING.countdownMs;
    this.endAt = this.startAt + TYPING.raceMs;
    this.lastTick = now;
    // Bots type at 30–65 wpm.
    this.racers = ctx.players.map(p => ({ id: p.id, n: 0, e: 0, ms: null, lastAt: this.startAt, cps: 2.5 + ctx.rng() * 3, pauseTo: 0, bot: p.bot }));
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }

  onMessage(from: string, msg: any, now: number) {
    const r = this.racers.find(x => x.id === from);
    if (this.phase !== 'race' || msg?.k !== 'pos' || !r || r.ms !== null) return;
    const n = Math.floor(Number(msg.n)) || 0;
    if (n <= r.n) return;
    // No pastes: at most maxCps letters a second since the last report.
    const cap = r.n + Math.ceil((TYPING.maxCps * Math.min(1000, now - r.lastAt)) / 1000) + 2;
    this.advance(r, Math.min(n, cap), now);
    r.e = Math.max(r.e, Math.min(999, Math.floor(Number(msg.e)) || 0));
  }

  advance(r: Racer, n: number, now: number) {
    r.n = Math.min(n, this.text.length);
    r.lastAt = now;
    if (r.n === this.text.length) {
      r.ms = now - this.startAt;
      const first = this.racers.filter(x => x.ms !== null).length === 1;
      if (first) this.endAt = Math.min(this.endAt, now + TYPING.graceMs);
      this.ctx.event(`⌨️ ${this.name(r.id)} ${first ? 'wins' : 'finishes'} at ${wpm(r.n, r.ms)} wpm`);
    }
    this.ctx.changed();
  }

  onTick(now: number) {
    if (this.result) return;
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.phase === 'count' && now >= this.startAt) { this.phase = 'race'; this.ctx.changed(); }
    if (this.phase === 'race') {
      const rng = this.ctx.rng;
      for (const r of this.racers) {
        if (!r.bot || r.ms !== null || now < r.pauseTo) continue;
        // Now and then a bot hesitates, or fumbles a key.
        if (rng() < 0.02) { r.pauseTo = now + 300 + rng() * 700; r.e++; continue; }
        const typed = r.n + r.cps * dt * (0.6 + rng() * 0.8);
        if (Math.floor(typed) > Math.floor(r.n)) this.advance(r, typed, now);
        else r.n = typed;
      }
      if (this.racers.every(r => r.ms !== null) || now >= this.endAt) {
        this.phase = 'done';
        this.doneAt = now + TYPING.endMs;
        this.ctx.changed();
      }
    } else if (this.phase === 'done' && now >= this.doneAt) this.finish();
  }

  finish() {
    const len = this.text.length;
    const score = (r: Racer) => (r.ms !== null ? 1e9 - r.ms : Math.floor(r.n));
    const ranking = placesByScore(this.racers, score).map(({ item: r, place }) => ({
      id: r.id, place, stat: r.ms !== null ? `⌨️ ${wpm(len, r.ms)} wpm` : `${Math.floor((100 * r.n) / len)}% typed`,
    }));
    const win = this.racers.filter(r => r.ms !== null).sort((a, b) => a.ms! - b.ms!)[0];
    const headline = win ? `⌨️ ${this.name(win.id)} wins the typing race at ${wpm(len, win.ms!)} wpm` : '⌨️ Nobody finished. The keyboard wins.';
    const clean = this.racers.filter(r => r.ms !== null).sort((a, b) => a.e - b.e)[0];
    const awards = [
      clean && this.racers.filter(r => r.ms !== null).length > 1
        ? { emoji: '🎯', title: 'Clean Copy', desc: clean.e ? `finished with only ${clean.e} typo${clean.e === 1 ? '' : 's'}` : 'finished without a single typo', id: clean.id }
        : null,
      mostAward(this.ctx.players, id => this.racers.find(r => r.id === id)?.e ?? 0, '🔨', 'Keyboard Smash', n => `${n} typos`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view(): TypingView {
    return {
      phase: this.phase, text: this.text, startAt: this.startAt, endAt: this.endAt,
      lanes: this.racers.map(r => ({ id: r.id, n: Math.floor(r.n), e: r.e, ms: r.ms })),
    };
  }
}

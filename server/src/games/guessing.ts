// Draw It and Hum & Mime: one artist, everyone else types guesses. The draw
// round's ink goes through here (stored, so a reconnecting screen gets the whole
// picture); a performance happens on the video call, so there is nothing to relay.
import { PERFORM, WORDS, guessMatches, lev, norm } from './content.ts';
import { pick, shuffle, type GameCtx, type RoundResult, type ServerGame } from './types.ts';
import { placesByScore } from '../../../shared/points.ts';

const DUR_MS = 60000;
const REV_MS = 4500;
const MAX_INK = 30000;
export const INK_COLORS = ['#111111', '#ffffff', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#6d4c41'];

interface Stroke { id: string; c: string; w: number; pts: number[] }

export class Guessing implements ServerGame {
  result: RoundResult | null = null;
  artist = '';
  secret = '';
  type = '';
  startAt: number;
  endsAt: number;
  step: 'q' | 'rev' = 'q';
  got = new Map<string, number>();         // id → ms to guess
  feed: Array<{ id: string; text: string }> = [];
  strokes: Stroke[] = [];
  ink = 0;
  hintOrder: number[] = [];
  passes = 0;
  lastHint = '';
  lastGuess = new Map<string, number>();
  botEvents: Array<{ at: number; id: string; text: string }> = [];
  scores = new Map<string, number>();

  constructor(public ctx: GameCtx, now: number, public mode: 'draw' | 'perform') {
    const pool = ctx.players.filter(p => !p.bot && ctx.connected(p.id) && (mode === 'draw' || p.performer));
    this.startAt = now;
    this.endsAt = now + DUR_MS;
    if (!pool.length) { this.result = { ranking: ctx.players.map(p => ({ id: p.id, place: 1 })), awards: [], headline: 'No artist available. Round skipped.' }; return; }
    this.artist = pick(ctx.rng, pool).id;
    this.newSecret([]);
    this.planBots(now);
  }

  newSecret(not: string[]) {
    if (this.mode === 'draw') { this.secret = pick(this.ctx.rng, WORDS.filter(w => !not.includes(w))); this.type = 'word'; }
    else { [this.secret, this.type] = pick(this.ctx.rng, PERFORM.filter(([t]) => !not.includes(t))); }
    this.hintOrder = shuffle(this.ctx.rng, [...this.secret].map((ch, i) => /[a-z0-9]/i.test(ch) ? i : -1).filter(i => i >= 0));
  }

  planBots(now: number) {
    this.botEvents = [];
    for (const p of this.ctx.players) {
      if (!p.bot || p.id === this.artist) continue;
      for (let k = 0; k < 2; k++) this.botEvents.push({ at: now + DUR_MS * (0.1 + this.ctx.rng() * 0.6), id: p.id, text: pick(this.ctx.rng, WORDS) });
      if (this.ctx.rng() < 0.6) this.botEvents.push({ at: now + DUR_MS * (0.25 + this.ctx.rng() * 0.6), id: p.id, text: this.secret });
    }
  }

  hint(now: number): string {
    const level = now - this.startAt >= DUR_MS * 0.75 ? 2 : now - this.startAt >= DUR_MS * 0.5 ? 1 : 0;
    const shown = new Set(this.hintOrder.slice(0, level * Math.max(1, Math.round(this.hintOrder.length / 6))));
    return [...this.secret].map((ch, i) => !/[a-z0-9]/i.test(ch) ? ch : shown.has(i) ? ch : '_').join('');
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }

  guess(from: string, raw: string, now: number) {
    if (this.step !== 'q' || from === this.artist || this.got.has(from) || !this.ctx.players.some(p => p.id === from)) return;
    if (now - (this.lastGuess.get(from) ?? 0) < 400) return;
    this.lastGuess.set(from, now);
    const text = String(raw ?? '').trim().slice(0, 40);
    if (!norm(text)) return;
    if (guessMatches(text, this.secret)) {
      this.got.set(from, now - this.startAt);
      this.feed.push({ id: from, text: '' });
      this.ctx.event(`✅ ${this.name(from)} got it!`);
      const left = this.ctx.players.filter(p => p.id !== this.artist && this.ctx.connected(p.id) && !this.got.has(p.id));
      if (!left.length) this.endsAt = Math.min(this.endsAt, now + 1200);
    } else if (norm(this.secret).length >= 4 && lev(norm(text), norm(this.secret)) <= Math.max(1, Math.floor(this.secret.length / 8))) {
      this.ctx.send(from, { t: 'event', text: `🔥 "${text}" is SO close` });
      return;
    } else {
      this.feed.push({ id: from, text });
      if (this.feed.length > 40) this.feed.shift();
    }
    this.ctx.changed();
  }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k === 'guess') return this.guess(from, msg.text, now);
    if (from !== this.artist || this.step !== 'q') return;
    if (msg?.k === 'ink' && this.mode === 'draw') {
      const id = String(msg.id ?? '').slice(0, 40);
      const pts = (Array.isArray(msg.pts) ? msg.pts.slice(0, 400) : []).map((v: unknown) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
      if (!id || pts.length < 2 || this.ink + pts.length > MAX_INK) return;
      this.ink += pts.length;
      let st = this.strokes.find(s => s.id === id);
      if (!st) {
        st = { id, c: INK_COLORS.includes(msg.c) ? msg.c : INK_COLORS[0], w: Math.max(4, Math.min(80, Number(msg.w) || 10)), pts: [] };
        this.strokes.push(st);
      }
      st.pts.push(...pts);
      this.ctx.toAllBut(from, { t: 'ink', id, c: st.c, w: st.w, pts });
    } else if (msg?.k === 'clear' && this.mode === 'draw') {
      this.strokes = [];
      this.ctx.toAllBut(from, { t: 'inkClear' });
    } else if (msg?.k === 'pass' && this.mode === 'perform' && this.passes < 2 && !this.got.size) {
      this.passes++;
      this.newSecret([this.secret]);
      this.startAt = now;
      this.endsAt = now + DUR_MS;
      this.feed = [];
      this.planBots(now);
      this.ctx.event(`🙈 ${this.name(from)} asked for a different one`);
      this.ctx.changed();
    }
  }

  onJoin(_id: string | null, send: (msg: unknown) => void) {
    if (this.mode === 'draw') send({ t: 'inkAll', strokes: this.strokes });
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.step === 'q') {
      for (const e of this.botEvents.filter(e => now >= e.at)) this.guess(e.id, e.text, now);
      this.botEvents = this.botEvents.filter(e => now < e.at);
      const hint = this.hint(now);
      if (hint !== this.lastHint) { this.lastHint = hint; this.ctx.changed(); }
      if (now >= this.endsAt) {
        this.score();
        this.step = 'rev';
        this.endsAt = now + REV_MS;
        this.ctx.changed();
      }
    } else if (now >= this.endsAt) this.finish();
  }

  score() {
    for (const p of this.ctx.players) this.scores.set(p.id, 0);
    for (const [id, t] of this.got) this.scores.set(id, Math.round(1000 * (1 - 0.5 * Math.min(1, t / DUR_MS))));
    this.scores.set(this.artist, 300 * this.got.size);
  }

  finish() {
    const icon = this.mode === 'draw' ? '🎨' : '🎤';
    const ranking = placesByScore(this.ctx.players, p => this.scores.get(p.id) ?? 0).map(({ item, place }) => ({
      id: item.id, place,
      stat: item.id === this.artist ? `${icon} ${this.got.size} got it` : this.got.has(item.id) ? `got it in ${(this.got.get(item.id)! / 1000).toFixed(1)}s` : 'no luck',
    }));
    const guessers = this.ctx.players.length - 1;
    const wrong = this.feed.filter(f => f.text);
    const lines: string[] = [];
    if (wrong.length) { const w = pick(this.ctx.rng, wrong); lines.push(`Best wrong guess: "${w.text}" (${this.name(w.id)})`); }
    if (!this.got.size) lines.push(this.mode === 'draw' ? `Nobody got it. ${this.name(this.artist)} is an abstract artist now.` : `Nobody got it. ${this.name(this.artist)}, that was apparently "${this.secret}".`);
    if (guessers >= 2 && this.got.size === guessers) lines.push(`Everyone got it. ${this.name(this.artist)}, quit your day job.`);
    const awards = [];
    if (guessers >= 2 && this.got.size === guessers) awards.push({ emoji: icon, title: this.mode === 'draw' ? 'Picasso' : 'World Tour', desc: 'everyone got it', id: this.artist });
    const first = [...this.got].sort((a, b) => a[1] - b[1])[0];
    if (first && first[1] < 10000) awards.push({ emoji: '⚡', title: 'Suspiciously Fast', desc: `got it in ${(first[1] / 1000).toFixed(1)}s`, id: first[0] });
    this.result = {
      ranking, awards, roast: lines.length ? pick(this.ctx.rng, lines) : '',
      headline: `${icon} It was "${this.secret}" · ${this.got.size}/${guessers} got it`,
    };
  }

  view(forId: string | null, now: number) {
    const knows = this.step === 'rev' || forId === this.artist || (forId !== null && this.got.has(forId));
    return {
      mode: this.mode, artist: this.artist, type: this.type, step: this.step,
      secret: knows ? this.secret : '', hint: this.hint(now), endsAt: this.endsAt, durMs: this.step === 'q' ? DUR_MS : REV_MS,
      got: [...this.got.keys()], feed: this.feed.slice(-8), passesLeft: 2 - this.passes,
      scores: this.step === 'rev' ? Object.fromEntries(this.scores) : null,
    };
  }
}

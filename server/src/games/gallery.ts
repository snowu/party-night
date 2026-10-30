// Draw Off (lifted from Retro Rumble's draw-off, opened up to everyone): every
// human gets the same word and 30 seconds to draw it on their own screen. Then the
// drawings come back as an anonymous gallery (A, B, C…) and everyone votes for
// their favourite, never their own. Who drew what stays secret until the reveal.
//
// Ink isn't broadcast while people draw (nobody copies, nobody peeks); the whole
// gallery is sent once, as its own message, when voting opens, so big drawings
// don't ride along on every state update.
import { WORDS } from './content.ts';
import { INK_COLORS } from './guessing.ts';
import { pick, shuffle, type GameCtx, type RoundResult, type ServerGame } from './types.ts';
import { placesByScore } from '../../../shared/points.ts';

const DRAW_MS = 30000;
const VOTE_MS = 20000;
const REV_MS = 7000;
const MAX_INK = 15000;          // numbers per artist
const PER_VOTE = 400;           // to the artist, per vote
const BACKED_WINNER = 200;      // to each voter who picked a winning drawing

interface Stroke { id: string; c: string; w: number; pts: number[] }

export class Gallery implements ServerGame {
  result: RoundResult | null = null;
  word: string;
  step: 'draw' | 'vote' | 'rev' = 'draw';
  endsAt: number;
  ink = new Map<string, { strokes: Stroke[]; n: number }>();   // artist id → drawing
  slots: string[] = [];          // gallery order: slot i was drawn by slots[i]
  votes = new Map<string, number>();
  botVoteAt = new Map<string, number>();
  scores = new Map<string, number>();
  counts: number[] = [];

  constructor(public ctx: GameCtx, now: number) {
    this.word = pick(ctx.rng, WORDS);
    this.endsAt = now + DRAW_MS;
    for (const p of ctx.players) {
      this.scores.set(p.id, 0);
      if (!p.bot) this.ink.set(p.id, { strokes: [], n: 0 });
    }
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }
  voters() { return this.ctx.players.filter(p => this.ctx.connected(p.id)); }
  // Everyone but the artist of the only drawing can vote; with one drawing there's nothing to choose.
  canVote(id: string) { return this.slots.some(a => a !== id); }

  galleryMsg() {
    return { t: 'gallery', word: this.word, drawings: this.slots.map((a, slot) => ({ slot, strokes: this.ink.get(a)!.strokes.map(({ c, w, pts }) => ({ c, w, pts })) })) };
  }

  onMessage(from: string, msg: any, now: number) {
    if (this.step === 'draw' && msg?.k === 'ink') {
      const d = this.ink.get(from);
      const id = String(msg.id ?? '').slice(0, 40);
      const pts = (Array.isArray(msg.pts) ? msg.pts.slice(0, 400) : []).map((v: unknown) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
      if (!d || !id || pts.length < 2 || d.n + pts.length > MAX_INK) return;
      d.n += pts.length;
      let st = d.strokes.find(s => s.id === id);
      if (!st) {
        st = { id, c: INK_COLORS.includes(msg.c) ? msg.c : INK_COLORS[0], w: Math.max(4, Math.min(80, Number(msg.w) || 10)), pts: [] };
        d.strokes.push(st);
      }
      st.pts.push(...pts);
    } else if (this.step === 'draw' && msg?.k === 'clear') {
      const d = this.ink.get(from);
      if (d) d.strokes = [];
    } else if (this.step === 'vote' && msg?.k === 'vote') {
      const slot = Number(msg.slot);
      if (this.votes.has(from) || !this.scores.has(from) || !Number.isInteger(slot) || !this.slots[slot] || this.slots[slot] === from) return;
      this.votes.set(from, slot);
      const left = this.voters().filter(p => this.canVote(p.id) && !this.votes.has(p.id));
      if (!left.length) this.endsAt = Math.min(this.endsAt, now + 800);
      this.ctx.changed();
    }
  }

  onJoin(_id: string | null, send: (msg: unknown) => void) {
    if (this.step !== 'draw') send(this.galleryMsg());
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.step === 'draw') {
      if (now < this.endsAt) return;
      this.slots = shuffle(this.ctx.rng, [...this.ink].filter(([, d]) => d.strokes.length).map(([id]) => id));
      if (this.slots.length < 2) return this.finish('🖌️ Not enough drawings to vote on. Art is dead.');
      this.step = 'vote';
      this.endsAt = now + VOTE_MS;
      for (const p of this.ctx.players) if (p.bot) this.botVoteAt.set(p.id, now + VOTE_MS * (0.2 + this.ctx.rng() * 0.6));
      this.ctx.toAllBut('', this.galleryMsg());
      this.ctx.changed();
    } else if (this.step === 'vote') {
      for (const [id, at] of this.botVoteAt) {
        if (now < at) continue;
        this.botVoteAt.delete(id);
        this.onMessage(id, { k: 'vote', slot: Math.floor(this.ctx.rng() * this.slots.length) }, now);
      }
      if (now >= this.endsAt) this.reveal(now);
    } else if (now >= this.endsAt) this.finish();
  }

  reveal(now: number) {
    this.counts = this.slots.map(() => 0);
    for (const slot of this.votes.values()) this.counts[slot]++;
    const most = Math.max(0, ...this.counts);
    this.slots.forEach((a, slot) => this.scores.set(a, (this.scores.get(a) ?? 0) + PER_VOTE * this.counts[slot]));
    for (const [id, slot] of this.votes) if (most && this.counts[slot] === most) this.scores.set(id, (this.scores.get(id) ?? 0) + BACKED_WINNER);
    this.step = 'rev';
    this.endsAt = now + REV_MS;
    this.ctx.changed();
  }

  finish(headline?: string) {
    const most = Math.max(0, ...this.counts);
    const winners = this.slots.filter((_, i) => most && this.counts[i] === most);
    const ranking = placesByScore(this.ctx.players, p => this.scores.get(p.id) ?? 0).map(({ item, place }) => {
      const slot = this.slots.indexOf(item.id);
      return { id: item.id, place, stat: slot >= 0 ? `🖌️ ${this.counts[slot] ?? 0} vote${this.counts[slot] === 1 ? '' : 's'}` : this.votes.has(item.id) ? 'voted' : '' };
    });
    const zero = this.slots.filter((_, i) => !this.counts[i]);
    const lines = [
      ...(winners.length > 1 ? ['A tie. Everyone\'s a winner, nobody\'s happy.'] : []),
      ...(zero.length ? [`${this.name(pick(this.ctx.rng, zero))} got zero votes. Art is subjective.`] : []),
    ];
    this.result = {
      ranking,
      headline: headline ?? (winners.length === 1 ? `🏆 ${this.name(winners[0])} drew the best ${this.word}` : winners.length ? `🖌️ ${winners.map(w => this.name(w)).join(' and ')} tie for the best ${this.word}` : `🖌️ Nobody voted. Art is dead.`),
      roast: lines.length ? pick(this.ctx.rng, lines) : '',
      awards: winners.length === 1 ? [{ emoji: '🖼️', title: 'Gallery Pick', desc: `${most} vote${most === 1 ? '' : 's'} for their ${this.word}`, id: winners[0] }] : [],
    };
  }

  view(forId: string | null) {
    const reveal = this.step === 'rev';
    return {
      step: this.step,
      word: this.word,
      endsAt: this.endsAt,
      durMs: this.step === 'draw' ? DRAW_MS : this.step === 'vote' ? VOTE_MS : REV_MS,
      drawing: forId ? this.ink.has(forId) : false,
      mySlot: forId ? this.slots.indexOf(forId) : -1,
      slots: this.slots.length,
      voted: [...this.votes.keys()],
      myVote: forId ? this.votes.get(forId) ?? null : null,
      // The reveal: who drew each slot, and its votes. Nothing about artists before that.
      artists: reveal ? this.slots : null,
      counts: reveal ? this.counts : null,
      scores: reveal ? Object.fromEntries(this.scores) : null,
    };
  }
}

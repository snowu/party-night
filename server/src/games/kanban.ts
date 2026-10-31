// Kanban Rush: the same tickets fall down everyone's board, faster and faster;
// drag each into the right column (Bug, Feature, Not our problem) before it
// crosses the line. Right scores more the longer your streak; wrong costs.
// The board runs on each phone; the server only hears where each ticket landed.
import { placesByScore } from '../../../shared/points.ts';
import type { Award } from '../../../shared/protocol.ts';
import { KANBAN, points, type KanbanScore, type KanbanView, type Ticket } from '../../../shared/kanban.ts';
import { mostAward, pick, shuffle, type GameCtx, type RoundResult, type ServerGame } from './types.ts';

// Obvious to anyone, engineer or not.
const TICKETS: string[][] = [
  [
    'Login button does nothing', 'App crashes when I press back', 'Prices show as NaN', 'Password reset email never arrives',
    'Page loads forever', 'Checkout charged me twice', 'Photos appear upside down', 'Save button deletes my file',
    'Calendar says February has 31 days', 'Notifications arrive three days late', 'Typing an emoji crashes the form',
    'The total doesn\'t add up', 'Map shows our office in the sea', 'Help link goes to a 404', 'Logging out logs me in as someone else',
    'Dark mode makes the text invisible', 'Search shows last week\'s results',
  ],
  [
    'Add dark mode', 'Let me export to Excel', 'Can we have a mobile app?', 'Add a "remind me later" button',
    'Support Spanish', 'Let me upload a profile photo', 'Add keyboard shortcuts', 'Show a progress bar',
    'Sign in with Google, please', 'Add an undo button', 'Let me pin my favourite projects', 'Send me a weekly summary email',
    'Filter search results by date', 'Let me share a link to this report', 'Add a calendar view', 'Custom colours for labels',
  ],
  [
    'The office coffee machine is broken', 'My cat sat on my keyboard', 'The Wi-Fi at my beach house is slow',
    'Can you fix my printer at home?', 'My horoscope was wrong', 'The lift is stuck on floor 3', 'It\'s raining',
    'Someone ate my yoghurt from the fridge', 'My neighbour\'s dog keeps barking', 'The pizza arrived cold',
    'The meeting room smells of fish', 'My phone fell in the toilet', 'Mondays come round too often', 'The office plants look sad',
    'I forgot my bank password',
  ],
];

interface Plan { i: number; at: number; col: number }   // a bot's next sort

export class KanbanRush implements ServerGame {
  result: RoundResult | null = null;
  phase: KanbanView['phase'] = 'count';
  startAt: number;
  endAt: number;
  doneAt = 0;
  deck: Ticket[] = [];
  scores = new Map<string, KanbanScore>();
  sorted = new Map<string, Map<number, number>>();
  best = new Map<string, number>();      // longest streak
  dumped = new Map<string, number>();    // real work filed as Not our problem
  plans = new Map<string, Plan[]>();

  constructor(public ctx: GameCtx, now: number) {
    const rng = ctx.rng;
    this.startAt = now + KANBAN.countdownMs;
    this.endAt = this.startAt + KANBAN.playMs;
    // Tickets come quicker and fall faster as the round goes on; every one lands before the whistle.
    const bags = TICKETS.map(t => shuffle(rng, t));
    for (let at = 600; ; ) {
      const k = at / KANBAN.playMs, fall = 5200 - 2600 * k;
      if (at + fall > KANBAN.playMs - 300) break;
      const cat = Math.floor(rng() * 3), text = bags[cat].pop() ?? pick(rng, TICKETS[cat]);
      // Usually it starts in a wrong column; now and then you get a freebie.
      const col = rng() < 0.2 ? cat : (cat + 1 + Math.floor(rng() * 2)) % 3;
      this.deck.push({ text, cat, col, at: Math.round(at), fall: Math.round(fall) });
      at += 1900 - 1150 * k;
    }
    for (const p of ctx.players) {
      this.scores.set(p.id, { id: p.id, score: 0, right: 0, wrong: 0, streak: 0 });
      this.sorted.set(p.id, new Map());
      if (!p.bot) continue;
      const skill = 0.55 + rng() * 0.35;
      this.plans.set(p.id, this.deck.map((t, i) => ({
        i, at: t.at + t.fall * (0.3 + rng() * 0.6),
        col: rng() < skill ? t.cat : (t.cat + 1 + Math.floor(rng() * 2)) % 3,
      })).sort((a, b) => a.at - b.at));
    }
  }

  name(id: string) { return this.ctx.players.find(p => p.id === id)?.name ?? '?'; }

  sort(id: string, i: number, col: number, now: number) {
    const t = this.deck[i], mine = this.sorted.get(id), s = this.scores.get(id);
    if (!t || !mine || !s || mine.has(i) || !(col >= 0 && col < 3) || now < this.startAt + t.at - 1000) return;
    mine.set(i, col);
    const right = col === t.cat;
    s.score += points(right, s.streak);
    if (right) { s.right++; s.streak++; this.best.set(id, Math.max(this.best.get(id) ?? 0, s.streak)); }
    else {
      s.wrong++; s.streak = 0;
      if (col === 2) this.dumped.set(id, (this.dumped.get(id) ?? 0) + 1);
    }
    this.ctx.changed();
  }

  onMessage(from: string, msg: any, now: number) {
    if (msg?.k !== 'sort' || this.phase === 'count' || this.result) return;
    if (this.phase === 'done' && now > this.endAt + KANBAN.graceMs) return;
    this.sort(from, Math.floor(Number(msg.i)), Math.floor(Number(msg.col)), now);
  }

  onTick(now: number) {
    if (this.result) return;
    if (this.phase === 'count' && now >= this.startAt) { this.phase = 'play'; this.ctx.changed(); }
    if (this.phase === 'play') {
      for (const [id, plan] of this.plans) {
        while (plan.length && now >= this.startAt + plan[0].at) { const p = plan.shift()!; this.sort(id, p.i, p.col, now); }
      }
      if (now >= this.endAt) { this.phase = 'done'; this.doneAt = now + KANBAN.endMs; this.ctx.changed(); }
    } else if (this.phase === 'done' && now >= this.doneAt) this.finish();
  }

  finish() {
    const s = (id: string) => this.scores.get(id)!;
    const ranking = placesByScore(this.ctx.players.map(p => p.id), id => s(id).score).map(({ item: id, place }) => ({
      id, place, stat: `🗂️ ${s(id).score} · ${s(id).right}/${this.deck.length} right`,
    }));
    const top = [...this.scores.values()].sort((a, b) => b.score - a.score)[0];
    const headline = top && top.score > 0 ? `🗂️ ${this.name(top.id)} clears the backlog with ${top.score} points` : '🗂️ The backlog wins. It always does.';
    const awards = [
      mostAward(this.ctx.players, id => this.best.get(id) ?? 0, '🔥', 'On a Roll', n => `${n} tickets in a row right`),
      mostAward(this.ctx.players, id => this.dumped.get(id) ?? 0, '🙃', 'Not My Job', n => `filed ${n} real ticket${n === 1 ? '' : 's'} as Not our problem`),
    ].filter((a): a is Award => !!a);
    this.result = { ranking, headline, awards };
  }

  view(forId: string | null): KanbanView {
    return {
      phase: this.phase, startAt: this.startAt, endAt: this.endAt, deck: this.deck,
      scores: [...this.scores.values()],
      mine: Object.fromEntries((forId && this.sorted.get(forId)) || []),
    };
  }
}

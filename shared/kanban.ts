// ─── KANBAN RUSH (shared) ─────────────────────────────────────────────────────
// Tickets fall down your own board; drag each sideways into the right column
// before it reaches the line. Everyone gets the same tickets at the same times.

export const KANBAN = {
  countdownMs: 3000,
  playMs: 45000,
  endMs: 3000,
  graceMs: 1500,          // a sort that lands just after the whistle still counts
  right: 100,
  streak: 10,             // and this much more per ticket in a row right, up to…
  maxStreak: 10,
  wrong: -50,
  cols: ['🐛 Bug', '✨ Feature', '🙃 Not our problem'],
};

// at: when it appears (ms after the start); fall: how long it takes to reach the
// line; col: the column it starts in.
export interface Ticket { text: string; cat: number; col: number; at: number; fall: number }
export interface KanbanScore { id: string; score: number; right: number; wrong: number; streak: number }
export interface KanbanView {
  phase: 'count' | 'play' | 'done';
  startAt: number;
  endAt: number;
  deck: Ticket[];
  scores: KanbanScore[];
  mine: Record<number, number>;   // tickets I've sorted → the column
}

export const points = (right: boolean, streak: number) => (right ? KANBAN.right + KANBAN.streak * Math.min(streak, KANBAN.maxStreak) : KANBAN.wrong);

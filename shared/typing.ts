// ─── TYPING RACE (shared) ─────────────────────────────────────────────────────
// Everyone types the same short passage; every right letter moves your face
// along your lane. A wrong key doesn't move you, it only counts against you.

export const TYPING = {
  countdownMs: 3000,
  raceMs: 70000,
  graceMs: 12000,         // once someone finishes, everyone else has this long
  endMs: 4000,            // the finished track stays up this long
  maxCps: 18,             // faster than anyone types: anything quicker is a paste
  tickMs: 100,            // lanes update this often
  sendMs: 100,            // a phone reports its progress this often
};

export interface Lane { id: string; n: number; e: number; ms: number | null }   // letters typed, mistakes, finish time
export interface TypingView {
  phase: 'count' | 'race' | 'done';
  text: string;
  startAt: number;
  endAt: number;
  lanes: Lane[];
}

// Phones type capitals and curly apostrophes; neither should count as a typo.
export const norm = (c: string) => c.replace(/[’‘]/g, "'").toLowerCase();
export const wpm = (chars: number, ms: number) => Math.round(chars / 5 / (ms / 60000));

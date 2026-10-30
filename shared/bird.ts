// Bird Race numbers both halves read, so the countdown, course and closing timers agree.
export const RACE = {
  courseSec: 30,          // nominal clean-run length to the 🏁
  capMs: 90000,           // hard cap after the start
};

export const COUNTDOWN_MS = 3000;
export const FINISH_GRACE_MS = 20000;  // a race closes this long after the first finisher
export const STALE_MS = 4000;          // silent this long → 'gone' until the next report
export const PX_PER_M = 50;            // distance shown as metres

export type BirdSt = 'fly' | 'fin' | 'out' | 'gone';
export interface BirdPub { id: string; st: BirdSt; d: number; fm: number; bk: number }
export interface BirdView {
  startAt: number;
  courseSec: number;
  capAt: number;
  birds: BirdPub[];
}

export const ATTACKS = [
  { id: 'rate', name: 'Rate Limited', what: 'world slowed for a moment' },
  { id: 'mfa', name: 'MFA Challenge', what: 'bonk!' },
];

export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
export const medal = (n: number) => ['🥇', '🥈', '🥉'][n - 1] ?? '';

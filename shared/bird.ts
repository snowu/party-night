// The four bird games are one race engine with different rules. Client and server
// both read these numbers so the countdown, course and closing timers agree.
export interface BirdVariant {
  courseSec: number;      // nominal clean-run length to the 🏁; 0 = no finish line
  bonks: boolean;         // false = one hit and you're out
  attacks: boolean;       // 🎯 coins that hit the leader
  durationMs?: number;    // fixed-length round (Dev vs Ops)
  elimFirstMs?: number;   // Least Privilege: first audit, then one every elimEveryMs
  elimEveryMs?: number;
  capMs: number;          // hard cap after the start
}

export const BIRD: Record<string, BirdVariant> = {
  race: { courseSec: 30, bonks: true, attacks: true, capMs: 90000 },
  leastpriv: { courseSec: 0, bonks: true, attacks: false, elimFirstMs: 10000, elimEveryMs: 6000, capMs: 150000 },
  onelife: { courseSec: 40, bonks: false, attacks: false, capMs: 80000 },
  devops: { courseSec: 0, bonks: true, attacks: false, durationMs: 40000, capMs: 40000 },
};

export const COUNTDOWN_MS = 3000;
export const FINISH_GRACE_MS = 20000;  // a race closes this long after the first finisher
export const STALE_MS = 4000;          // silent this long → 'gone' until the next report
export const PX_PER_M = 50;            // distance shown as metres

export type BirdSt = 'fly' | 'fin' | 'out' | 'gone';
export interface BirdPub { id: string; st: BirdSt; d: number; fm: number; bk: number; team?: 'dev' | 'ops' }
export interface BirdView {
  variant: string;
  startAt: number;
  courseSec: number;
  capAt: number;
  endsAt: number;           // Dev vs Ops clock; 0 otherwise
  nextElimAt: number;       // Least Privilege; 0 otherwise
  birds: BirdPub[];
  totals: { dev: number; ops: number } | null;
}

export const ATTACKS = [
  { id: 'rate', name: 'Rate Limited', what: 'world slowed for a moment' },
  { id: 'mfa', name: 'MFA Challenge', what: 'bonk!' },
];

export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
export const medal = (n: number) => ['🥇', '🥈', '🥉'][n - 1] ?? '';

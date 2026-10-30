// The server half of the minigame contract. A game is created when its round
// starts and is driven only by messages and tick(now): no timers of its own, so
// a whole night can run in a Node test with a fake clock.
import type { Award, Ranking } from '../../../shared/protocol.ts';

export interface Seat {
  id: string;
  name: string;
  bot: boolean;
  performer: boolean;
}

export interface GameCtx {
  seed: number;
  rng: () => number;                        // seeded from the round seed
  players: Seat[];                          // this round's participants, join order
  connected(id: string): boolean;           // bots are always connected
  hostId(): string;
  event(text: string): void;                // toast on every screen
  send(id: string, msg: unknown): void;     // to one player's sockets
  toAllBut(id: string, msg: unknown): void; // every socket (spectators too) except one player's
  changed(): void;                          // ask for a state broadcast
}

export interface RoundResult {
  ranking: Ranking[];
  awards: Award[];
  headline: string;
  roast?: string;
  photoFinish?: { a: string; b: string; margin: number } | null;
}

export interface ServerGame {
  onMessage(from: string, msg: any, now: number): void;
  onTick(now: number): void;
  view(forId: string | null, now: number): unknown;
  onJoin?(id: string | null, send: (msg: unknown) => void): void;  // a socket (re)connected mid-round
  result: RoundResult | null;               // set once the round is over
}

export type GameFactory = (ctx: GameCtx, now: number) => ServerGame;

export const pick = <T>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
export function shuffle<T>(rng: () => number, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "most of a stat wins" award, skipped when nobody has any.
export function mostAward(players: Seat[], f: (id: string) => number, emoji: string, title: string, desc: (n: number) => string): Award | null {
  const best = players.filter(p => f(p.id) > 0).sort((a, b) => f(b.id) - f(a.id))[0];
  return best ? { emoji, title, desc: desc(f(best.id)), id: best.id } : null;
}

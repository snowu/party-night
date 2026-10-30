// ─── WIRE PROTOCOL ────────────────────────────────────────────────────────────
// One WebSocket per client into the room's Durable Object. The DO is the
// authority for the SHELL (lobby, host, rotation, points, awards) and for each
// minigame's outcome; it also relays a game's fast live state (bird positions)
// verbatim between clients, so a 20Hz race never goes through game logic.
//
// client → server
//   {t:'set', name?, avatar?, color?, hat?, performer?}   profile / lobby toggles
//   {t:'host', op, ...}                                     host-only shell controls
//   {t:'g', ...}                                            to the current minigame
//   {t:'bc', e, p}                                          relay to everyone else
// server → client
//   ShellState                                              on every change
//   {t:'bc', e, p}                                          relayed from another client
//   {t:'event', text}                                       a toast ("🏁 Kevin finished 1st")

export type Phase = 'lobby' | 'intro' | 'play' | 'results' | 'podium';
export type Kind = 'bird' | 'social';

export interface PlayerPub {
  id: string;
  name: string;
  avatar: string;
  color: string;
  hat: string;
  bot: boolean;
  connected: boolean;
  points: number;
  performer: boolean;   // opted in to hum and mime
}

export interface GameInfo {
  id: string;
  title: string;
  blurb: string;
  kind: Kind;
  how: string;          // one line of controls for the intro card
}

export interface Award {
  emoji: string;
  title: string;
  desc: string;
  id: string;
}

// What a minigame hands back: an ordered result (ties share a place) plus its awards.
export interface Ranking {
  id: string;
  place: number;
  stat?: string;        // "31.2s", "2,400 pts", "deprovisioned at 41%"
}

export interface RoundOutcome {
  game: string;
  chaos: boolean;
  headline: string;
  roast: string;
  ranking: Array<Ranking & { gained: number }>;
  awards: Award[];
  photoFinish: { a: string; b: string; margin: number } | null;
}

export interface ShellState {
  t: 'state';
  code: string;
  phase: Phase;
  me: string | null;              // null on the spectator screen
  hostId: string;
  players: PlayerPub[];           // join order
  round: number;                  // 1-based; 0 in the lobby
  totalRounds: number;
  game: (GameInfo & { chaos: boolean }) | null;
  participants: string[];         // who is in the current round
  seed: number;
  phaseEndsAt: number;            // server ms; 0 = waits for the host
  now: number;                    // server clock, for skew correction
  settings: Settings;
  outcome: RoundOutcome | null;   // results phase
  history: RoundOutcome[];        // every finished round tonight
  nightAwards: Award[];           // podium phase
  gv: unknown;                    // the current minigame's view for this viewer
}

export interface Settings {
  rounds: number;
  games: string[];                // enabled minigame ids
}

export const ROUND_CHOICES = [4, 6, 8, 10, 12];
export const MAX_PLAYERS = 24;
export const MAX_BOTS = 12;
export const MAX_FRAME = 16 * 1024;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O: read aloud on a call

export const AVATARS = ['bird', 'penguin', 'monkey', 'rocket', 'bee', 'dragon', 'airplane', 'robot', 'horse', 'squid', 'butterfly'];
export const COLORS = ['#ffd23f', '#ff3d9a', '#2de2e6', '#3ef08a', '#ff8a3d', '#8b5cf6', '#ff4d6d', '#5b8cff'];
export const HATS = ['', '🎩', '👑', '🧢', '🎓', '⛑️', '🎉', '🤠'];

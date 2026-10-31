// The minigames a night is built from. Server and client both read this list;
// the logic lives in server/src/games (outcome) and src/games (screens).
import type { GameInfo } from './protocol.ts';

export interface CatalogEntry extends GameInfo {
  minPlayers: number;      // humans + bots
  needs?: 'artist' | 'performer' | 'artists';   // one human artist, an opted-in performer, or 2+ humans
  optIn?: boolean;         // unticked in a new lobby: niche enough that the host should choose it
}

export const CATALOG: CatalogEntry[] = [
  { id: 'race', kind: 'bird', minPlayers: 1, title: 'Bird Race', blurb: 'Flap. Bonk. Flap again. First to the 🏁 wins.',
    how: 'Tap, click or Space to flap. Thread a 🎯 coin to hit whoever is leading.' },
  { id: 'quiz', kind: 'social', minPlayers: 1, title: 'Pop Quiz', blurb: 'Five questions. Faster right answers score more.',
    how: 'Pick an answer before the bar runs out. The last one is a closest-number guess.' },
  { id: 'approve', kind: 'social', minPlayers: 1, optIn: true, title: 'Approve or Deny', blurb: 'An IAM policy, a request, six seconds. Decide.',
    how: 'Explicit Deny beats Allow. No matching Allow means Deny. Wildcards match.' },
  { id: 'hottake', kind: 'social', minPlayers: 2, title: 'Hot Takes', blurb: 'Agree or disagree, then guess how many of the team agree with you.',
    how: 'Vote, then drag the slider to the share of the team you think agrees.' },
  { id: 'who', kind: 'social', minPlayers: 3, title: 'Who Wrote It?', blurb: 'Answer a prompt. Then guess who wrote what.',
    how: 'Write something true (or plausible). Fool people for points.' },
  { id: 'mostlikely', kind: 'social', minPlayers: 3, title: 'Most Likely To', blurb: 'Vote for a teammate. Agreeing with the room scores.',
    how: 'Three prompts. Vote with the majority to score. The winner gets a title.' },
  { id: 'draw', kind: 'social', minPlayers: 2, needs: 'artist', title: 'Draw It', blurb: 'One artist, one word, everyone else guesses.',
    how: 'The artist draws. Everyone else types guesses. Letters appear as hints.' },
  { id: 'gallery', kind: 'social', minPlayers: 2, needs: 'artists', title: 'Draw Off', blurb: 'Everyone draws the same word. Vote for the best. Artists stay secret until the end.',
    how: '30 seconds to draw on your own screen, then vote for your favourite (not your own).' },
  { id: 'perform', kind: 'social', minPlayers: 2, needs: 'performer', title: 'Hum & Mime', blurb: 'A volunteer hums and mimes a song or film. Guess it.',
    how: 'Unmute, perform on camera. Everyone else types guesses. Opt in from the lobby.' },
  { id: 'rootcause', kind: 'social', minPlayers: 2, title: 'Root Cause Analysis', blurb: 'A true tech fact with a blank. Invent a fake answer, then find the real one.',
    how: 'Write a believable fake. Score for picking the truth, and for every teammate who picks your fake.' },
  { id: 'hivemind', kind: 'social', minPlayers: 2, title: 'Alignment Meeting', blurb: 'Everyone answers the same prompt. You score for agreeing with the room.',
    how: 'Type what you think most of the team will type. Original thinking is not rewarded here.' },
  { id: 'review', kind: 'social', minPlayers: 3, title: 'Performance Review', blurb: 'Two real achievements and one fabrication. Spot the lie.',
    how: 'Write two truths and a lie about your work life and mark the lie. Then find everyone else\'s.' },
  { id: 'codereview', kind: 'social', minPlayers: 3, title: 'Code Review', blurb: 'Two people answer the same prompt. Everyone else votes which one to merge.',
    how: 'Write the funniest answer to your prompt. Votes are points; a unanimous approval earns a bonus.' },
  { id: 'incident', kind: 'social', minPlayers: 1, title: 'Incident Response', blurb: 'Wait for the page, then ack it faster than anyone. False alarms score nothing.',
    how: 'When the screen turns red, tap (or press Space) as fast as you can. Tapping early is a false alarm.' },
  { id: 'oncall', kind: 'social', minPlayers: 2, title: 'On-Call Rotation', blurb: 'Pass the pager before it goes off. Whoever holds it at 3am is out.',
    how: 'If the pager is yours, tap a teammate to hand it over. Last ones standing win.' },
  { id: 'planning', kind: 'social', minPlayers: 1, title: 'Planning Poker', blurb: 'Estimate the number. Closest without going over wins.',
    how: 'Type your estimate. Anything over the real number is over budget and scores nothing.' },
  { id: 'hockey', kind: 'social', minPlayers: 2, title: 'Air Hockey Cup', blurb: 'The office air hockey table, knockout tournament. Quick 1v1 duels until one champion is left.',
    how: 'Your goal is at the bottom: move your mallet with your finger or mouse (or the arrow keys). First to 3 wins the match. Knocked out? Watch the rest.' },
  { id: 'pool', kind: 'social', minPlayers: 1, title: 'Trick Shot', blurb: 'The break room pool table. Same layout for everyone, one shot each.',
    how: 'Drag back from anywhere and let go to shoot, like a slingshot. Each ball potted scores; sinking the white costs.' },
  { id: 'typing', kind: 'social', minPlayers: 1, title: 'Typing Race', blurb: 'Everyone types the same two sentences. Every right letter moves you along. First to the end wins.',
    how: 'Type what you see. A wrong key doesn\'t move you; capitals don\'t matter. On a phone, tap the box first.' },
  { id: 'kanban', kind: 'social', minPlayers: 1, title: 'Kanban Rush', blurb: 'Tickets rain down the board. Drag each into Bug, Feature or Not our problem before it hits the line.',
    how: 'Drag a ticket sideways (or tap a column, or use ← →). Right answers in a row score more; wrong ones cost.' },
];

export const gameById = (id: string) => CATALOG.find(g => g.id === id);

// Whether a game can run with these players (the connected ones), and if not, why.
export function whyNot(id: string, live: Array<{ bot: boolean; performer: boolean }>): string {
  const g = gameById(id);
  if (!g) return 'unknown game';
  const humans = live.filter(p => !p.bot);
  if (!humans.length) return 'needs a human';
  if (live.length < g.minPlayers) return `needs ${g.minPlayers}+ players`;
  if (g.needs === 'artist' && live.length < 2) return 'needs 2+ players';
  if (g.needs === 'artists' && humans.length < 2) return 'needs 2+ humans';
  if (g.needs === 'performer' && (live.length < 2 || !humans.some(p => p.performer))) return 'needs a 🎤 volunteer';
  return '';
}
export const DEFAULT_GAMES = CATALOG.filter(g => !g.optIn).map(g => g.id);

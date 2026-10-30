// The minigames a night is built from. Server and client both read this list;
// the logic lives in server/src/games (outcome) and src/games (screens).
import type { GameInfo } from './protocol.ts';

export interface CatalogEntry extends GameInfo {
  minPlayers: number;      // humans + bots
  needs?: 'artist' | 'performer' | 'artists';   // one human artist, an opted-in performer, or 2+ humans
}

export const CATALOG: CatalogEntry[] = [
  { id: 'race', kind: 'bird', minPlayers: 1, title: 'Bird Race', blurb: 'Flap. Bonk. Flap again. First to the 🏁 wins.',
    how: 'Tap, click or Space to flap. Thread a 🎯 coin to hit whoever is leading.' },
  { id: 'leastpriv', kind: 'bird', minPlayers: 2, title: 'Least Privilege', blurb: 'Every few seconds, last place gets deprovisioned.',
    how: 'Same race, no finish line. Stay out of last place when the audit comes round.' },
  { id: 'onelife', kind: 'bird', minPlayers: 1, title: 'One Life', blurb: 'No bonks. No respawns. No second chances.',
    how: 'One hit and you are out. Last bird flying (or first to the 🏁) wins.' },
  { id: 'devops', kind: 'bird', minPlayers: 2, title: 'Dev vs Ops', blurb: 'Two teams. Combined distance. Blame is shared.',
    how: '40 seconds. Your team’s distances add up. Bonks cost the whole team.' },
  { id: 'quiz', kind: 'social', minPlayers: 1, title: 'Pop Quiz', blurb: 'Five questions. Faster right answers score more.',
    how: 'Pick an answer before the bar runs out. The last one is a closest-number guess.' },
  { id: 'approve', kind: 'social', minPlayers: 1, title: 'Approve or Deny', blurb: 'An IAM policy, a request, six seconds. Decide.',
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
];

export const gameById = (id: string) => CATALOG.find(g => g.id === id);
export const DEFAULT_GAMES = CATALOG.map(g => g.id);

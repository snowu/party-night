# Party Night: handoff

A Mario Party-style game for team retros. You get one lobby and a night of short minigames, with a running points table and awards between rounds. It grows out of two projects built on 2026-10-29 for the 2026-10-30 retro:

| Project | Repo | Live | What to take from it |
|---|---|---|---|
| Least Privilege Bird | `~/personal/least-privlege-bird` → github.com/snowu/least-privlege-bird (the typo is in the real name) | https://snowu.github.io/least-privlege-bird/ | Real-time racing over a dumb relay, bots, deterministic seeded courses |
| Retro Rumble | `~/personal/retro-rumble` → github.com/snowu/retro-rumble | https://snowu.github.io/retro-rumble/ | Server-authoritative rounds in a Durable Object, draw/vote/hot-take rounds, awards, prank cards |

The working name "party-night" is a placeholder. Rename the folder and repo freely.

---

## 1. Start fast: repo + GitHub project

```bash
cd ~/personal/party-night
git init -b main
npm init -y && npm i -D esbuild typescript wrangler @cloudflare/workers-types

# Public repo (Pages on the free plan needs public)
gh repo create snowu/party-night --public --source . --remote origin

# Optional project board for the backlog in section 7
gh project create --owner snowu --title "Party Night"
# gh needs the `project` scope: gh auth refresh -s project
```

Then go to repo **Settings → Pages → Source: GitHub Actions**. If you skip this, the workflow runs and nothing gets published.

Don't add branch protection until you actually want PRs. On both earlier repos, every push to `main` hit "Changes must be made through a pull request" and needed the admin bypass.

### Suggested layout
```
party-night/
  index.html, manifest.webmanifest, icons/   # static page (GitHub Pages)
  src/
    main.ts            # boot, lobby UI, round flow UI
    net.ts             # WebSocket client (copy RelayChannel from LPB multiplayer.ts)
    shell/             # lobby, scoreboard, awards, between-round screens
    games/
      types.ts         # the Minigame contract (section 4)
      bird-race/       # ported from least-privlege-bird
      quiz/            # ported from retro-rumble
  server/              # Cloudflare Worker + Durable Object
    src/index.ts
    wrangler.jsonc
  .github/workflows/pages.yml
```

---

## 2. Deploying: two separate deploys, every time

**The page goes out with `git push` to `main`.** The GitHub Actions Pages workflow builds and publishes it. Copy LPB's `.github/workflows/deploy.yml`, which does three things:
- Runs the tests before building, so a broken determinism test blocks the deploy.
- Builds with esbuild into `dist/bundle.js`.
- Rewrites `dist/bundle.js` → `dist/bundle.js?v=<short sha>` in `index.html`. Without this cache-bust, people get the old bundle after a deploy.

**The server goes out with `npx wrangler deploy`,** run in `server/`. It does not deploy on push.
- Wrangler is logged in to the Cloudflare account, which is under a **different email than the git one**. Workers land on `*.zancato-t.workers.dev`.
- The Claude Code auto-mode classifier **blocks Claude from running `wrangler deploy`**. Run it yourself with `! cd server && npx wrangler deploy`.
- Durable Objects on the free plan need **SQLite-backed classes**:
  ```jsonc
  {
    "name": "party-night",
    "main": "src/index.ts",
    "compatibility_date": "2025-09-01",
    "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
    "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
  }
  ```
  If you rename the class later, add a new migration tag. Never edit `v1`.
- Retro Rumble also serves its page from the Worker (`"assets": { "directory": "./public" }`), so a single `wrangler dev` runs everything locally. That's handy, but the public page still goes through Pages.

**The page picks its server by hostname.** Use a function, not a constant, so modules still load in Node tests:
```ts
const serverUrl = () => location.hostname.endsWith('github.io')
  ? 'wss://party-night.zancato-t.workers.dev'
  : `ws://${location.hostname || 'localhost'}:8787`;
```

**Local dev:**
- Run the page with `esbuild --servedir=. --watch=forever --serve=<port>`. LPB uses :8003.
- Run the server with `cd server && npx wrangler dev --port <port>`. Port **8787 is usually taken** by LPB's relay, so pick another one, such as 8799.
- To kill a dev server, use `pkill -f "[w]rangler dev"`. A plain `pkill -f "wrangler dev"` also kills the shell that runs it.

**PWA manifest:** every snowu.github.io app needs its own manifest with a unique `"id": "/party-night/"`, `"scope": "./"` and PNG icons. Otherwise Chrome says "already installed" because of the other apps on the same origin.

**Supabase** (only if you want a persistent hall of fame): `npx supabase login` fails at Claude's `!` prompt because it isn't a TTY. Run login, link and deploy in your own WSL terminal. Docker isn't needed. Don't paste tokens into the chat.

---

## 3. Networking: what we learned

- **Don't use Supabase Realtime for real-time play.** The free tier counts *every delivery* toward 100 msgs/s per project, and a 10-player race needs about 400. A Cloudflare Durable Object is free at this scale, and dropping supabase-js shrank the LPB bundle from 372KB to 159KB.
- **Use one in-memory DO per 4-letter room code, with no storage.** The room disappears when the last socket leaves. Room codes use an alphabet without I and O (`ABCDEFGHJKLMNPQRSTUVWXYZ`) because people read them aloud on calls. Share rooms with a `?room=CODE` link.
- **There are two server styles. The party game wants a hybrid.**
  - LPB uses a **dumb relay** (`least-privlege-bird/relay/src/index.ts`, about 70 lines). It handles presence (`{t:'track',meta}` → `{t:'presence',metas}` to everyone) and broadcast (`{t:'bc',event,payload}` to everyone else). The game logic runs in clients, and the host is "the earliest-joined human". This is great for fast state.
    - **Weakness:** each client computes results on its own, so they can disagree. If the host leaves, their bots leave too.
  - Retro Rumble is **server-authoritative** (`retro-rumble/src/index.ts`). The DO owns phase, questions, answers and scores. It's correct and resilient, but it's not built for 20Hz movement.
  - **Recommendation for Party Night:** make the DO authoritative for the **shell**: lobby, round rotation, points, awards, host. Add a **relay channel** for minigame live state (positions and so on). Minigames send their final ranking to the DO, and the DO is the single source of truth for points.
- **Client sending pattern from LPB, which held up with 10 players:**
  - Batch snapshots every 50ms, and send a heartbeat at least every 400ms per owned entity.
  - Debounce presence updates.
  - Treat a player as stale after 4s of silence ("gone"), and revive them on their next snapshot. Wifi blips are common.
  - Auto-reconnect after 1s, re-sending the presence meta.
  - Limits: 32 sockets per room, 16KB per frame.
- **Close rounds with timers:**
  - A grace period after the first finisher (20s in LPB).
  - A hard cap past the nominal length.
  - Close early once nobody is still playing.
- **Shared courses:** send one seed at round start, and every client builds the same level from it. Use separate RNG streams (course vs items) so adding an item system doesn't shift the course. Run physics on a fixed timestep. Remote players are extrapolated from their last snapshot (honouring terminal velocity).
- **Bots run in the host's browser on `setInterval`, not `requestAnimationFrame`.** rAF stops when the host's game loop isn't running, for example on a results screen. Bot metadata rides in the host's presence meta. Give bots a deliberately imperfect brain (aim error, reaction lag, occasional zone-outs) or they win everything. In LPB they're still too strong with wide gaps, so cap their skill or rubber-band them.

---

## 4. The minigame contract (proposal)

```ts
export interface Minigame {
  id: string;
  title: string;
  blurb: string;               // one line on the intro card ("Flap. Don't die. Probably die.")
  minPlayers: number;
  durationSec: number;         // aim for 30–60s
  // Runs on every client. Owns the canvas until done. Must resolve with a ranking.
  play(ctx: {
    seed: number;
    players: Player[];          // humans + bots, stable order
    me: string;
    net: { send(ev: string, p: unknown): void; on(ev: string, fn: (p: unknown) => void): void };
    canvas: HTMLCanvasElement;
  }): Promise<void>;
  // Runs on the authority (the DO, or the host if the game is client-side only):
  // turns what was reported into an ordered result.
  rank(reports: Report[]): Array<{ id: string; place: number; stat?: string }>;
  awards?(reports: Report[]): Array<{ title: string; id: string }>;  // "🤕 Most bonks"
}
```

The shell turns places into points (for example 10/7/5/3/1, with ties sharing the higher score). It shows a ranking screen and the round's awards, and moves the rotation along. Every N rounds, add a "chaos round" with double points to keep the last places in contention.

---

## 5. Design lessons: what the team liked and disliked

- **Never take control away mid-play.** LPB's crash quiz, which made you answer an IAM question to respawn, felt bad and was removed. A **bonk** replaced it: a 0.75s stagger with invincibility and a red flash. You stay in the race and lose a moment. In-game penalties should be short and physical.
- **Use comeback mechanics, never elimination by snowball.** LPB's ⚡ coin warp is rubber-banded: it moves you 150px plus 0.6 × your gap to the leader, capped at 700px. You barely notice it at the front, and it's a real catch-up at the back. The user said it "feels better" than the alternatives.
- **Keep games forgiving.** LPB's tight pipes and fast ramp were "hardly playable". The race version uses gaps 20% wider, at least 1.25s between pipes, consecutive gaps within 190px of each other, lighter gravity and a terminal velocity. Start easy. A party game needs everyone to finish.
- **No visual gimmicks or joke sound effects.** In Retro Rumble the user removed the Upside Down, Scramble, Wobbly and Blurry rounds, and found silly sounds cringe.
- **What they do want:** team bonding and silly rounds with room for jokes and embarrassing yourself. Examples are draw rounds, hot takes, "who wrote this?", and humming or miming. Those social rounds are as important as the twitchy ones.
- **Moments matter:** finish announcements ("🏁 Kevin finished 1st 🥇"), a podium with times, awards like "🤕 Most bonks", and live standings for people who've finished.
- **Make yourself obvious:** LPB draws your own bird with a yellow outline and others as faded ghosts. Name tags pile up when the pack is bunched at the start. Show only yours plus a few, or fade them in.
- **The IAM/AWS satire is the house style:** bot names like Clippy, Kevin from Billing, NAT Gateway, us-east-1 and Intern #47. Ideas: an elimination round called "Least Privilege" where last place gets deprovisioned, and attacks on the leader like *MFA Challenge*, *Rate Limited* and *Permission Revoked*.

---

## 6. Testing

- **Headless browser in WSL:** Claude in Chrome is unsupported on WSL, so use Playwright from `~/personal/ldr-simulator/node_modules/playwright` with `executablePath` pointing at `~/.cache/ms-playwright/chromium_headless_shell-1248/...`.
  - Missing system libraries: `apt-get download` the debs (libnspr4, libnss3, libatk*, libXcomposite, libasound, libatspi), `dpkg -x` them into a scratch dir, and set `LD_LIBRARY_PATH=<dir>/usr/lib/x86_64-linux-gnu`.
  - Emoji: extract `fonts-noto-color-emoji` the same way and point `FONTCONFIG_FILE` at a fonts.conf that includes `/etc/fonts/fonts.conf` plus that directory.
  - The scratchpad is wiped between Claude sessions, so this has to be redone each time.
- **Multi-client tests:** open N browser contexts on the same `?room=CODE`, add bots, start, then assert that every client shows the same lobby count and the same winner. This caught most bugs in LPB, including on the live site through the deployed Worker.
- **Dev-only hooks:** expose `window.devState` / `devRoom` style hooks only on localhost, so tests can force states.
- **Determinism tests:** golden replays (LPB's `npm test`) for anything that must give identical results on every client.

---

## 7. Starting backlog (one issue per line)

**Shell**
- [ ] DO room: lobby, host, players + bots, `?room=` join, reconnect
- [ ] Round rotation + points table + between-round ranking screen
- [ ] Awards per round + end-of-night podium
- [ ] Spectator view for the host's screen share (who's leading, live)
- [ ] Phone check: tap controls, lobby fits the screen

**Minigames (30–60s each)**
- [ ] Bird Race: port `physics-core.ts` race mode, `RACE_OPTS`, coins/warps, bonks, bots
- [ ] Least Privilege: elimination race, last place deprovisioned every 10 pipes
- [ ] One Life: no bonks, last bird alive
- [ ] Dev vs Ops: team race on combined distance
- [ ] Quiz / hot take / who-wrote-it: port from Retro Rumble
- [ ] Draw round: port from Retro Rumble
- [ ] Approve or Deny: IAM policy snap-judgement against the clock

**Later**
- [ ] Leader-targeted attacks (MFA Challenge, Rate Limited, Permission Revoked)
- [ ] Slingshot start (Angry Birds nod: a timed release gives a launch boost)
- [ ] Photo-finish slow-mo replay when the top two are within 0.3s
- [ ] Hats/colours picked in the lobby
- [ ] Hall of fame across retros (Supabase or DO storage)

---

## 8. House rules for working in this repo with Claude

- Commit and push only as the configured git user (`snowu`). Don't add `Co-Authored-By: Claude` or "Generated with Claude Code" lines anywhere.
- Commit or push only when asked.
- Claude can't run `wrangler deploy` in auto mode. The user runs it with `!`.

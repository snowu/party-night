# Party Night

A Mario Party-style night of short minigames for team retros: one lobby, a running points table, awards between rounds and a podium at the end. It grew out of [Least Privilege Bird](https://github.com/snowu/least-privlege-bird) (the races) and [Retro Rumble](https://github.com/snowu/retro-rumble) (the social rounds).

## The night

No game repeats in a night. The four bird games count as one mode: each night has one bird round, never the first. Each round's places become points: 10/7/5/3/1, with ties sharing the higher score. Every 4th round and the last round are 🌪️ chaos rounds worth double.

| Bird rounds | |
|---|---|
| Bird Race | 30 seconds to the 🏁. Bonks stagger you and never stop you. 🎯 coins briefly slow or bonk whoever is leading. Top two within 0.3s get a photo finish. |
| Least Privilege | No finish line. Every 6s the last place gets deprovisioned. |
| One Life | No bonks: one hit and you're out. The course is gentler to make up for it. |
| Dev vs Ops | Two teams, 40 seconds, combined distance. |

| Social rounds | |
|---|---|
| Pop Quiz | Four questions, plus a closest-number question at the end. |
| Approve or Deny | Generated IAM policies. Explicit Deny wins, then Allow, otherwise implicit deny. |
| Hot Takes | Agree or disagree, then guess the share of the team that agrees. |
| Who Wrote It? | Everyone answers a prompt, then guesses who wrote each answer. |
| Most Likely To | Vote for a teammate. Agreeing with the room scores. |
| Draw It | One artist draws, everyone else guesses. |
| Draw Off | Everyone draws the same word for 30s, then votes on the anonymous gallery. Artists are revealed at the end. |
| Hum & Mime | An opted-in volunteer performs on the call while everyone else guesses. |

The host is the earliest-joined human still connected. They can add bots, pick the number of rounds and switch games on or off. Share rooms with `?room=CODE`. Open `?room=CODE&tv=1` for the spectator screen to share on the call: live standings, and a camera that follows the race leader.

## Run it locally

```bash
npm install
npm run server   # Worker + Durable Objects on :8799 (wrangler dev)
npm run dev      # the page on http://localhost:8004
```

On localhost the page connects to `ws://<host>:8799`. On `*.github.io` it connects to `wss://party-night.zancato-t.workers.dev`. Dev hooks `devApp()`, `devState()` and `devGame()` are on off github.io, and on the live site with `?dev=1` (which is how `test:e2e` drives it: `BASE=https://snowu.github.io/party-night npm run test:e2e`).

## Tests

- `npm test` runs in Node, with no browser and no Cloudflare. It covers:
  - golden replays of the race course, so every client flies the same course
  - the IAM evaluator
  - whole nights of every game through the room core on a fake clock
  - host handover
- `npm run test:e2e` plays a 4-round night in real browsers against the two dev servers above. It uses three contexts on one room (host, a phone-sized player, the spectator screen) plus bots, and checks every screen ends on the same table. Env vars:
  - `PW`: path to a playwright package
  - `CHROME`: the browser executable
  - `GAMES`: which rounds to play, e.g. `race,gallery,quiz,devops`
  - `SHOTS`: where screenshots go

## Deploy (two separate deploys)

- **Page:** `git push` to `main`. `.github/workflows/pages.yml` runs the tests and typecheck, builds, and cache-busts `bundle.js?v=<sha>`. In the repo, Settings → Pages → Source must be "GitHub Actions".
- **Server:** `cd server && npx wrangler deploy`. It does not deploy on push. Durable Objects on the free plan must be SQLite-backed (migration `v1`). If a class is renamed, add a new migration tag rather than editing `v1`.

## How it fits together

```
shared/            protocol, catalog, points, bird-variant numbers (client + server)
server/src/
  index.ts         Worker: /ws/<CODE> → Room DO, /api/hof → HallOfFame DO (SQLite)
  room.ts          RoomCore: lobby, host, rotation, points, awards. Pure, clock-injected
  games/           one module per round: create(ctx) → onMessage / onTick / view / result
src/
  main.ts          boot, landing, shell, mounting a round's client
  net.ts           socket, reconnect, server clock offset
  shell/           lobby, intro, results, podium, photo finish
  games/bird/      physics-core.ts (from LPB, unchanged), race-core.ts (pure), client.ts
  games/social/    staged rounds (views.ts), Draw It / Hum & Mime (guess.ts), Draw Off (gallery.ts)
```

- **The room (a Durable Object, one per code, in memory) is the authority** for the shell and for each round's result. Social rounds run entirely on the server. Their bots answer from the server too.
- **Bird rounds run in the browsers.** Each client flies the seeded course. The host's browser also flies the bots, on `setInterval` so they keep going in background tabs.
  - Positions go peer to peer over the room's relay: 50ms batches, a 400ms heartbeat, dead reckoning in between.
  - Each client reports distance and finish to the server twice a second, and the server decides who finished, who is out and when the round closes. There is no anti-cheat: it's a party game.

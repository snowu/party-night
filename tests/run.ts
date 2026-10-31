// `npm test`: runs in Node, no browser, no Cloudflare. Guards the race course's
// determinism (every client must fly the same course) and runs whole nights
// through the room core on a fake clock.
import { step, type GameState } from '../src/games/bird/physics-core.ts';
import { raceState, decide, newBrain, coinAt, courseLength, bonk } from '../src/games/bird/race-core.ts';
import { RoomCore, type Conn } from '../server/src/room.ts';
import { evaluate, makeCard, wildMatch } from '../server/src/games/approve.ts';
import { mulberry32, placesByScore } from '../shared/points.ts';
import { RACE } from '../shared/bird.ts';
import { CATALOG } from '../shared/catalog.ts';
import { simulate, rack, shoot, step as poolStep } from '../shared/pool.ts';
import { TrickShot } from '../server/src/games/pool.ts';
import { Hockey } from '../server/src/games/hockey.ts';
import { TypingRace } from '../server/src/games/typing.ts';
import { KanbanRush } from '../server/src/games/kanban.ts';
import { KANBAN } from '../shared/kanban.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed++;
}

// ── determinism ──────────────────────────────────────────────────────────────
function fly(seed: number, ticks: number): GameState {
  const s = raceState(seed);
  const brain = newBrain(0.8);
  const noise = mulberry32(seed ^ 0xabc);
  for (let t = 0; t < ticks; t++) if (step(s, decide(s, brain, noise)).dead) bonk(s);
  return s;
}
const POOL_GOLDEN = '0/749 0s/1200 0/789';
const GOLDEN: Array<[number, string]> = [
  [1, '15142.50|48|189.400|52'],
  [42, '15142.50|48|178.000|52'],
  [987654321, '15023.70|47|310.000|52'],
];
for (const [seed, want] of GOLDEN) {
  const s = fly(seed, 3600);
  const got = `${s.dist.toFixed(2)}|${s.score}|${s.player.y.toFixed(3)}|${s.pipesSpawned}`;
  check(`race replay seed ${seed}`, got === want, `got ${got}`);
}
check('same seed, same course', JSON.stringify(raceState(7).pipes) === JSON.stringify(raceState(7).pipes));
check('coins are seeded', [...Array(50).keys()].every(n => coinAt(9, n) === coinAt(9, n)));
check('course length is sane', Math.abs(courseLength(30) - 30 * 60 * 4.3) < 30 * 60 * 0.5, String(courseLength(30)));

// Trick Shot: the server scores a shot and every screen replays it, so the sim
// must give the same answer every time, stepped all at once or frame by frame.
{
  const ctx: any = { rng: mulberry32(11), players: [], connected: () => true, changed() {}, event() {} };
  const layouts = new TrickShot(ctx, 0).layouts;
  const shots = [{ x: 3.9, y: 0.02 }, { x: 2.1, y: -1.3 }, { x: -1.7, y: 2.2 }];
  const got = layouts.map((L, i) => { const r = simulate(L, shots[i]); return `${r.pots}${r.scratch ? 's' : ''}/${r.steps}`; }).join(' ');
  check('trick shot replay', got === POOL_GOLDEN, `got ${got}`);
  const t = rack(layouts[0]);
  shoot(t, shots[0]);
  for (let i = 0; i < 5000 && !t.done; i++) poolStep(t);
  const all = simulate(layouts[0], shots[0]);
  check('trick shot steps the same frame by frame', t.pots === all.pots && t.steps === all.steps && t.scratch === all.scratch);
  check('trick shot opens on the classic table', layouts[0].name === 'Break Room Classic' && new Set(layouts.map(L => L.name)).size === 3);
}

// Typing Race: bots finish and place ahead of a human who stopped; no pastes.
{
  let t = 0;
  const players = [{ id: 'h', name: 'h', bot: false, performer: false }, ...['a', 'b'].map(id => ({ id, name: id, bot: true, performer: false }))];
  const ctx: any = { rng: mulberry32(9), players, connected: () => true, changed() {}, event() {}, send() {}, toAll() {} };
  const g = new TypingRace(ctx, t);
  while (t < g.startAt + 100) { t += 100; g.onTick(t); }
  g.onMessage('h', { k: 'pos', n: g.text.length, e: 0 }, t);
  const h = g.racers.find(r => r.id === 'h')!;
  check('typing: a paste is capped at typing speed', h.n > 0 && h.n < 10 && h.ms === null, `n ${h.n}`);
  while (!g.result && t < 200_000) { t += 100; g.onTick(t); }
  const r = g.result!;
  check('typing: the race ends with everyone ranked', !!r && r.ranking.length === 3, r?.headline);
  check('typing: finishers beat a human who stopped', r.ranking.find(x => x.id === 'h')!.place === 3 && !!r.ranking[0].stat?.includes('wpm'), r.ranking.map(x => `${x.id}:${x.place}:${x.stat}`).join(' '));
}

// Kanban Rush: streaks score more, wrong costs, a ticket only lands once.
{
  let t = 0;
  const players = [{ id: 'h', name: 'h', bot: false, performer: false }, { id: 'a', name: 'a', bot: true, performer: false }];
  const ctx: any = { rng: mulberry32(11), players, connected: () => true, changed() {}, event() {}, send() {}, toAll() {} };
  const g = new KanbanRush(ctx, t);
  check('kanban: every ticket lands before the whistle', g.deck.length >= 15 && g.deck.every(d => d.at + d.fall < KANBAN.playMs), `${g.deck.length} tickets`);
  const [d0, d1, d2] = g.deck;
  while (t < g.startAt + d2.at) { t += 250; g.onTick(t); }
  g.onMessage('h', { k: 'sort', i: 0, col: d0.cat }, t);
  g.onMessage('h', { k: 'sort', i: 1, col: d1.cat }, t);
  g.onMessage('h', { k: 'sort', i: 1, col: d1.cat }, t);
  g.onMessage('h', { k: 'sort', i: 2, col: (d2.cat + 1) % 3 }, t);
  const s = g.scores.get('h')!;
  check('kanban: right, right (streak), repeat ignored, wrong', s.score === 100 + 110 - 50 && s.right === 2 && s.wrong === 1 && s.streak === 0, JSON.stringify(s));
  while (!g.result && t < 200_000) { t += 250; g.onTick(t); }
  check('kanban: the bot files tickets and the round ends', !!g.result && g.scores.get('a')!.right > 5 && g.result.ranking.length === 2, g.result?.headline);
}

// Air Hockey: a knockout. Five players means byes; nobody gets two.
{
  let t = 0;
  const players = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id, bot: true, performer: false }));
  const ctx: any = { rng: mulberry32(4), players, connected: () => true, changed() {}, event() {}, send() {}, toAll() {} };
  const g = new Hockey(ctx, t);
  const byes: string[] = [];
  let stage = -1;
  while (!g.result && t < 600_000) {
    t += 33; g.onTick(t);
    if (g.stage !== stage) { stage = g.stage; if (g.bye) byes.push(g.bye); }
  }
  check('hockey: a 5-player knockout finishes in 3 rounds', !!g.result && g.stages === 3 && stage === 2, `stages ${g.stages}, last ${stage}`);
  check('hockey: one champion, everyone ranked', g.result?.ranking.length === 5 && g.result.ranking.filter(r => r.place === 1).length === 1);
  check('hockey: nobody gets two byes', byes.length >= 2 && new Set(byes).size === byes.length, byes.join(','));
}

// Air Hockey hand-offs: a phone runs the puck in its half and passes it on; the
// server runs a bot's half, and takes over from a phone that goes quiet.
{
  let t = 0;
  const players = [{ id: 'h', name: 'H', bot: false, performer: false }, { id: 'b', name: 'B', bot: true, performer: false }];
  const ctx: any = { rng: mulberry32(2), players, connected: () => true, changed() {}, event() {}, send() {}, toAll() {} };
  const g = new Hockey(ctx, t);
  while (g.phase !== 'play') { t += 33; g.onTick(t); }
  const tb = g.tables[0], s = tb.sides.findIndex(x => x.id === 'h');
  // Put the puck in the human's half, then have the human send it across.
  tb.puck = { ...tb.puck, x: 0.5, y: s === 0 ? 1.3 : 0.7, vx: 0, vy: 0, at: t };
  tb.ownSince = t;
  g.onMessage('h', { k: 'p', x: 0.5, y: s === 0 ? 0.9 : 1.1, vx: 0, vy: s === 0 ? -1 : 1, at: t, n: tb.puck.n }, t);
  t += 33; g.onTick(t);
  const moved = s === 0 ? tb.puck.y < 0.9 : tb.puck.y > 1.1;
  check('hockey: a phone hands the puck over and the server runs the bot half', moved, `y ${tb.puck.y}`);
  // A stranger can't move a puck that isn't in their half.
  const before = tb.puck.y;
  g.onMessage('h', { k: 'p', x: 0.5, y: 0.3, vx: 0, vy: 0, at: t, n: tb.puck.n }, t);
  check('hockey: only the half with the puck can move it', tb.puck.y === before);
  // A quiet phone: puck parked in its half, moving; the server keeps it going.
  tb.puck = { ...tb.puck, x: 0.5, y: s === 0 ? 1.5 : 0.5, vx: 0.8, vy: 0, at: t };
  tb.ownSince = t;
  for (let i = 0; i < 30; i++) { t += 33; g.onTick(t); }
  check('hockey: the server takes over from a quiet phone', tb.winner >= 0 || Math.abs(tb.puck.x - 0.5) > 0.05, `x ${tb.puck.x}`);
}

// ── shared helpers ───────────────────────────────────────────────────────────
check('ties share a place', JSON.stringify(placesByScore([5, 9, 9, 1], x => x).map(x => x.place)) === '[1,1,3,4]');

// ── IAM evaluation ───────────────────────────────────────────────────────────
check('wildcards match', wildMatch('s3:Get*', 's3:GetObject') && wildMatch('*', 'iam:PassRole') && !wildMatch('s3:Put*', 's3:GetObject'));
check('explicit deny wins', !evaluate([{ Effect: 'Allow', Action: '*', Resource: '*' }, { Effect: 'Deny', Action: 's3:*', Resource: '*' }], 's3:GetObject', 'arn:x').allow);
check('implicit deny', !evaluate([{ Effect: 'Allow', Action: 'ec2:*', Resource: '*' }], 's3:GetObject', 'arn:x').allow);
check('allow matches', evaluate([{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' }], 's3:GetObject', 'arn:aws:s3:::b/*').allow);
const rng = mulberry32(5);
const cards = Array.from({ length: 200 }, () => makeCard(rng));
const allowShare = cards.filter(c => c.allow).length / cards.length;
check('approve cards are balanced', allowShare > 0.25 && allowShare < 0.75, String(allowShare));

// ── a whole night ────────────────────────────────────────────────────────────
interface Client { conn: Conn; inbox: any[]; state: any }
function client(): Client {
  const c: Client = { inbox: [], state: null, conn: null as any };
  c.conn = { pid: null, send: d => { const m = JSON.parse(d); c.inbox.push(m); if (m.t === 'state') c.state = m; } };
  return c;
}

function runNight(games: string[], rounds: number, seed: number) {
  let t = 1_000_000;
  const r = mulberry32(seed);
  let hof: any = null;
  const room = new RoomCore('TEST', () => t, { onPodium: rec => { hof = rec; } }, r);
  const alice = client(), bob = client(), tv = client();
  room.join(alice.conn, { pid: 'alice', name: 'Alice' });
  room.join(bob.conn, { pid: 'bob', name: 'Bob' });
  room.join(tv.conn, { tv: true });
  room.message(bob.conn, JSON.stringify({ t: 'set', performer: true }));
  const send = (c: Client, m: unknown) => room.message(c.conn, JSON.stringify(m));
  for (let i = 0; i < 4; i++) send(alice, { t: 'host', op: 'bot+' });
  send(alice, { t: 'host', op: 'settings', rounds, games });
  send(alice, { t: 'host', op: 'start' });

  const dist = new Map<string, number>();
  let lastRep = 0;
  while (room.phase !== 'podium' && t < 1_000_000 + 3_600_000) {
    t += 250;
    room.tick();
    const s = alice.state;
    if (s.phase !== 'play' || !s.gv) continue;
    const gv = s.gv;
    if (s.game.kind === 'bird' && t - lastRep >= 500 && t >= gv.startAt) {
      // Alice is the host, so she reports for herself and the bots; Bob for himself.
      lastRep = t;
      const finish = courseLength(RACE.courseSec);
      for (const b of gv.birds) {
        if (b.st === 'fin' || b.st === 'out') continue;
        const d = (dist.get(b.id) ?? 0) + 120 + r() * 140;
        dist.set(b.id, d);
        const st = d >= finish ? 'fin' : 'fly';
        send(b.id === 'bob' ? bob : alice, { t: 'g', k: 'rep', id: b.id, d, st, fm: t - gv.startAt, bk: Math.floor(r() * 3) });
      }
    } else if (s.game.kind === 'social') {
      dist.clear();
      // Bob answers whatever the stage asks; Alice idles (timers must still close rounds).
      const v = bob.state.gv;
      if (v && v.step === 'q' && v.mine === null && !v.bench?.includes('bob')) {
        const id = s.game.id;
        const ans = id === 'quiz' ? (v.q.closest ? 1000 : 0) : id === 'approve' ? true : id === 'hottake' ? { agree: true, pct: 50 }
          : id === 'who' ? (v.stage === 0 ? 'I once deleted prod' : 'alice') : id === 'mostlikely' ? 'alice'
          : id === 'rootcause' ? (v.phase === 'write' ? 'a hamster' : v.options.findIndex((o: any) => !o.mine))
          : id === 'hivemind' ? 'coffee' : id === 'planning' ? 100
          : id === 'review' ? (v.stage === 0 ? { s: ['shipped it', 'fixed it', 'documented it'], lie: 2 } : 0)
          : id === 'codereview' ? (v.stage === 0 ? (v.prompt ? 'synergy' : null) : 0)
          : id === 'incident' ? (t >= v.fireAt ? 300 : null)
          : id === 'pool' ? { x: 3.5, y: 0.1 * v.stage } : null;
        if (ans !== null) send(bob, { t: 'g', k: 'ans', i: v.stage, v: ans });
      }
      if (s.game.id === 'typing' && v?.phase === 'race') send(bob, { t: 'g', k: 'pos', n: (v.lanes.find((l: any) => l.id === 'bob')?.n ?? 0) + 4, e: 0 });
      if (s.game.id === 'kanban' && v?.phase === 'play') v.deck.forEach((d: any, i: number) => { if (t >= v.startAt + d.at + 1000 && !(i in v.mine)) send(bob, { t: 'g', k: 'sort', i, col: d.cat }); });
      if (s.game.id === 'oncall' && v?.phase === 'live' && v.holder === 'bob') send(bob, { t: 'g', k: 'pass', to: 'alice' });
      if (s.game.id === 'hockey') send(bob, { t: 'g', k: 'm', x: r(), y: r() * 2 });
      if ((s.game.id === 'draw' || s.game.id === 'perform') && v?.artist !== 'bob' && r() < 0.05) send(bob, { t: 'g', k: 'guess', text: 'banana' });
      if (s.game.id === 'gallery' && v?.step === 'draw') for (const c of [alice, bob]) send(c, { t: 'g', k: 'ink', id: `s${Math.floor(r() * 1e6)}`, c: '#111111', w: 10, pts: [r() * 1000, r() * 1000, 500, 500] });
      if (s.game.id === 'gallery' && v?.step === 'vote' && v.myVote === null) send(bob, { t: 'g', k: 'vote', slot: v.mySlot === 0 ? 1 : 0 });
    }
  }
  return { room, alice, bob, tv, hof, t };
}

for (const [label, games, rounds] of [
  ['bird night', ['race'], 4],
  ['social night', ['quiz', 'approve', 'hottake', 'who', 'mostlikely', 'draw', 'perform', 'gallery'], 8],
  ['satire night', ['rootcause', 'hivemind', 'review', 'codereview', 'incident', 'oncall', 'planning'], 8],
  ['perks night', ['hockey', 'pool', 'typing', 'kanban'], 6],
  ['mixed night', CATALOG.map(g => g.id), 12],
] as const) {
  const { room, alice, tv, hof } = runNight([...games], rounds, rounds * 31);
  check(`${label}: reaches the podium`, room.phase === 'podium', room.phase);
  check(`${label}: plays every round`, room.history.length === rounds, `${room.history.length}`);
  const played = room.history.map(o => o.game);
  const kind = (g: string) => CATALOG.find(c => c.id === g)!.kind;
  const socials = played.filter(g => kind(g) === 'social');
  const distinct = Math.min(socials.length, games.filter(g => kind(g) === 'social').length);
  check(`${label}: no game repeats until its kind runs out, never back to back`,
    new Set(socials.slice(0, distinct)).size === distinct && (games.length < 2 || played.every((g, i) => g !== played[i - 1])), played.join(','));
  if (label === 'mixed night') {
    const birds = played.filter(g => kind(g) === 'bird').length;
    check(`${label}: at most one bird round, not the opener`, birds <= 1 && kind(played[0]) !== 'bird', played.join(','));
  }
  const sums = new Map<string, number>();
  for (const o of room.history) for (const x of o.ranking) sums.set(x.id, (sums.get(x.id) ?? 0) + x.gained);
  check(`${label}: points add up`, [...room.players.values()].every(p => p.points === (sums.get(p.id) ?? 0)));
  check(`${label}: every round ranks all 6`, room.history.every(o => o.ranking.length === 6), room.history.map(o => o.ranking.length).join(','));
  check(`${label}: spectator sees the same table`, JSON.stringify(tv.state.players) === JSON.stringify(alice.state.players));
  if (games.includes('gallery' as never) && room.history.some(o => o.game === 'gallery')) {
    const g = tv.inbox.find(m => m.t === 'gallery');
    const voting = tv.inbox.find(m => m.t === 'state' && m.game?.id === 'gallery' && m.gv?.step === 'vote');
    const o = room.history.find(o => o.game === 'gallery')!;
    check(`${label}: draw off shows an anonymous gallery`, !!g && g.drawings.length === 2 && JSON.stringify(g).indexOf('alice') < 0 && voting?.gv.artists === null);
    check(`${label}: draw off scores the votes`, o.ranking.some(x => x.stat?.includes('vote')), o.headline);
  }
  check(`${label}: two humans stay out of the hall of fame`, hof === null);
}

// A real retro (3+ humans) makes the hall of fame, bots excluded from the podium.
{
  let t = 0, hof: any = null;
  const room = new RoomCore('HOFS', () => t, { onPodium: rec => { hof = rec; } }, mulberry32(3));
  const cs = ['a', 'b', 'c'].map(id => { const c = client(); room.join(c.conn, { pid: id, name: id.toUpperCase() }); return c; });
  room.message(cs[0].conn, JSON.stringify({ t: 'host', op: 'bot+' }));
  room.message(cs[0].conn, JSON.stringify({ t: 'host', op: 'settings', rounds: 4, games: ['quiz'] }));
  room.message(cs[0].conn, JSON.stringify({ t: 'host', op: 'start' }));
  while (room.phase !== 'podium' && t < 3_600_000) { t += 250; room.tick(); }
  check('3 humans make the hall of fame, bots excluded', !!hof && hof.podium.length === 3 && hof.podium.every((p: any) => p.name.length === 1));
}

// ▶ Try: one human alone gets bots and goes straight into that game.
{
  let t = 0;
  const room = new RoomCore('TRYS', () => t, {}, mulberry32(8));
  const a = client();
  room.join(a.conn, { pid: 'a', name: 'A' });
  room.message(a.conn, JSON.stringify({ t: 'host', op: 'try', game: 'hockey' }));
  check('try: straight into the game with bots', room.phase === 'play' && room.gameId === 'hockey' && room.participants.length >= 4);
  while (room.history.length < 2 && t < 600_000) { t += 250; room.tick(); if (room.phase === 'results') room.message(a.conn, JSON.stringify({ t: 'host', op: 'next' })); }
  check('try: keeps playing that one game', room.history.length === 2 && room.history.every(o => o.game === 'hockey'), room.history.map(o => o.game).join(','));
}

// Host handover: when the host leaves, the next human takes over.
{
  const room = new RoomCore('HOST', () => 0);
  const a = client(), b = client();
  room.join(a.conn, { pid: 'a', name: 'A' });
  room.join(b.conn, { pid: 'b', name: 'B' });
  const before = room.hostId();
  room.leave(a.conn);
  check('host hands over', before === 'a' && room.hostId() === 'b');
  room.join(a.conn, { pid: 'a', name: 'A' });
  check('earliest human gets host back on reconnect', room.hostId() === 'a');
}

if (failed) { console.log(`\n${failed} failed`); (globalThis as any).process.exit(1); }
console.log('\nall passed');

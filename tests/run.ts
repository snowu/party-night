// `npm test`: runs in Node, no browser, no Cloudflare. Guards the race course's
// determinism (every client must fly the same course) and runs whole nights
// through the room core on a fake clock.
import { step, type GameState } from '../src/games/bird/physics-core.ts';
import { raceState, decide, newBrain, coinAt, courseLength, bonk } from '../src/games/bird/race-core.ts';
import { RoomCore, type Conn } from '../server/src/room.ts';
import { evaluate, makeCard, wildMatch } from '../server/src/games/approve.ts';
import { mulberry32, placesByScore } from '../shared/points.ts';
import { BIRD } from '../shared/bird.ts';
import { CATALOG } from '../shared/catalog.ts';

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
check('coins are seeded', [...Array(50).keys()].every(n => coinAt(9, n, true, true) === coinAt(9, n, true, true)));
check('course length is sane', Math.abs(courseLength(30) - 30 * 60 * 4.3) < 30 * 60 * 0.5, String(courseLength(30)));

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
      const v = BIRD[gv.variant];
      const finish = v.courseSec ? courseLength(v.courseSec) : Infinity;
      for (const b of gv.birds) {
        if (b.st === 'fin' || b.st === 'out') continue;
        const d = (dist.get(b.id) ?? 0) + 120 + r() * 140;
        dist.set(b.id, d);
        const crashed = !v.bonks && r() < 0.02;
        const st = d >= finish ? 'fin' : crashed ? 'out' : 'fly';
        send(b.id === 'bob' ? bob : alice, { t: 'g', k: 'rep', id: b.id, d, st, fm: t - gv.startAt, bk: Math.floor(r() * 3) });
      }
    } else if (s.game.kind === 'social') {
      dist.clear();
      // Bob answers whatever the stage asks; Alice idles (timers must still close rounds).
      const v = bob.state.gv;
      if (v && v.step === 'q' && v.mine === null && !v.bench?.includes('bob')) {
        const id = s.game.id;
        const ans = id === 'quiz' ? (v.q.closest ? 1000 : 0) : id === 'approve' ? true : id === 'hottake' ? { agree: true, pct: 50 }
          : id === 'who' ? (v.stage === 0 ? 'I once deleted prod' : 'alice') : id === 'mostlikely' ? 'alice' : null;
        if (ans !== null) send(bob, { t: 'g', k: 'ans', i: v.stage, v: ans });
      }
      if ((s.game.id === 'draw' || s.game.id === 'perform') && v?.artist !== 'bob' && r() < 0.05) send(bob, { t: 'g', k: 'guess', text: 'banana' });
      if (s.game.id === 'gallery' && v?.step === 'draw') for (const c of [alice, bob]) send(c, { t: 'g', k: 'ink', id: `s${Math.floor(r() * 1e6)}`, c: '#111111', w: 10, pts: [r() * 1000, r() * 1000, 500, 500] });
      if (s.game.id === 'gallery' && v?.step === 'vote' && v.myVote === null) send(bob, { t: 'g', k: 'vote', slot: v.mySlot === 0 ? 1 : 0 });
    }
  }
  return { room, alice, bob, tv, hof, t };
}

for (const [label, games, rounds] of [
  ['bird night', ['race', 'leastpriv', 'onelife', 'devops'], 4],
  ['social night', ['quiz', 'approve', 'hottake', 'who', 'mostlikely', 'draw', 'perform', 'gallery'], 8],
  ['mixed night', CATALOG.map(g => g.id), 12],
] as const) {
  const { room, alice, tv, hof } = runNight([...games], rounds, rounds * 31);
  check(`${label}: reaches the podium`, room.phase === 'podium', room.phase);
  check(`${label}: plays every round`, room.history.length === rounds, `${room.history.length}`);
  const played = room.history.map(o => o.game);
  check(`${label}: alternates lanes`, label !== 'mixed night' || played.every((g, i) => i === 0 || CATALOG.find(c => c.id === g)!.kind !== CATALOG.find(c => c.id === played[i - 1])!.kind), played.join(','));
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

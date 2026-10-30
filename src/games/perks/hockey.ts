// Air Hockey (client). A knockout of 1v1 duels (server/src/games/hockey.ts). On my
// own table my mallet follows my pointer, and while the puck is in my half my
// phone runs it (shared/hockey.ts), so my hits are instant; it hands the puck on
// when it crosses the centre line. Everything else comes in snapshots ({t:'hk'})
// and is dead-reckoned. Out, on a bye, or on the TV: a grid of every table; tap
// one to watch it big.
//
// The puck runs on setInterval, not requestAnimationFrame, so it keeps going
// (briefly) in a background tab; the server takes over if the phone goes quiet.
import { HOCKEY, clampMallet, homeOf, moveMallet, sideOf, stepPuck, type HockeyFrame, type HockeyView, type Mallet, type Puck } from '../../../shared/hockey.ts';
import { chip, countdown, esc, timer, tickTimers, type App, type GameClient } from '../../app.ts';

const RIM = 0.06;                // drawn rail, table units
const MY_SPEED = 12;             // my mallet chases the pointer this fast (units/s)
const KEY_SPEED = 1.8;
const SIM_MS = 8;
const DELAY_MS = 80;             // what I don't run myself is drawn this far in the past, smoothly
const SETTLE_S = 0.07;           // a correction to the puck I'm predicting fades in over this long
// Goals: the last half second before the puck went in, replayed at a third of the speed.
const REPLAY_MS = 1600, SLOW = 3, REPLAY_SPAN_MS = 500;

type P = Puck & { at: number; n: number };
const rowOf = (r: number[]) => ({ m: [{ x: r[0], y: r[1] }, { x: r[2], y: r[3] }], p: { x: r[4], y: r[5], vx: r[6], vy: r[7], at: r[8], n: r[9] } as P });

// Where a puck is now, from a state a moment old: walls but no mallets.
function ahead(p: P, now: number): Puck {
  const q = { ...p };
  const steps = Math.min(18, Math.max(0, Math.floor((now - p.at) / (HOCKEY.dt * 1000))));
  for (let i = 0; i < steps; i++) if (stepPuck(q, []) >= 0) break;
  return q;
}

function fit(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr);
  if (w && cv.width !== w) { cv.width = w; cv.height = Math.round((w * (HOCKEY.L + 2 * RIM)) / (HOCKEY.W + 2 * RIM)); }
  return cv.width / (HOCKEY.W + 2 * RIM);
}

// Draw a table. flip turns it round, so side 1 sees its own goal at the bottom.
function drawTable(cv: HTMLCanvasElement, mallets: Array<{ x: number; y: number }>, puck: Puck | null, colors: string[], flip: boolean, me = -1) {
  const g = cv.getContext('2d')!, S = fit(cv);
  const X = (x: number) => ((flip ? HOCKEY.W - x : x) + RIM) * S, Y = (y: number) => ((flip ? HOCKEY.L - y : y) + RIM) * S;
  const W = HOCKEY.W * S, L = HOCKEY.L * S;
  g.fillStyle = '#5d6375'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#eef5fb'; g.fillRect(RIM * S, RIM * S, W, L);
  g.save();
  g.beginPath(); g.rect(RIM * S, RIM * S, W, L); g.clip();
  g.strokeStyle = '#e5395b'; g.lineWidth = Math.max(2, S * 0.008);
  g.beginPath(); g.moveTo(RIM * S, Y(HOCKEY.L / 2)); g.lineTo(RIM * S + W, Y(HOCKEY.L / 2)); g.stroke();
  g.beginPath(); g.arc(X(HOCKEY.W / 2), Y(HOCKEY.L / 2), 0.15 * S, 0, Math.PI * 2); g.stroke();
  // Goal creases, each in its owner's colour, then the goal mouths cut into the rail.
  for (const s of [0, 1]) {
    g.strokeStyle = colors[s]; g.lineWidth = Math.max(2, S * 0.008);
    g.beginPath(); g.arc(X(HOCKEY.W / 2), Y(s === 0 ? HOCKEY.L : 0), 0.22 * S, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
  for (const s of [0, 1]) {
    const yl = Y(s === 0 ? HOCKEY.L : 0), top = yl < cv.height / 2;
    g.fillStyle = '#10131f';
    g.fillRect(X(HOCKEY.W / 2) - (HOCKEY.goalW / 2) * S, top ? yl - RIM * S : yl, HOCKEY.goalW * S, RIM * S);
  }
  mallets.forEach((m, s) => {
    const r = HOCKEY.malletR * S;
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8;
    g.beginPath(); g.arc(X(m.x), Y(m.y), r, 0, Math.PI * 2); g.fillStyle = colors[s]; g.fill();
    g.shadowBlur = 0;
    g.beginPath(); g.arc(X(m.x), Y(m.y), r * 0.55, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.2)'; g.fill();
    g.beginPath(); g.arc(X(m.x), Y(m.y), r * 0.4, 0, Math.PI * 2); g.fillStyle = colors[s]; g.fill();
    if (s === me) { g.beginPath(); g.arc(X(m.x), Y(m.y), r + 3, 0, Math.PI * 2); g.strokeStyle = '#10131f'; g.lineWidth = 2; g.stroke(); }
  });
  if (puck) {
    g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 6;
    g.beginPath(); g.arc(X(puck.x), Y(puck.y), HOCKEY.puckR * S, 0, Math.PI * 2); g.fillStyle = '#1b1f2e'; g.fill();
    g.shadowBlur = 0;
  }
}

export const hockeyGame = (): GameClient => {
  let root: HTMLElement, app: App, big: HTMLCanvasElement;
  let raf = 0, sim = 0, lastSim = 0, lastSentM = 0, lastSentP = 0, sentM = '';
  const frames: number[][] = [];
  const buf: HockeyFrame[] = [];   // recent snapshots, for drawing in the past
  // My table.
  let puck: P | null = null, owner = false, simAt = 0, myLastAt = 0;
  let mine: Mallet | null = null, target: [number, number] | null = null;
  const opp: Mallet = { x: 0, y: 0, vx: 0, vy: 0 };
  let oppAt = 0;
  let off = { x: 0, y: 0 }, lastDraw = 0;
  // The big table's recent puck path, and the goal replay playing from it.
  let trail: Array<{ t: number; x: number; y: number }> = [], trailOf = '';
  let replay: { key: string; start: number; trail: typeof trail; color: string; name: string } | null = null;
  let myGoalN = -1;              // a goal my phone saw first (I had the puck), before the server says so
  const keys = new Set<string>();
  // Watching.
  let focus = -1, gridKey = '';
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as HockeyView | null;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };
  const color = (id: string) => app.player(id)?.color ?? '#888';
  // A table's two colours, never the same twice: the top player gets a contrast if they clash.
  const pair = (ids: string[]) => { const c = ids.map(color); return c[0] === c[1] ? [c[0], c[0] === '#2de2e6' ? '#ff3d9a' : '#2de2e6'] : c; };
  const live = () => { const v = gv(); return !!v && v.phase === 'play' && !!v.me && app.now() >= v.startAt; };

  // ── my table: mallet, puck, hand-offs ──
  // Where I think my table's puck is right now: exact while I run it, else
  // predicted from the last state.
  const predicted = (now: number): Puck | null => (puck ? (owner ? puck : ahead(puck, now)) : null);

  function onFrame(f: HockeyFrame) {
    frames.length = 0; frames.push(...f.T);
    buf.push(f);
    if (buf.length > 15) buf.shift();
    const v = gv();
    if (!v?.me || !f.T[v.me.t]) return;
    const { m, p } = rowOf(f.T[v.me.t]), s = v.me.s, now = app.now();
    const o = m[1 - s];
    moveMallet(opp, o.x, o.y, oppAt ? (f.at - oppAt) / 1000 : 0, 0.5);
    oppAt = f.at;
    const was = predicted(now);
    if (!puck || p.n !== puck.n) {
      // Puck down (start, or after a goal): jump straight there.
      puck = { ...p }; owner = sideOf(p.y) === s; simAt = Math.max(p.at, now - 200); myLastAt = 0;
      off = { x: 0, y: 0 };
      return;
    }
    if (!owner && p.at >= myLastAt) {
      puck = { ...p };
      if (sideOf(p.y) === s) { owner = true; simAt = Math.max(p.at, now - 200); }
      // Don't snap to the correction: keep drawing where it was and let the gap fade.
      const is = predicted(now);
      if (was && is) off = { x: off.x + was.x - is.x, y: off.y + was.y - is.y };
    }
  }

  // Snapshots around time `at`, blended: a table I'm only watching.
  function interp(i: number, at: number): number[] | null {
    let a: HockeyFrame | null = null, b: HockeyFrame | null = null;
    for (const f of buf) { if (!f.T[i]) continue; if (f.at <= at) a = f; else if (!b) b = f; }
    if (!a || !b) return (a ?? b)?.T[i] ?? null;
    const ra = a.T[i], rb = b.T[i], k = (at - a.at) / (b.at - a.at || 1);
    if (ra[9] !== rb[9]) return rb;   // a goal in between: no blending across it
    return rb.map((x, j) => (j < 8 ? ra[j] + (x - ra[j]) * k : x));
  }

  function sendPuck(now: number) {
    if (!puck) return;
    lastSentP = now; myLastAt = Math.round(simAt);
    app.net.game({ k: 'p', x: +puck.x.toFixed(4), y: +puck.y.toFixed(4), vx: +puck.vx.toFixed(4), vy: +puck.vy.toFixed(4), at: myLastAt, n: puck.n });
  }

  function tick() {
    const v = gv(), now = app.now();
    const dt = Math.min(0.1, (now - (lastSim || now)) / 1000);
    lastSim = now;
    if (!v?.me || v.phase === 'break') return;
    const s = v.me.s;
    if (!mine) { const [x, y] = homeOf(s); mine = { x, y, vx: 0, vy: 0 }; target = [x, y]; }
    if (keys.size) {
      let kx = 0, ky = 0;
      for (const k of keys) { kx += ARROWS[k][0]; ky += ARROWS[k][1]; }
      if (s === 1) { kx = -kx; ky = -ky; }
      target = clampMallet(s, target![0] + kx * KEY_SPEED * dt, target![1] + ky * KEY_SPEED * dt);
    }
    const dx = target![0] - mine.x, dy = target![1] - mine.y, d = Math.sqrt(dx * dx + dy * dy), step = Math.min(d, MY_SPEED * dt);
    moveMallet(mine, mine.x + (d ? (dx / d) * step : 0), mine.y + (d ? (dy / d) * step : 0), dt);
    const key = `${mine.x.toFixed(3)},${mine.y.toFixed(3)}`;
    if (now - lastSentM >= HOCKEY.sendMs && key !== sentM) {
      lastSentM = now; sentM = key;
      app.net.game({ k: 'm', x: +mine.x.toFixed(3), y: +mine.y.toFixed(3) });
    }
    if (!live()) { simAt = now; return; }   // nothing moves before the puck drops
    if (!owner || !puck) return;
    const mallets = s === 0 ? [mine, opp] : [opp, mine];
    while (simAt + HOCKEY.dt * 1000 <= now) {
      simAt += HOCKEY.dt * 1000;
      const g = stepPuck(puck, mallets);
      if (g === s) { owner = false; myGoalN = puck.n; app.net.game({ k: 'goal', n: puck.n }); return; }
      if (sideOf(puck.y) !== s) { owner = false; sendPuck(now); return; }
    }
    if (now - lastSentP >= HOCKEY.sendMs) sendPuck(now);
  }

  // Pointer → table units, undoing the turn for side 1.
  function onPointer(e: PointerEvent) {
    const v = gv();
    if (!v?.me || !live() && v.phase !== 'count') return;
    const r = big.getBoundingClientRect(), u = r.width / (HOCKEY.W + 2 * RIM);
    let x = (e.clientX - r.left) / u - RIM, y = (e.clientY - r.top) / u - RIM;
    if (v.me.s === 1) { x = HOCKEY.W - x; y = HOCKEY.L - y; }
    target = clampMallet(v.me.s, x, y);
  }
  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
  const onKey = (e: KeyboardEvent) => {
    if (!ARROWS[e.code] || !gv()?.me) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code);
  };
  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-table]');
    if (!el) return;
    focus = Number(el.dataset.table);
    client.update(app);
  };

  // ── drawing ──
  // The puck to draw on the big table: live, or the goal replay while one plays.
  function bigPuck(table: number, n: number, conceded: number, live: Puck | null, ids: string[]): Puck | null {
    const t = performance.now(), key = `${gv()!.stage}:${table}`;
    if (trailOf !== key) { trailOf = key; trail = []; }
    if (conceded >= 0 && replay?.key !== `${key}:${n}`) {
      const scorer = ids[1 - conceded];
      replay = { key: `${key}:${n}`, start: t, trail: [...trail], color: pair(ids)[1 - conceded], name: app.player(scorer)?.name ?? '' };
    }
    if (replay && replay.key === `${key}:${n}` && t - replay.start < REPLAY_MS) {
      const tr = replay.trail;
      if (!tr.length) return null;
      const end = tr[tr.length - 1].t, at = Math.min(end, Math.max(tr[0].t, end - REPLAY_SPAN_MS) + (t - replay.start) / SLOW);
      const j = Math.max(1, tr.findIndex(q => q.t >= at));
      const a = tr[j - 1], b = tr[Math.min(j, tr.length - 1)], k = b.t > a.t ? (at - a.t) / (b.t - a.t) : 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, vx: 0, vy: 0 };
    }
    if (conceded >= 0) return null;   // in the net, waiting for the puck drop
    if (live) {
      trail.push({ t, x: live.x, y: live.y });
      while (trail.length && t - trail[0].t > 900) trail.shift();
    }
    return live;
  }

  // Flash, shake and GOAL! over the big table while a replay plays.
  function goalFx() {
    const e = replay ? performance.now() - replay.start : Infinity;
    big.style.transform = e < 350 ? `translate(${(Math.random() - 0.5) * 14 * (1 - e / 350)}px, ${(Math.random() - 0.5) * 14 * (1 - e / 350)}px)` : '';
    if (!replay || e >= REPLAY_MS) return;
    const g = big.getContext('2d')!, W = big.width, H = big.height;
    g.save();
    g.fillStyle = 'rgba(16, 19, 31, 0.18)'; g.fillRect(0, 0, W, H);   // slow-mo tint
    if (e < 350) { g.globalAlpha = 0.5 * (1 - e / 350); g.fillStyle = replay.color; g.fillRect(0, 0, W, H); }
    g.globalAlpha = e > REPLAY_MS - 300 ? (REPLAY_MS - e) / 300 : 1;
    const pop = 1 + 0.7 * Math.max(0, 1 - e / 220);
    g.translate(W / 2, H * 0.42); g.scale(pop, pop); g.rotate(-0.08);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${Math.round(W * 0.2)}px Bungee, sans-serif`;
    g.lineWidth = W * 0.02; g.strokeStyle = '#10131f'; g.strokeText('GOAL!', 0, 0);
    g.fillStyle = replay.color; g.fillText('GOAL!', 0, 0);
    g.font = `700 ${Math.round(W * 0.06)}px Inter, sans-serif`;
    g.lineWidth = W * 0.012; g.strokeText(replay.name, 0, W * 0.15);
    g.fillStyle = '#fff'; g.fillText(replay.name, 0, W * 0.15);
    g.restore();
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const v = gv();
    if (!v) return;
    const now = app.now(), t = performance.now();
    const fade = Math.exp(-Math.min(0.1, (t - (lastDraw || t)) / 1000) / SETTLE_S);
    lastDraw = t;
    off = { x: off.x * fade, y: off.y * fade };
    if (v.me && frames[v.me.t]) {
      const tb = v.tables[v.me.t], s = v.me.s;
      const late = interp(v.me.t, now - DELAY_MS);
      const them = late ? rowOf(late).m[1 - s] : opp;
      const ms = [0, 1].map(i => (i === s && mine ? mine : them));
      const p = predicted(now), raw = frames[v.me.t];
      const conceded = raw[10] >= 0 ? raw[10] : myGoalN === puck?.n ? s : -1;
      const shown = bigPuck(v.me.t, puck?.n ?? 0, conceded, p && { ...p, x: p.x + off.x, y: p.y + off.y }, tb.ids);
      drawTable(big, ms, shown, pair(tb.ids), s === 1, s);
      goalFx();
    } else if (!big.hidden) {
      const i = v.tables.length === 1 ? 0 : focus, row = interp(i, now - DELAY_MS);
      if (!row) return;
      const { m, p } = rowOf(row);
      drawTable(big, m, bigPuck(i, row[9], row[10], v.tables[i].winner >= 0 && row[10] < 0 ? null : p, v.tables[i].ids), pair(v.tables[i].ids), false);
      goalFx();
    }
    root.querySelectorAll<HTMLCanvasElement>('.hk-card canvas').forEach(cv => {
      const i = Number(cv.dataset.i), row = interp(i, now - DELAY_MS);
      if (!row) return;
      const { m, p } = rowOf(row);
      drawTable(cv, m, v.tables[i]?.winner >= 0 || row[10] >= 0 ? null : p, pair(v.tables[i].ids), false);
    });
  }

  const score = (t: HockeyView['tables'][number], a: number) => `${chip(app.player(t.ids[a]))}<b class="hk-score">${t.score[a]}</b>`;

  const client: GameClient = {
    mount(r, a) {
      root = r; app = a;
      root.className = 'hockey';
      root.innerHTML = `<div class="hk-head"></div><div class="hk-board"></div><canvas class="hk-big"></canvas><div class="hk-grid"></div><div class="hk-foot"></div>`;
      big = root.querySelector('.hk-big')!;
      big.addEventListener('pointermove', onPointer);
      big.addEventListener('pointerdown', onPointer);
      root.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      raf = requestAnimationFrame(draw);
      sim = window.setInterval(tick, SIM_MS);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      const now = app.now();
      // A new bracket round: fresh table, fresh grid.
      const key = `${v.stage}`;
      if (key !== gridKey) { gridKey = key; focus = -1; puck = null; owner = false; mine = null; oppAt = 0; frames.length = 0; buf.length = 0; off = { x: 0, y: 0 }; }
      const clock = v.phase === 'count' ? `<span class="hk-count">Puck drop in ${countdown(v.startAt)}</span>`
        : v.phase === 'break' ? `<span class="muted">Next round in ${countdown(v.nextAt)}</span>`
        : now < v.endAt ? timer(v.endAt, HOCKEY.matchMs) : '<span class="hk-ot">⚡ Golden goal</span>';
      const where = v.label.startsWith('Round') ? `Round ${v.stage + 1} of ${v.stages}` : v.label;
      set('.hk-head', `<div class="stagehead"><span class="muted">🏒 ${esc(where)}</span>${clock}</div>`);
      const mt = v.me ? v.tables[v.me.t] : null;
      // With one table left (the final), everyone watching gets it big.
      const only = v.tables.length === 1 && !mt;
      const shown = only ? 0 : focus;
      const watching = !mt && shown >= 0 && v.tables[shown];
      big.hidden = !mt && !watching;
      // My scoreboard (opponent first: they're at the top of my table).
      set('.hk-board', mt ? `<div class="hk-vs">${score(mt, 1 - v.me!.s)}<span class="muted">vs</span>${score(mt, v.me!.s)}</div>`
        : watching ? `<div class="hk-vs">${score(v.tables[shown], 1)}<span class="muted">vs</span>${score(v.tables[shown], 0)}</div>${only ? '' : '<button class="ghost hk-back" data-table="-1">← All tables</button>'}` : '');
      // The grid: every table, when I'm not playing and not watching one big.
      const showGrid = !mt && !watching;
      const gk = showGrid ? `${v.stage}:${v.tables.length}` : '';
      const grid = root.querySelector<HTMLElement>('.hk-grid')!;
      if (grid.dataset.k !== gk) {
        grid.dataset.k = gk;
        grid.innerHTML = showGrid ? v.tables.map((_, i) => `<button class="hk-card" data-table="${i}"><canvas data-i="${i}"></canvas><div class="hk-cap"></div></button>`).join('') : '';
      }
      v.tables.forEach((t, i) => {
        const cap = grid.querySelector(`[data-table="${i}"] .hk-cap`);
        const html = `${chip(app.player(t.ids[0]))}<b>${t.score[0]}–${t.score[1]}</b>${chip(app.player(t.ids[1]))}${t.winner >= 0 ? `<span class="hk-done">${t.coin ? '🪙' : '✅'} ${esc(app.player(t.ids[t.winner])?.name)}</span>` : t.ot ? '<span class="hk-ot">⚡</span>' : ''}`;
        if (cap && cap.innerHTML !== html) cap.innerHTML = html;
      });
      const meId = app.me ?? '';
      const lost = !!app.me && app.s.participants.includes(meId) && !v.alive.includes(meId);
      const foot = mt ? `<p class="center muted">Your goal is at the bottom. Move with your finger or mouse (or the arrow keys) and hit the puck into the top goal. First to ${HOCKEY.firstTo}.</p>`
        : v.bye === meId ? '<p class="center">🎟️ You have a bye this round. Watch the others, tap a table to watch it big.</p>'
        : lost ? '<p class="center muted">You\'re out. Tap a table to watch it big.</p>'
        : v.alive.includes(meId) && v.phase === 'play' ? '<p class="center">✅ You\'re through to the next round. Tap a table to watch it big.</p>'
        : v.phase === 'break' ? `<p class="center muted">${v.alive.length} still in.</p>`
        : '<p class="center muted">Tap a table to watch it big.</p>';
      set('.hk-foot', foot);
    },
    raw(m) { if (m.t === 'hk') onFrame(m); },
    unmount() {
      cancelAnimationFrame(raf);
      clearInterval(sim);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      root.removeEventListener('click', onClick);
      root.innerHTML = '';
    },
  };
  return client;
};

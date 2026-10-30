// ─── BIRD RACE (client) ───────────────────────────────────────────────────────
// Each client flies its own copy of
// the seeded course; the host's browser also flies the bots. Positions go peer to
// peer over the room relay (batched every 50ms, heartbeat every 400ms) and are
// dead-reckoned between snapshots; finishes and distances go to the server, which
// decides the result (server/src/games/bird.ts).
//
// The sim runs on setInterval, not requestAnimationFrame: rAF pauses in background
// tabs, and the host's bots must keep flying regardless. Drawing uses rAF.
import { C, TICK_MS, getEffective, step, type GameState, type Pipe } from './physics-core.ts';
import * as R from './race-core.ts';
import { ATTACKS, PX_PER_M, ordinal, type BirdPub, type BirdView } from '../../../shared/bird.ts';
import { avatarSrc, type App, type GameClient } from '../../app.ts';
import type { PlayerPub } from '../../../shared/protocol.ts';

type St = 'fly' | 'fin' | 'out';

interface Run {
  id: string;
  s: GameState;
  seen: WeakSet<Pipe>;
  st: St;
  fm: number;
  bk: number;
  brain: R.Brain | null;     // null = a human (me)
  dirty: boolean;
  lastSent: number;
}

interface Remote { id: string; y: number; vy: number; g: number; size: number; d: number; sp: number; at: number; st: St; dispY: number }

const SEND_EVERY_MS = 50;
const HEARTBEAT_MS = 400;
const REPORT_MS = 500;

const SKY = ['#5ec8f2', '#bdeaff'];
const PIPE = ['#3ccf6e', '#1f8a45'];

const imgs = new Map<string, HTMLImageElement>();
function sprite(key: string) {
  let i = imgs.get(key);
  if (!i) { i = new Image(); i.src = avatarSrc(key); imgs.set(key, i); }
  return i;
}

export const birdGame = (): GameClient => {
  let app: App, root: HTMLElement, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D;
  let seed = 0, startAt = 0, finishDist = Infinity;
  const runs = new Map<string, Run>();
  const remotes = new Map<string, Remote>();
  let cam: GameState, camBrain: R.Brain;
  let simTimer = 0, sendTimer = 0, repTimer = 0, raf = 0;
  let acc = 0, lastT = 0, started = false;
  let pendingFlap = false;
  let bonkFx = -1e9;
  let pop: { text: string; color: string; at: number } | null = null;
  // Portrait phones see a narrower slice of the course (the bird still sits at
  // PLAYER_X), with a bigger HUD, so nothing is drawn at postage-stamp size.
  let W = C.W, ui = 1;
  const fs = (px: number, family = 'Inter, sans-serif', weight = '600') => `${weight} ${Math.round(px * ui)}px ${family}`;
  const EMOJI = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

  const view = () => app.s.gv as BirdView | null;
  const myRun = () => (app.me ? runs.get(app.me) : undefined);
  const serverBird = (id: string): BirdPub | undefined => view()?.birds.find(b => b.id === id);
  const coinOf = (n: number) => R.coinAt(seed, n);

  // ── standings: my own runs exactly, everyone else dead-reckoned ──
  function extrapolate(r: Remote, now: number) {
    if (r.st !== 'fly') return { y: r.y, vy: r.vy, d: r.d };
    const n = Math.min(240, Math.max(0, (now - r.at) / TICK_MS));
    let y = r.y, vy = r.vy;
    for (let k = 1; k <= n; k++) { vy = Math.min(vy + r.g, R.RACE_OPTS.maxFall); y += vy; }
    return { y: Math.min(C.GROUND - (C.PLAYER_SIZE * r.size) / 2, y), vy, d: r.d + r.sp * n };
  }

  interface Row { id: string; d: number; st: BirdPub['st']; fm: number }
  function standings(): Row[] {
    const now = performance.now();
    const rows: Row[] = app.s.participants.map(id => {
      const sb = serverBird(id);
      const run = runs.get(id), rem = remotes.get(id);
      const d = run ? run.s.dist : rem ? extrapolate(rem, now).d : sb?.d ?? 0;
      let st: BirdPub['st'] = sb?.st ?? 'fly';
      if (run && run.st !== 'fly') st = run.st;
      if (rem && rem.st !== 'fly' && st === 'fly') st = rem.st;
      return { id, d: st === 'fin' ? Math.max(d, finishDist) : d, st, fm: run?.fm || sb?.fm || 0 };
    });
    const rank = (r: Row) => r.st === 'fin' ? 0 : r.st === 'fly' ? 1 : r.st === 'out' ? 2 : 3;
    return rows.sort((a, b) => rank(a) - rank(b) || (a.st === 'fin' ? a.fm - b.fm : b.d - a.d));
  }

  // ── sim ──
  function newRun(id: string, bot: boolean): Run {
    return {
      id, s: R.raceState(seed), seen: new WeakSet(), st: 'fly', fm: 0, bk: 0,
      brain: bot ? R.newBrain(0.3 + Math.random() * 0.45) : null, dirty: true, lastSent: 0,
    };
  }

  function simFrame() {
    const t = app.now();
    if (t < startAt) { lastT = t; return; }
    if (!started) { started = true; lastT = startAt; }
    acc += Math.min(t - lastT, 250);
    lastT = t;
    while (acc >= TICK_MS) {
      for (const r of runs.values()) tickRun(r, t);
      tickCam();
      acc -= TICK_MS;
    }
  }

  function tickRun(r: Run, t: number) {
    if (r.st !== 'fly') return;
    const mine = r.id === app.me;
    let flapped = false;
    if (r.brain) flapped = R.decide(r.s, r.brain, Math.random);
    else if (pendingFlap) { flapped = true; pendingFlap = false; }
    const res = step(r.s, flapped);
    if (res.dead) {
      R.bonk(r.s);
      r.bk++;
      if (mine) bonkFx = performance.now();
      r.dirty = true;
    }
    if (flapped) r.dirty = true;
    const coin = R.passItems(r.s, r.seen, coinOf);
    if (coin === 'atk') attack(r);
    if (Number.isFinite(finishDist) && r.s.dist >= finishDist) {
      r.st = 'fin';
      r.fm = t - startAt;
      r.dirty = true;
      report(r);
      if (mine) popText(`🏁 ${(r.fm / 1000).toFixed(1)}s`, '#3ef08a');
    }
  }

  // The camera for spectating (finished, out, or not racing): an autopilot bird
  // flying the same course a little behind the leader, so the leader is on screen
  // clear of the standings box. Warped forward whenever the leader pulls away.
  function tickCam() {
    if (step(cam, R.decide(cam, camBrain, Math.random)).dead) R.bonk(cam);
    const lead = standings().find(r => r.st === 'fly')?.d;
    const target = lead === undefined ? cam.dist : lead - W * 0.3;
    if (target - cam.dist > 120) R.warp(cam, target - cam.dist);
  }

  // 🎯 coin: hit whoever leads (if it isn't you) with a random attack.
  function attack(r: Run) {
    const target = standings().find(x => x.st === 'fly' && x.id !== r.id);
    const top = standings().find(x => x.st === 'fly');
    const mine = r.id === app.me;
    if (!target || top?.id === r.id) { if (mine) popText('🎯 You are the leader. Nobody to hit.', '#ffffff'); return; }
    const kind = ATTACKS[Math.floor(Math.random() * ATTACKS.length)].id;
    app.net.relay('atk', { target: target.id, kind, by: r.id });
    app.net.game({ k: 'atk', target: target.id, kind, by: r.id });
    applyAttack(target.id, kind, r.id);
    if (mine) popText(`🎯 Hit ${app.player(target.id)?.name ?? 'the leader'}!`, '#ff8a3d');
  }

  function applyAttack(target: string, kind: string, by: string) {
    const r = runs.get(target);
    if (!r || r.st !== 'fly') return;
    if (kind === 'rate') R.rateLimit(r.s);
    else if (kind === 'mfa') R.bonk(r.s);
    r.dirty = true;
    if (target === app.me) {
      const a = ATTACKS.find(x => x.id === kind)!;
      bonkFx = performance.now();
      popText(`🎯 ${app.player(by)?.name ?? 'Someone'}: ${a.name}`, '#ff6b8a');
    }
  }

  // ── wire ──
  function flushSnaps() {
    const now = performance.now();
    const out = [];
    for (const r of runs.values()) {
      if (!r.dirty && now - r.lastSent < HEARTBEAT_MS) continue;
      r.dirty = false;
      r.lastSent = now;
      const e = getEffective(r.s);
      out.push({ id: r.id, st: r.st, y: r.s.player.y, vy: r.s.player.vy, g: e.gravity, size: e.size, d: r.s.dist, sp: r.s.pipeSpeed * e.speed });
    }
    if (out.length) app.net.relay('snaps', { seed, birds: out });
  }

  function report(r: Run) {
    app.net.game({ k: 'rep', id: r.id, d: r.s.dist, st: r.st, fm: r.fm, bk: r.bk });
  }

  function flap() {
    const t = app.now();
    if (t >= startAt) pendingFlap = true;
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !['Space', 'ArrowUp', 'KeyW'].includes(e.code)) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    flap();
  };
  const onPointer = (e: PointerEvent) => { e.preventDefault(); flap(); };

  function popText(text: string, color: string) { pop = { text, color, at: performance.now() }; }

  // ── drawing ──
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const t = app.now();
    const me = myRun();
    const following = me && me.st === 'fly';
    const world = following ? me.s : cam;
    const camDist = world.dist;
    const [sky1, sky2] = SKY;
    const grd = g.createLinearGradient(0, 0, 0, C.GROUND);
    grd.addColorStop(0, sky1);
    grd.addColorStop(1, sky2);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, C.H);
    drawSkyline(camDist);
    drawPipes(world, me);
    if (Number.isFinite(finishDist)) drawFinish(C.PLAYER_X + (finishDist - camDist));
    g.fillStyle = '#20163f';
    g.fillRect(0, C.GROUND, W, C.H - C.GROUND);

    // Others: faded ghosts placed by course position; name tags only for the nearest few.
    const ghosts: Array<{ id: string; x: number; y: number; vy: number; size: number; st: St }> = [];
    for (const r of runs.values()) if (r.id !== app.me && r.st === 'fly') ghosts.push({ id: r.id, x: C.PLAYER_X + r.s.dist - camDist, y: r.s.player.y, vy: r.s.player.vy, size: getEffective(r.s).size, st: r.st });
    for (const rem of remotes.values()) {
      if (rem.st !== 'fly' || runs.has(rem.id) || serverBird(rem.id)?.st === 'out') continue;
      const e = extrapolate(rem, now);
      rem.dispY += (e.y - rem.dispY) * 0.5;
      ghosts.push({ id: rem.id, x: C.PLAYER_X + e.d - camDist, y: rem.dispY, vy: e.vy, size: rem.size, st: rem.st });
    }
    tags = [];
    if (following) {
      const e = getEffective(me.s);
      const blink = e.invincible && Math.floor(now / 80) % 2 === 0;
      drawBird(app.player(me.id), C.PLAYER_X, me.s.player.y, me.s.player.vy, e.size, blink ? 0.5 : 1, true, true);
    }
    const tagged = new Set([...ghosts].sort((a, b) => Math.abs(a.x - C.PLAYER_X) - Math.abs(b.x - C.PLAYER_X)).slice(0, 4).map(x => x.id));
    for (const gh of ghosts) {
      if (gh.x < -80 || gh.x > W + 80) continue;
      drawBird(app.player(gh.id), gh.x, gh.y, gh.vy, gh.size, 0.55, false, tagged.has(gh.id));
    }
    drawFx(now);
    // Flying: nothing over the playfield, just the strip along the ground. Finished,
    // out or spectating: the full standings, since you're watching by then.
    if (!following) drawStandings(t);
    drawStrip(t);
    drawCountdown(t);
    drawBanner(me);
    drawPop(now, following ? me.s.player.y : C.H / 2);
  }

  function drawSkyline(d: number) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    const off = (d * 0.25) % 220;
    for (let i = -1; i < 9; i++) {
      const x = i * 220 - off;
      const h = 120 + ((i * 97 + Math.floor(d * 0.25 / 220) * 31) % 5) * 40;
      g.fillRect(x, C.GROUND - h, 150, h);
    }
  }

  function drawPipes(s: GameState, me: Run | undefined) {
    const [body, dark] = PIPE;
    for (const p of s.pipes) {
      if (p.x > W + 10 || p.x + C.PIPE_W < -10) continue;
      const bot = p.topH + p.gap;
      for (const [y, h, lipY] of [[0, p.topH, p.topH - 22], [bot, C.GROUND - bot, bot]]) {
        g.fillStyle = body;
        g.fillRect(p.x, y, C.PIPE_W, h);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(p.x + 8, y, 8, h);
        g.fillStyle = dark;
        g.fillRect(p.x - 6, lipY, C.PIPE_W + 12, 22);
        g.strokeStyle = '#0d0820';
        g.lineWidth = 3;
        g.strokeRect(p.x, y, C.PIPE_W, h);
        g.strokeRect(p.x - 6, lipY, C.PIPE_W + 12, 22);
      }
      const coin = coinOf(p.n);
      const seen = me && me.st === 'fly' ? me.seen.has(p) : p.x + C.PIPE_W / 2 < C.PLAYER_X;
      if (coin && !seen) {
        const cx = p.x + C.PIPE_W / 2, cy = p.topH + p.gap / 2 + Math.sin(performance.now() / 200 + p.n) * 4;
        g.fillStyle = '#ff8a3d';
        g.strokeStyle = '#0d0820';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, 15, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.font = `18px ${EMOJI}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🎯', cx, cy + 1);
      }
    }
  }

  function drawFinish(x: number) {
    if (x > W + 40 || x < -40) return;
    const sq = 16;
    for (let row = 0; row * sq < C.GROUND; row++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle = (row + col) % 2 ? '#111' : '#fff';
        g.fillRect(x + col * sq, row * sq, sq, sq);
      }
    }
  }

  // Name tags already drawn this frame: a tag that would overlap one is skipped,
  // so a bunched pack at the start doesn't turn into a pile of labels.
  let tags: Array<[number, number, number, number]> = [];
  function drawBird(p: PlayerPub | undefined, x: number, y: number, vy: number, size: number, alpha: number, mine: boolean, tag: boolean) {
    if (!p) return;
    const s = C.PLAYER_SIZE * 1.5 * size;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (mine) {
      g.beginPath();
      g.arc(0, 0, s * 0.62, 0, Math.PI * 2);
      g.lineWidth = 5;
      g.strokeStyle = '#ffd23f';
      g.shadowColor = '#ffd23f';
      g.shadowBlur = 16;
      g.stroke();
      g.shadowBlur = 0;
    }
    g.rotate(Math.max(-0.4, Math.min(0.4, vy * 0.05)));
    const img = sprite(p.avatar);
    if (img.complete && img.naturalWidth) g.drawImage(img, -s / 2, -s / 2, s, s);
    else { g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, s / 2.5, 0, Math.PI * 2); g.fill(); }
    if (p.hat) { g.font = `${Math.round(s * 0.5)}px ${EMOJI}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(p.hat, 0, -s * 0.3); }
    g.restore();
    if (!tag) return;
    g.save();
    g.font = fs(18);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = mine ? 'YOU' : p.name.slice(0, 18);
    const w = g.measureText(label).width + 18, ty = y - s / 2 - (p.hat ? 44 : 22);
    const box: [number, number, number, number] = [x - w / 2, ty - 13 * ui, w, 26 * ui];
    if (tags.some(([bx, by, bw, bh]) => box[0] < bx + bw + 6 && bx < box[0] + box[2] + 6 && box[1] < by + bh + 6 && by < box[1] + box[3] + 6)) { g.restore(); return; }
    tags.push(box);
    g.globalAlpha = 0.9;
    g.fillStyle = '#0d0820';
    g.fillRect(box[0], box[1], box[2], box[3]);
    g.fillStyle = p.color;
    g.fillRect(box[0], box[1] + box[3] - 3, w, 3);
    g.fillStyle = '#f6f1ff';
    g.fillText(label, x, ty);
    g.restore();
  }

  function drawFx(now: number) {
    const tb = (now - bonkFx) / 300;
    if (tb < 1) { g.fillStyle = `rgba(255,77,109,${0.3 * (1 - tb)})`; g.fillRect(0, 0, W, C.GROUND); }
  }

  function label(r: Row): string {
    if (r.st === 'fin') return `🏁 ${(r.fm / 1000).toFixed(1)}s`;
    if (r.st === 'out') return '💥 out';
    if (r.st === 'gone') return 'left';
    return Number.isFinite(finishDist) ? `${Math.floor(Math.min(0.999, r.d / finishDist) * 100)}%` : `${Math.round(r.d / PX_PER_M)}m`;
  }

  // Live standings, top-left: top five plus you.
  function drawStandings(_t: number) {
    const all = standings();
    const shown = all.map((r, i) => ({ r, i })).filter(({ r, i }) => i < 5 || r.id === app.me);
    g.save();
    const rowH = 28 * ui, boxW = 330 * ui;
    g.fillStyle = 'rgba(13,8,32,0.88)';
    g.fillRect(12, 12, boxW, 40 * ui + shown.length * rowH);
    g.font = fs(15, 'Bungee, sans-serif', '400');
    g.fillStyle = '#2de2e6';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('LIVE', 26, 12 + 20 * ui);
    g.font = fs(18);
    shown.forEach(({ r, i }, row) => {
      const p = app.player(r.id);
      g.globalAlpha = r.st === 'gone' || r.st === 'out' ? 0.5 : 1;
      g.fillStyle = r.id === app.me ? '#ffd23f' : '#f6f1ff';
      const y = 12 + 50 * ui + row * rowH;
      g.fillText(`${i + 1}. ${(p?.name ?? '?').slice(0, 14)}`, 26, y, boxW - 120 * ui);
      g.textAlign = 'right';
      g.fillText(label(r), boxW, y);
      g.textAlign = 'left';
    });
    g.restore();
  }

  // The ground strip: the round's clock on the right, and a
  // track with a dot per bird on the left, so you know where you sit in the pack.
  function drawStrip(t: number) {
    const gv = view();
    if (!gv || t < startAt) return;
    const rows = standings();
    const flying = rows.filter(r => r.st === 'fly');
    const text = `⏱️ ${((t - startAt) / 1000).toFixed(1)}s`;
    const mid = (C.GROUND + C.H) / 2;
    g.save();
    g.font = fs(20);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = '#f6f1ff';
    g.fillText(text, W - 20, mid);
    const x0 = 24, x1 = Math.max(W * 0.4, W - g.measureText(text).width - 50);
    g.strokeStyle = '#3a2a6e';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(x0, mid); g.lineTo(x1, mid); g.stroke();
    if (Number.isFinite(finishDist)) { g.font = fs(18, EMOJI, '400'); g.textAlign = 'center'; g.fillText('🏁', x1 + 2, mid); }
    const scale = Number.isFinite(finishDist) ? finishDist : Math.max(1, ...flying.map(r => r.d));
    const dot = (r: Row, rad: number) => {
      const x = x0 + (x1 - x0) * Math.min(1, r.d / scale);
      g.fillStyle = app.player(r.id)?.color ?? '#fff';
      g.beginPath(); g.arc(x, mid, rad, 0, Math.PI * 2); g.fill();
      return x;
    };
    for (const r of rows) {
      if (r.id === app.me || (r.st !== 'fly' && r.st !== 'fin')) continue;
      g.globalAlpha = 0.75;
      dot(r, 6 * ui);
    }
    const me = rows.find(r => r.id === app.me && (r.st === 'fly' || r.st === 'fin'));
    if (me) {
      g.globalAlpha = 1;
      const x = dot(me, 9 * ui);
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.beginPath(); g.arc(x, mid, 9 * ui + 2, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  function drawCountdown(t: number) {
    const left = startAt - t;
    if (left < -700) return;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '160px Bungee, sans-serif';
    g.lineWidth = 12;
    g.strokeStyle = '#0d0820';
    g.fillStyle = left > 0 ? '#ffd23f' : '#3ef08a';
    const text = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
    g.strokeText(text, W / 2, C.H / 2 - 40);
    g.fillText(text, W / 2, C.H / 2 - 40);
    g.restore();
  }

  function drawBanner(me: Run | undefined) {
    let text = '';
    if (!me) text = app.me ? 'Spectating · you join next round' : '';
    else if (me.st === 'fin') {
      const place = standings().filter(r => r.st === 'fin').findIndex(r => r.id === me.id) + 1;
      text = `🏁 Finished ${place ? ordinal(place) : ''} · ${(me.fm / 1000).toFixed(1)}s`;
    }
    if (!text) return;
    g.save();
    g.font = fs(30, 'Bungee, sans-serif', '400');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(W - 20, g.measureText(text).width + 60);
    g.fillStyle = 'rgba(13,8,32,0.9)';
    g.fillRect(W / 2 - w / 2, C.GROUND - 90, w, 60);
    g.fillStyle = '#ffd23f';
    g.fillText(text, W / 2, C.GROUND - 60);
    g.restore();
  }

  function drawPop(now: number, y: number) {
    if (!pop || now - pop.at > 1600) return;
    const k = (now - pop.at) / 1600;
    g.save();
    g.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
    g.font = fs(28, 'Bungee, sans-serif', '400');
    g.textAlign = 'left';
    g.lineWidth = 6;
    g.strokeStyle = '#0d0820';
    g.fillStyle = pop.color;
    const py = Math.max(80, Math.min(C.GROUND - 60, y - 60)) - k * 20;
    g.strokeText(pop.text, C.PLAYER_X + 50, py, W - C.PLAYER_X - 60);
    g.fillText(pop.text, C.PLAYER_X + 50, py, W - C.PLAYER_X - 60);
    g.restore();
  }

  // ── lifecycle ──
  return {
    mount(r, a) {
      app = a; root = r;
      const gv = view()!;
      seed = a.s.seed;
      startAt = gv.startAt;
      finishDist = R.courseLength(gv.courseSec);
      cam = R.raceState(seed);
      camBrain = R.newBrain(1);
      const playing = !!a.me && a.s.participants.includes(a.me);
      if (innerHeight > innerWidth && innerWidth < 760) { W = 760; ui = 1.5; }
      root.className = 'bird';
      root.innerHTML = `<canvas width="${W}" height="${C.H}" style="aspect-ratio:${W}/${C.H};width:min(100%, calc((100vh - 130px) * ${W} / ${C.H}))"></canvas>
        <p class="muted center">${playing ? 'Tap anywhere, click or press Space to flap' : 'Spectating'}</p>`;
      canvas = root.querySelector('canvas')!;
      g = canvas.getContext('2d')!;
      if (a.me && a.s.participants.includes(a.me)) runs.set(a.me, newRun(a.me, false));
      if (a.isHost()) for (const id of a.s.participants) if (a.player(id)?.bot) runs.set(id, newRun(id, true));
      root.addEventListener('pointerdown', onPointer);
      window.addEventListener('keydown', onKey);
      simTimer = window.setInterval(simFrame, 8);
      sendTimer = window.setInterval(flushSnaps, SEND_EVERY_MS);
      repTimer = window.setInterval(() => { if (app.now() >= startAt) for (const r of runs.values()) report(r); }, REPORT_MS);
      raf = requestAnimationFrame(frame);
    },
    update(a) { app = a; },
    bc(from, e, p) {
      if (e === 'snaps' && p?.seed === seed) {
        const now = performance.now();
        for (const b of p.birds ?? []) {
          if (runs.has(b.id)) continue;
          const old = remotes.get(b.id);
          remotes.set(b.id, { ...b, at: now, dispY: old?.dispY ?? b.y });
        }
      } else if (e === 'atk' && p) applyAttack(String(p.target), String(p.kind), String(p.by ?? from));
    },
    unmount() {
      clearInterval(simTimer); clearInterval(sendTimer); clearInterval(repTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onPointer);
      root.innerHTML = '';
    },
  };
};

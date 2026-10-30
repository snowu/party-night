// Air Hockey Royale (client). The server runs the table (server/src/games/hockey.ts)
// and sends snapshots at 20Hz; between them pucks are dead-reckoned. My own mallet
// moves locally at the same speed the server moves it, so it never feels laggy;
// everyone else's eases toward its last snapshot. The table is turned so my goal
// is at the bottom, and the mallet follows my finger (or mouse) inside my zone.
import { HOCKEY, approach, clampToZone, home, slice, type HockeyFrame, type HockeyView } from '../../../shared/hockey.ts';
import { avatarSrc, timer, tickTimers, type App, type GameClient } from '../../app.ts';
import { canPlay } from '../social/wrap.ts';

const SEND_MS = 33;
const KEY_SPEED = 1.6;          // table units a second with the arrow keys
const EMOJI = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

const imgs = new Map<string, HTMLImageElement>();
function sprite(key: string) {
  let i = imgs.get(key);
  if (!i) { i = new Image(); i.src = avatarSrc(key); imgs.set(key, i); }
  return i;
}

type V = [number, number];

export const hockeyGame = (): GameClient => {
  let root: HTMLElement, app: App, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D;
  let raf = 0, lastT = 0, lastSent = 0, sent = '';
  let frame: HockeyFrame | null = null;
  let mine: V | null = null, target: V | null = null;
  let rot = 0;
  const keys = new Set<string>();
  const shown: V[] = [];
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as HockeyView | null;
  const seatIdx = () => gv()?.seats.findIndex(s => s.id === app.me) ?? -1;
  const playing = () => { const v = gv(), i = seatIdx(); return !!v && i >= 0 && !v.seats[i].out && canPlay(app); };

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };

  // Screen → table: undo the scale and the turn that puts my goal at the bottom.
  function onPointer(e: PointerEvent) {
    const v = gv(), i = seatIdx();
    if (!v || !playing()) return;
    const r = canvas.getBoundingClientRect(), S = r.width * 0.4;
    const sx = (e.clientX - r.left - r.width / 2) / S, sy = (e.clientY - r.top - r.height / 2) / S;
    target = clampToZone(i, v.seats.length, sx * Math.cos(-rot) - sy * Math.sin(-rot), sx * Math.sin(-rot) + sy * Math.cos(-rot));
  }
  const ARROWS: Record<string, V> = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
  const onKey = (e: KeyboardEvent) => {
    if (!ARROWS[e.code] || !playing()) return;
    e.preventDefault();
    if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code);
  };

  function draw(t: number) {
    raf = requestAnimationFrame(draw);
    const v = gv();
    if (!v) return;
    const dt = Math.min(0.1, (t - (lastT || t)) / 1000);
    lastT = t;
    const n = v.seats.length, me = seatIdx(), now = app.now();
    rot = Math.PI / 2 - slice(Math.max(0, me), n).mid;

    if (me >= 0) {
      mine ??= home(me, n);
      target ??= mine;
      if (keys.size && playing()) {
        let kx = 0, ky = 0;
        for (const k of keys) { kx += ARROWS[k][0]; ky += ARROWS[k][1]; }
        // Keys are screen directions; turn them back onto the table.
        const wx = kx * Math.cos(-rot) - ky * Math.sin(-rot), wy = kx * Math.sin(-rot) + ky * Math.cos(-rot);
        target = clampToZone(me, n, target[0] + wx * KEY_SPEED * dt, target[1] + wy * KEY_SPEED * dt);
      }
      mine = approach(mine, target, dt);
      const key = `${target[0].toFixed(3)},${target[1].toFixed(3)}`;
      if (playing() && now - lastSent >= SEND_MS && key !== sent) {
        lastSent = now; sent = key;
        app.net.game({ k: 'mallet', x: Math.round(target[0] * 1000) / 1000, y: Math.round(target[1] * 1000) / 1000 });
      }
    }

    const css = canvas.clientWidth, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
    const W = canvas.width, S = W * 0.4, c = W / 2;
    const X = (x: number, y: number) => c + S * (x * Math.cos(rot) - y * Math.sin(rot));
    const Y = (x: number, y: number) => c + S * (x * Math.sin(rot) + y * Math.cos(rot));
    const arc = (r: number, a0: number, a1: number, color: string, width: number) => {
      g.beginPath(); g.arc(c, c, r * S, a0 + rot, a1 + rot); g.strokeStyle = color; g.lineWidth = width * S; g.stroke();
    };
    const disc = (x: number, y: number, r: number, fill: string) => { g.beginPath(); g.arc(X(x, y), Y(x, y), r * S, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };

    g.clearRect(0, 0, W, W);
    // The table: ice-white surface, the neutral middle, and lines between zones.
    g.beginPath(); g.arc(c, c, S, 0, Math.PI * 2); g.fillStyle = '#e9f3fb'; g.fill();
    g.beginPath(); g.arc(c, c, HOCKEY.zoneIn * S, 0, Math.PI * 2); g.fillStyle = '#d6e6f3'; g.fill();
    g.setLineDash([S * 0.02, S * 0.02]);
    g.beginPath(); g.arc(c, c, HOCKEY.zoneIn * S, 0, Math.PI * 2); g.strokeStyle = '#9db6cc'; g.lineWidth = 2; g.stroke();
    g.setLineDash([]);
    const zi = HOCKEY.zoneIn;
    for (let i = 0; i < n && n > 1; i++) {
      const ux = Math.cos(slice(i, n).a0), uy = Math.sin(slice(i, n).a0);
      g.beginPath(); g.moveTo(X(ux * zi, uy * zi), Y(ux * zi, uy * zi)); g.lineTo(X(ux, uy), Y(ux, uy));
      g.strokeStyle = '#9db6cc'; g.lineWidth = 2; g.stroke();
    }

    v.seats.forEach((seat, i) => {
      const s = slice(i, n), p = app.player(seat.id), col = p?.color ?? '#888';
      if (seat.out) arc(1.02, s.a0, s.a1, '#5d6375', 0.05);
      else {
        // A wash of the owner's colour over their zone, walls either side of the goal.
        g.beginPath(); g.arc(c, c, S, s.a0 + rot, s.a1 + rot); g.arc(c, c, HOCKEY.zoneIn * S, s.a1 + rot, s.a0 + rot, true); g.closePath();
        g.fillStyle = col + (i === me ? '30' : '18'); g.fill();
        arc(1.02, s.a0, s.g0, '#5d6375', 0.05);
        arc(1.02, s.g1, s.a1, '#5d6375', 0.05);
        arc(1.015, s.g0, s.g1, '#10131f', 0.04);
        arc(0.995, s.g0, s.g1, col, 0.012);
        // My mallet is local; everyone else's eases toward the last snapshot.
        const fm = (frame?.m[i] as V | undefined) ?? home(i, n);
        const prev = shown[i] ?? fm, k = Math.min(1, dt * 18);
        shown[i] = i === me && mine ? mine : [prev[0] + (fm[0] - prev[0]) * k, prev[1] + (fm[1] - prev[1]) * k];
        const [mx, my] = shown[i], mr = HOCKEY.malletR(n);
        g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8;
        disc(mx, my, mr, col);
        g.shadowBlur = 0;
        disc(mx, my, mr * 0.62, 'rgba(0,0,0,.18)');
        disc(mx, my, mr * 0.45, col);
        if (i === me) { g.beginPath(); g.arc(X(mx, my), Y(mx, my), mr * S + 3, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); }
      }
      // Avatar and lives just outside the rim.
      const a = s.mid, ax = X(Math.cos(a) * 1.16, Math.sin(a) * 1.16), ay = Y(Math.cos(a) * 1.16, Math.sin(a) * 1.16);
      const size = Math.min(S * 0.16, (S * 2.2 * Math.PI) / n * 0.5);
      g.globalAlpha = seat.out ? 0.35 : 1;
      g.beginPath(); g.arc(ax, ay, size / 2 + 3, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      if (p) g.drawImage(sprite(p.avatar), ax - size / 2, ay - size / 2, size, size);
      g.globalAlpha = 1;
      g.font = `${Math.round(size * 0.32)}px ${EMOJI}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(seat.out ? '💀' : '❤️'.repeat(seat.lives), ax, ay + size * 0.7);
    });

    if (frame) {
      const ahead = Math.max(0, Math.min(0.12, (now - frame.at) / 1000));
      for (const [x0, y0, vx, vy, big] of frame.b) {
        let x = x0 + vx * ahead, y = y0 + vy * ahead;
        const r = big ? HOCKEY.bigR : HOCKEY.puckR, d = Math.sqrt(x * x + y * y);
        if (d > 1 - r) { x *= (1 - r) / d; y *= (1 - r) / d; }
        g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 6;
        disc(x, y, r, big ? '#ff8a3d' : '#1b1f2e');
        g.shadowBlur = 0;
        disc(x, y, r * 0.7, big ? '#ffb070' : '#2d3348');
      }
    }
    if (now < v.startAt) {
      g.font = `800 ${Math.round(S * 0.4)}px Bungee, sans-serif`;
      g.fillStyle = '#1b1f2e';
      g.fillText(String(Math.ceil((v.startAt - now) / 1000)), c, c);
    }
  }

  return {
    mount(r, a) {
      root = r; app = a;
      root.className = 'hockey';
      root.innerHTML = `<div class="hockey-head"></div><canvas></canvas><p class="hockey-foot center muted"></p>`;
      canvas = root.querySelector('canvas')!;
      g = canvas.getContext('2d')!;
      canvas.addEventListener('pointermove', onPointer);
      canvas.addEventListener('pointerdown', onPointer);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      raf = requestAnimationFrame(draw);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      const seat = v.seats[seatIdx()];
      set('.hockey-head', timer(v.endAt, HOCKEY.capMs));
      set('.hockey-foot', !seat || !canPlay(app) ? `${v.seats.filter(s => !s.out).length} still at the table`
        : seat.out ? '🥅 You\'re out. Enjoy the view.'
        : 'Your goal is at the bottom. Drag your mallet around your zone (or use the arrow keys) and swing into the puck.');
    },
    raw(m) { if (m.t === 'hockey') frame = m; },
    unmount() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      root.innerHTML = '';
    },
  };
};

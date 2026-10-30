// Ping Pong Royale (client). The server runs the table (server/src/games/pong.ts)
// and sends snapshots at 20Hz; between them balls are dead-reckoned. My own paddle
// moves locally at the same speed the server moves it, so it never feels laggy;
// everyone else's paddle eases toward its last snapshot. The table is turned so
// my slice is at the bottom; drag left and right anywhere to move.
import { PONG, approach, padAngle, slice, type PongFrame, type PongView } from '../../../shared/pong.ts';
import { avatarSrc, timer, tickTimers, type App, type GameClient } from '../../app.ts';
import { canPlay } from '../social/wrap.ts';

const SEND_MS = 33;
const EMOJI = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

const imgs = new Map<string, HTMLImageElement>();
function sprite(key: string) {
  let i = imgs.get(key);
  if (!i) { i = new Image(); i.src = avatarSrc(key); imgs.set(key, i); }
  return i;
}

export const pongGame = (): GameClient => {
  let root: HTMLElement, app: App, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D;
  let raf = 0, lastT = 0, lastSent = 0, sentP = -1;
  let frame: PongFrame | null = null;
  let myP = 0.5, target = 0.5, keys = 0;
  const shown: number[] = [];
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as PongView | null;
  const mine = () => gv()?.seats.findIndex(s => s.id === app.me) ?? -1;
  const playing = () => { const v = gv(), i = mine(); return !!v && i >= 0 && !v.seats[i].out && canPlay(app); };

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };

  // Pointer x across the canvas → paddle position. My slice sits at the bottom,
  // where p runs right to left, so the screen's left edge is p = 1.
  function onPointer(e: PointerEvent) {
    if (!playing()) return;
    const r = canvas.getBoundingClientRect();
    target = Math.max(0, Math.min(1, 1 - ((e.clientX - r.left) / r.width - 0.1) / 0.8));
  }
  const onKey = (e: KeyboardEvent) => {
    const k = e.code === 'ArrowLeft' || e.code === 'KeyA' ? 1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 2 : 0;
    if (!k || !playing()) return;
    e.preventDefault();
    keys = e.type === 'keydown' ? keys | k : keys & ~k;
    target = keys === 1 ? 1 : keys === 2 ? 0 : myP;
  };

  function draw(t: number) {
    raf = requestAnimationFrame(draw);
    const v = gv();
    if (!v) return;
    const dt = Math.min(0.1, (t - (lastT || t)) / 1000);
    lastT = t;
    const n = v.seats.length, me = mine(), now = app.now();
    myP = approach(myP, target, dt);
    if (playing() && now - lastSent >= SEND_MS && target !== sentP) {
      lastSent = now; sentP = target;
      app.net.game({ k: 'pad', p: Math.round(target * 1000) / 1000 });
    }

    const css = canvas.clientWidth, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
    const W = canvas.width, S = W * 0.4, c = W / 2;
    const mid = (i: number) => { const s = slice(i, n); return (s.g0 + s.g1) / 2; };
    const rot = Math.PI / 2 - mid(Math.max(0, me));
    const X = (x: number, y: number) => c + S * (x * Math.cos(rot) - y * Math.sin(rot));
    const Y = (x: number, y: number) => c + S * (x * Math.sin(rot) + y * Math.cos(rot));
    const arc = (r: number, a0: number, a1: number, color: string, width: number) => {
      g.beginPath(); g.arc(c, c, r * S, a0 + rot, a1 + rot); g.strokeStyle = color; g.lineWidth = width * S; g.stroke();
    };

    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(c, c, S, 0, Math.PI * 2); g.fillStyle = '#1d5fa8'; g.fill();
    g.beginPath(); g.arc(c, c, S * 0.12, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.stroke();

    v.seats.forEach((seat, i) => {
      const s = slice(i, n), p = app.player(seat.id), col = p?.color ?? '#fff';
      if (seat.out) arc(1.02, s.a0, s.a1, '#5d6375', 0.05);
      else {
        arc(1.02, s.a0, s.g0, '#5d6375', 0.05);
        arc(1.02, s.g1, s.a1, '#5d6375', 0.05);
        arc(1.02, s.g0, s.g1, col + '55', 0.03);
        // My paddle is local; everyone else's eases toward the last snapshot.
        const fp = frame?.p[i] ?? 0.5;
        shown[i] = i === me ? myP : (shown[i] ?? fp) + (fp - (shown[i] ?? fp)) * Math.min(1, dt * 18);
        const pa = padAngle(s, shown[i]);
        arc(0.985, pa - s.half, pa + s.half, col, 0.045);
      }
      // Avatar and lives just outside the rim.
      const a = (s.g0 + s.g1) / 2, ax = X(Math.cos(a) * 1.16, Math.sin(a) * 1.16), ay = Y(Math.cos(a) * 1.16, Math.sin(a) * 1.16);
      const size = Math.min(S * 0.16, (S * 2.2 * Math.PI) / n * 0.5);
      g.globalAlpha = seat.out ? 0.35 : 1;
      g.beginPath(); g.arc(ax, ay, size / 2 + 3, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      if (p) g.drawImage(sprite(p.avatar), ax - size / 2, ay - size / 2, size, size);
      g.globalAlpha = 1;
      g.font = `${Math.round(size * 0.32)}px ${EMOJI}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(seat.out ? '💀' : '❤️'.repeat(seat.lives), ax, ay + size * 0.7);
      if (i === me) { g.beginPath(); g.arc(ax, ay, size / 2 + 6, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); }
    });

    if (frame) {
      const ahead = Math.max(0, Math.min(0.12, (now - frame.at) / 1000));
      for (const [x0, y0, vx, vy, big] of frame.b) {
        let x = x0 + vx * ahead, y = y0 + vy * ahead;
        const r = big ? PONG.bigR : PONG.ballR, d = Math.sqrt(x * x + y * y);
        if (d > 1 - r) { x *= (1 - r) / d; y *= (1 - r) / d; }
        if (big) {
          g.font = `${Math.round(r * S * 2.3)}px ${EMOJI}`;
          g.fillText('🏐', X(x, y), Y(x, y));
        } else {
          g.beginPath(); g.arc(X(x, y), Y(x, y), r * S, 0, Math.PI * 2);
          g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 6; g.fill(); g.shadowBlur = 0;
        }
      }
    }
    if (now < v.startAt) {
      g.font = `800 ${Math.round(S * 0.4)}px Bungee, sans-serif`;
      g.fillStyle = '#fff';
      g.fillText(String(Math.ceil((v.startAt - now) / 1000)), c, c);
    }
  }

  return {
    mount(r, a) {
      root = r; app = a;
      root.className = 'pong';
      root.innerHTML = `<div class="pong-head"></div><canvas></canvas><p class="pong-foot center muted"></p>`;
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
      const i = mine(), seat = v.seats[i];
      set('.pong-head', timer(v.endAt, PONG.capMs));
      set('.pong-foot', !seat || !canPlay(app) ? `${v.seats.filter(s => !s.out).length} still at the table`
        : seat.out ? '💥 You\'re out. Enjoy the view.'
        : 'Drag left and right (or ←/→) to move your paddle. You\'re at the bottom.');
    },
    raw(m) { if (m.t === 'pong') frame = m; },
    unmount() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      root.innerHTML = '';
    },
  };
};

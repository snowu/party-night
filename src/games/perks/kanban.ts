// Kanban Rush (client). Each phone runs its own board from the shared deck and
// the server clock: tickets fall, I drag them sideways (or tap a column, or use
// the arrow keys) and when one crosses the line, the column it's over is where
// it lands. Only that landing is sent; the server keeps score.
import { KANBAN, points, type KanbanView } from '../../../shared/kanban.ts';
import { chip, countdown, esc, fmt, tickTimers, timer, type App, type GameClient } from '../../app.ts';
import { canPlay } from '../social/wrap.ts';

const LINE = 0.8;                // the line, as a share of the board's height
const SHOW_MS = 600;             // a landed ticket shows ✓ or ✗ this long
const REACH = 40;                // a touch this close to a ticket (px) grabs it: fingers are fat
const center = (col: number) => (col + 0.5) / 3;
const nearest = (x: number) => Math.max(0, Math.min(2, Math.floor(x * 3)));

interface Card { el: HTMLElement; x: number; col: number; minY: number; y: number; landedAt: number }

export const kanbanGame = (): GameClient => {
  let root: HTMLElement, app: App, board: HTMLElement;
  let raf = 0, startAt = -1;
  const cards = new Map<number, Card>();
  const landed = new Map<number, number>();   // my landings: ticket → column
  let drag: { i: number; pid: number; dx: number; dy: number } | null = null;
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as KanbanView | null;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };
  const playing = () => { const v = gv(); return !!v && v.phase === 'play' && canPlay(app); };

  // My score and streak, from my landings in deck order: instant, no round trip.
  function tally(v: KanbanView) {
    let score = 0, streak = 0;
    const all = new Map([...Object.entries(v.mine).map(([i, c]) => [Number(i), c] as [number, number]), ...landed]);
    for (const [i, col] of [...all].sort((a, b) => a[0] - b[0])) {
      const right = v.deck[i].cat === col;
      score += points(right, streak);
      streak = right ? streak + 1 : 0;
    }
    return { score, streak };
  }

  function land(v: KanbanView, i: number, c: Card) {
    c.col = nearest(c.x);
    c.x = center(c.col);
    c.landedAt = performance.now();
    const streak = tally(v).streak, right = v.deck[i].cat === c.col;
    landed.set(i, c.col);
    app.net.game({ k: 'sort', i, col: c.col });
    c.el.classList.add(right ? 'right' : 'wrong');
    c.el.innerHTML = right ? `✓ +${points(true, streak)}` : `✗ ${KANBAN.wrong}`;
    if (drag?.i === i) drag = null;
  }

  // The ticket most in need of a decision: the lowest one still falling.
  const lowest = () => [...cards.entries()].filter(([, c]) => !c.landedAt).sort((a, b) => b[1].y - a[1].y)[0];

  function frame() {
    raf = requestAnimationFrame(frame);
    const v = gv();
    if (!v || board.hidden) return;
    const el = app.now() - v.startAt, t = performance.now(), H = board.clientHeight;
    v.deck.forEach((tk, i) => {
      if (el < tk.at || (landed.has(i) || i in v.mine) && !cards.has(i)) return;
      let c = cards.get(i);
      if (!c) {
        const div = document.createElement('div');
        div.className = 'kb-card';
        div.dataset.i = String(i);
        div.textContent = tk.text;
        board.appendChild(div);
        c = { el: div, x: center(tk.col), col: tk.col, minY: 0, y: 0, landedAt: 0 };
        cards.set(i, c);
      }
      if (c.landedAt) {
        if (t - c.landedAt > SHOW_MS) { c.el.remove(); cards.delete(i); }
        return;
      }
      c.y = Math.max((el - tk.at) / tk.fall, c.minY);
      if (c.y >= 1 && v.phase !== 'count') land(v, i, c);
      c.el.classList.toggle('held', drag?.i === i);
      c.el.style.left = `${c.x * 100}%`;
      // From fully on the board at the top to its bottom edge on the line.
      c.el.style.top = `${Math.min(1, c.y) * (LINE * H - c.el.offsetHeight)}px`;
    });
  }

  // The falling ticket under a touch, or failing that the nearest one within reach.
  function grab(x: number, y: number): [number, Card] | null {
    let best: [number, Card] | null = null, bestD = REACH;
    for (const [i, c] of cards) {
      if (c.landedAt) continue;
      const r = c.el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d <= bestD) { best = [i, c]; bestD = d; }
    }
    return best;
  }
  const frac = (e: PointerEvent) => { const r = board.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };

  function onDown(e: PointerEvent) {
    const v = gv();
    if (!v || !playing()) return;
    const p = frac(e), near = grab(e.clientX, e.clientY);
    if (near) {
      const [i, c] = near;
      e.preventDefault();
      drag = { i, pid: e.pointerId, dx: p.x - c.x, dy: p.y - c.y * LINE };
      board.setPointerCapture(e.pointerId);
      return;
    }
    // A tap on a column sends the lowest ticket there.
    const lo = lowest();
    if (lo) { lo[1].col = nearest(p.x); lo[1].x = center(lo[1].col); }
  }
  function onMove(e: PointerEvent) {
    const c = drag && e.pointerId === drag.pid ? cards.get(drag.i) : null;
    if (!c || c.landedAt) return;
    const p = frac(e);
    c.x = Math.max(center(0), Math.min(center(2), p.x - drag!.dx));
    c.minY = Math.max(c.minY, (p.y - drag!.dy) / LINE);   // pull it down to file it sooner
  }
  function onUp(e: PointerEvent) {
    const c = drag && e.pointerId === drag.pid ? cards.get(drag.i) : null;
    drag = null;
    if (c && !c.landedAt) { c.col = nearest(c.x); c.x = center(c.col); }
  }
  // Laptops: ←/→ move the lowest ticket, ↓ or Space files it now.
  function onKey(e: KeyboardEvent) {
    const lo = playing() ? lowest() : null;
    if (!lo) return;
    const c = lo[1];
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { c.col = Math.max(0, Math.min(2, c.col + (e.code === 'ArrowLeft' ? -1 : 1))); c.x = center(c.col); }
    else if (e.code === 'ArrowDown' || e.code === 'Space') c.minY = 1;
    else return;
    e.preventDefault();
  }

  return {
    mount(r, a) {
      root = r; app = a;
      root.className = 'kanban';
      root.innerHTML = `<div class="kb-head"></div><div class="kb-me"></div>
        <div class="kb-board">${KANBAN.cols.map((c, i) => `<div class="kb-col" style="--i:${i}"><b>${c}</b></div>`).join('')}<div class="kb-line"></div></div>
        <div class="kb-scores"></div><div class="kb-foot"></div>`;
      board = root.querySelector('.kb-board')!;
      board.addEventListener('pointerdown', onDown);
      board.addEventListener('pointermove', onMove);
      board.addEventListener('pointerup', onUp);
      board.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKey);
      raf = requestAnimationFrame(frame);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      if (v.startAt !== startAt) { startAt = v.startAt; landed.clear(); for (const c of cards.values()) c.el.remove(); cards.clear(); drag = null; }
      const play = canPlay(app);
      set('.kb-head', `<div class="stagehead"><span class="muted">🗂️ Kanban Rush</span>${v.phase === 'count' ? `<span class="hk-count">Go in ${countdown(v.startAt)}</span>` : v.phase === 'play' ? timer(v.endAt, KANBAN.playMs) : '<span>⏰ Sprint over</span>'}</div>`);
      board.hidden = !play;
      const { score, streak } = tally(v);
      set('.kb-me', play ? `<div class="kb-tally"><b>${fmt(score)}</b>${streak > 1 ? `<span class="kb-streak">🔥 ${streak} in a row</span>` : ''}</div>` : '');
      const rows = [...v.scores].sort((x, y) => y.score - x.score);
      set('.kb-scores', `<div class="gains">${rows.map(s => chip(app.player(s.id), `<em>${fmt(s.score)}</em>${s.streak > 2 ? `<span class="muted">🔥${s.streak}</span>` : ''}`)).join('')}</div>`);
      set('.kb-foot', play ? `<p class="center muted">Drag each ticket into the right column before it hits the line. ${esc(KANBAN.cols.join(' · '))}. Tap a column or use ← → to move the lowest one.</p>` : '');
    },
    unmount() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
};

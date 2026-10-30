// Draw Off: draw the word on your own canvas for 30s, then vote on the anonymous
// gallery. The wall's canvases are built once, when the server sends the drawings;
// state updates only touch the captions (votes, and the artists at the reveal).
import { chip, esc, fmt, tickTimers, timer, type App, type GameClient } from '../../app.ts';
import { canPlay } from './wrap.ts';
import { paint, pen, toolsHtml, type Pen, type Stroke } from './ink.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWX';

export const galleryGame = (): GameClient => {
  let root: HTMLElement, app: App;
  let pn: Pen | null = null;
  const mine = new Map<string, Stroke>();
  let wall: Array<{ slot: number; strokes: Stroke[] }> = [];
  let wallBuilt = false, queued = false;
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as any;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };
  const repaintMine = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const cv = root.querySelector<HTMLCanvasElement>('.gal-pad canvas'); if (cv) paint(cv, mine.values()); });
  };

  function buildWall() {
    if (!wall.length || wallBuilt) return;
    wallBuilt = true;
    const el = root.querySelector('.gal-wall')!;
    el.innerHTML = wall.map(d => `<div class="gal-card" data-slot="${d.slot}"><canvas width="500" height="500"></canvas><div class="gal-cap"></div></div>`).join('');
    for (const d of wall) paint(el.querySelector<HTMLCanvasElement>(`[data-slot="${d.slot}"] canvas`)!, d.strokes);
  }

  function captions() {
    const v = gv();
    for (const d of wall) {
      const cap = root.querySelector(`[data-slot="${d.slot}"] .gal-cap`);
      if (!cap) continue;
      const letter = `<b class="gal-letter">${LETTERS[d.slot]}</b>`;
      let html: string;
      if (v.step === 'rev') {
        const artist = v.artists[d.slot], n = v.counts[d.slot];
        const top = n > 0 && n === Math.max(...v.counts);
        html = `${letter}${chip(app.player(artist))}<span>${top ? '🏆 ' : ''}${n} vote${n === 1 ? '' : 's'}</span>`;
      } else if (d.slot === v.mySlot) html = `${letter}<span class="muted">Yours. Act natural.</span>`;
      else if (v.myVote === d.slot) html = `${letter}<span class="voted">✅ Your vote</span>`;
      else html = `${letter}${canPlay(app) && v.myVote === null ? `<button class="ghost" data-vote="${d.slot}">Vote</button>` : ''}`;
      if (cap.innerHTML !== html) cap.innerHTML = html;
      cap.parentElement!.classList.toggle('picked', v.myVote === d.slot);
    }
  }

  // Named so the click handler can be removed: #game is shared by every round.
  let onClick = (_e: Event) => {};
  const client: GameClient = {
    mount(r, a) {
      root = r; app = a;
      root.className = 'gallery';
      root.innerHTML = `<div class="gal-head"></div>
        <div class="gal-pad"><canvas width="1000" height="1000"></canvas><div class="g-tools"></div></div>
        <div class="gal-wait"></div>
        <div class="gal-wall"></div>`;
      const cv = root.querySelector<HTMLCanvasElement>('.gal-pad canvas')!;
      pn = pen(cv, mine, () => gv()?.step === 'draw' && gv().drawing, repaintMine,
        (id, st, pts) => app.net.game({ k: 'ink', id, c: st.c, w: st.w, pts }));
      repaintMine();
      onClick = (e: Event) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (!b || !pn) return;
        if (b.dataset.c) pn.color = b.dataset.c;
        if (b.dataset.w) pn.size = Number(b.dataset.w);
        if (b.hasAttribute('data-clear')) { mine.clear(); repaintMine(); app.net.game({ k: 'clear' }); }
        if (b.dataset.vote) app.net.game({ k: 'vote', slot: Number(b.dataset.vote) });
        client.update(app);
      };
      root.addEventListener('click', onClick);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      const drawing = v.step === 'draw';
      const head = drawing ? `Draw <b>${esc(v.word)}</b>` : v.step === 'vote' ? `Which <b>${esc(v.word)}</b> is best? <span class="muted">${v.voted.length} voted</span>` : `The artists behind the ${esc(v.word)}s`;
      set('.gal-head', `<div class="stagehead"><span class="muted">🖼️ Draw Off</span>${timer(v.endsAt, v.durMs)}</div><h2 class="prompt">${head}</h2>`);
      root.querySelector<HTMLElement>('.gal-pad')!.style.display = drawing && v.drawing ? '' : 'none';
      set('.g-tools', drawing && v.drawing && pn ? toolsHtml(pn) : '');
      set('.gal-wait', drawing && !v.drawing ? '<p class="center muted">The artists are drawing. The gallery opens in a moment.</p>' : '');
      if (!drawing) { buildWall(); captions(); }
      if (v.step === 'rev' && v.scores) {
        const rows = Object.entries(v.scores as Record<string, number>).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
        set('.gal-wait', rows.length ? `<div class="gains">${rows.map(([id, n]) => chip(app.player(id), `<em>+${fmt(n)}</em>`)).join('')}</div>` : '');
      }
    },
    raw(m) {
      if (m.t !== 'gallery') return;
      wall = m.drawings;
      wallBuilt = false;
      buildWall();
      captions();
    },
    unmount() { pn?.stop(); root.removeEventListener('click', onClick); root.innerHTML = ''; },
  };
  return client;
};

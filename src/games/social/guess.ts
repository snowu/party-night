// Draw It and Hum & Mime. Unlike the other social rounds this screen isn't
// re-rendered wholesale: the drawing canvas has to survive every state message,
// so only the small regions around it are refreshed.
import { chip, esc, fmt, timer, type App, type GameClient } from '../../app.ts';
import { canPlay } from './wrap.ts';
import { paint, pen, toolsHtml, type Pen, type Stroke } from './ink.ts';

export const guessGame = (): GameClient => {
  let root: HTMLElement, app: App;
  let cv: HTMLCanvasElement | null = null;
  let pn: Pen | null = null;
  const strokes = new Map<string, Stroke>();
  let paintQueued = false;
  const last: Record<string, string> = {};

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) el.innerHTML = html;
  };
  const queuePaint = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; if (cv) paint(cv, strokes.values()); });
  };
  const artist = () => !!app.s.gv && (app.s.gv as any).artist === app.me;

  function tools() {
    if (!pn || !artist() || (app.s.gv as any).step !== 'q') return '';
    return toolsHtml(pn);
  }

  // Named so the click handler can be removed: #game is shared by every round.
  let onClick = (_e: Event) => {};
  const client: GameClient = {
    mount(r, a) {
      root = r; app = a;
      const gv = a.s.gv as any;
      root.className = 'guess';
      root.innerHTML = `<div class="g-head"></div><div class="g-secret"></div>
        <div class="g-main">
          <div class="g-board">${gv.mode === 'draw' ? '<canvas width="1000" height="1000"></canvas>' : '<div class="g-perform"></div>'}<div class="g-tools"></div></div>
          <div class="g-side"><form class="g-form row"><input id="guess" autocomplete="off" maxlength="40" placeholder="Type a guess"><button class="big">Go</button></form><div class="g-feed"></div></div>
        </div>`;
      cv = root.querySelector('canvas');
      if (cv) pn = pen(cv, strokes, () => artist() && (app.s.gv as any).step === 'q', queuePaint,
        (id, st, pts) => app.net.game({ k: 'ink', id, c: st.c, w: st.w, pts }));
      queuePaint();
      root.querySelector('.g-form')!.addEventListener('submit', e => {
        e.preventDefault();
        const i = root.querySelector<HTMLInputElement>('#guess')!;
        if (i.value.trim()) app.net.game({ k: 'guess', text: i.value.trim() });
        i.value = '';
      });
      onClick = (e: Event) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button');
        if (!b) return;
        if (b.dataset.c && pn) pn.color = b.dataset.c;
        if (b.dataset.w && pn) pn.size = Number(b.dataset.w);
        if (b.hasAttribute('data-clear')) { strokes.clear(); queuePaint(); app.net.game({ k: 'clear' }); }
        if (b.hasAttribute('data-pass')) app.net.game({ k: 'pass' });
        client.update(app);
      };
      root.addEventListener('click', onClick);
      this.update(a);
    },
    update(a) {
      app = a;
      const gv = a.s.gv as any;
      if (!gv) return;
      const art = a.player(gv.artist);
      const icon = gv.mode === 'draw' ? '🎨' : '🎤';
      set('.g-head', `<div class="stagehead"><span class="muted">${icon} ${chip(art)} ${gv.mode === 'draw' ? 'is drawing' : `is performing a ${esc(gv.type)}`}</span>${timer(gv.endsAt, gv.durMs)}</div>`);
      const secret = gv.step === 'rev' ? `It was <b>${esc(gv.secret)}</b>`
        : gv.secret ? `${gv.artist === a.me ? (gv.mode === 'draw' ? 'Draw' : 'Hum and mime') : 'Got it:'} <b>${esc(gv.secret)}</b>`
        : `<span class="hint">${esc(gv.hint).replace(/ /g, '&nbsp;&nbsp;')}</span>`;
      set('.g-secret', secret);
      set('.g-tools', tools());
      if (gv.mode === 'perform') {
        set('.g-perform', gv.artist === a.me && gv.step === 'q'
          ? `<p>Unmute and perform <b>${esc(gv.secret)}</b> on the call. No words from the title!</p>${gv.passesLeft > 0 && !gv.got.length ? `<button class="ghost" data-pass>🙈 Don't know it (${gv.passesLeft} left)</button>` : ''}`
          : `<div class="stage-emoji">🎤</div><p>Watch the call and type your guess.</p>`);
      }
      const canGuess = canPlay(a) && gv.artist !== a.me && !gv.got.includes(a.me) && gv.step === 'q';
      root.querySelector<HTMLElement>('.g-form')!.style.display = canGuess ? '' : 'none';
      const feed = gv.feed.map((f: any) => f.text ? `<div>${chip(a.player(f.id))} <span>${esc(f.text)}</span></div>` : `<div class="got">✅ ${chip(a.player(f.id))} got it!</div>`).reverse().join('');
      const scores = gv.scores ? `<div class="gains">${Object.entries(gv.scores as Record<string, number>).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([id, n]) => chip(a.player(id), `<em>+${fmt(n)}</em>`)).join('')}</div>` : '';
      set('.g-feed', scores + feed);
    },
    raw(m) {
      if (m.t === 'ink') {
        const s = strokes.get(m.id);
        if (s) s.pts.push(...m.pts); else strokes.set(m.id, { c: m.c, w: m.w, pts: [...m.pts] });
      } else if (m.t === 'inkClear') strokes.clear();
      else if (m.t === 'inkAll') { strokes.clear(); for (const s of m.strokes) strokes.set(s.id, { c: s.c, w: s.w, pts: s.pts }); }
      else return;
      queuePaint();
    },
    unmount() { pn?.stop(); root.removeEventListener('click', onClick); root.innerHTML = ''; cv = null; },
  };
  return client;
};

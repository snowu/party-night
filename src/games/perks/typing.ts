// Typing Race (client). The passage is checked letter by letter on my own
// screen, so my lane moves the moment I type; the server only hears how far I
// am (every TYPING.sendMs) and moves everyone else's lane from that.
import { TYPING, norm, wpm, type TypingView } from '../../../shared/typing.ts';
import { countdown, esc, face, tickTimers, timer, type App, type GameClient } from '../../app.ts';
import { canPlay } from '../social/wrap.ts';

export const typingGame = (): GameClient => {
  let root: HTMLElement, app: App, input: HTMLInputElement;
  let raf = 0, text = '', n = 0, e = 0, sentN = 0, lastSent = 0, missAt = 0, lanesKey = '';
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as TypingView | null;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };
  const racing = () => gv()?.phase === 'race' && canPlay(app) && n < text.length;

  // The passage: done in green, the next letter under a cursor, the rest dim.
  function drawText() {
    const cur = text[n] === ' ' ? '␣' : esc(text[n] ?? '');
    const miss = performance.now() - missAt < 250 ? ' miss' : '';
    set('.ty-text', `<span class="ty-done">${esc(text.slice(0, n))}</span>${n < text.length ? `<span class="ty-cur${miss}">${cur}</span>` : ''}<span class="ty-rest">${esc(text.slice(n + 1))}</span>`);
  }

  // Lanes: built once a round, then only the runners move.
  function drawLanes(v: TypingView) {
    const key = v.lanes.map(l => l.id).join();
    const track = root.querySelector<HTMLElement>('.ty-track')!;
    if (key !== lanesKey) {
      lanesKey = key;
      track.innerHTML = v.lanes.map(l => {
        const p = app.player(l.id);
        return `<div class="ty-lane${l.id === app.me ? ' me' : ''}" data-id="${esc(l.id)}" style="--c:${p?.color ?? '#888'}"><span class="ty-run">${p ? face(p) : ''}</span><i class="ty-stat"></i></div>`;
      }).join('');
    }
    for (const l of v.lanes) {
      const el = track.querySelector<HTMLElement>(`[data-id="${CSS.escape(l.id)}"]`);
      if (!el) continue;
      const done = l.id === app.me && canPlay(app) ? Math.max(n, l.n) : l.n;
      el.style.setProperty('--x', String(text.length ? done / text.length : 0));
      // The name at the end of the lane, until they get there: then their speed.
      const stat = el.querySelector('i')!, s = l.ms !== null ? `🏁 ${wpm(text.length, l.ms)} wpm` : app.player(l.id)?.name ?? '';
      if (stat.textContent !== s) { stat.textContent = s; stat.classList.toggle('fin', l.ms !== null); }
    }
  }

  function onInput() {
    const typed = input.value;
    input.value = '';
    if (!racing()) return;
    for (const ch of typed) {
      if (n >= text.length) break;
      if (norm(ch) === norm(text[n])) n++;
      else { e++; missAt = performance.now(); }
    }
    drawText();
    drawLanes(gv()!);
    if (n === text.length) report();
  }

  function report() {
    if (n === sentN) return;
    sentN = n; lastSent = performance.now();
    app.net.game({ k: 'pos', n, e });
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    if (n !== sentN && t - lastSent >= TYPING.sendMs) report();
    if (missAt && t - missAt > 250) { missAt = 0; drawText(); }
  }

  // Keys pressed anywhere go to the box, so a laptop can just start typing.
  const onKey = (ev: KeyboardEvent) => {
    if (racing() && document.activeElement !== input && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) input.focus();
  };
  const onTap = () => { if (racing()) input.focus(); };
  const noPaste = (ev: Event) => ev.preventDefault();

  return {
    mount(r, a) {
      root = r; app = a;
      root.className = 'typing';
      root.innerHTML = `<div class="ty-head"></div><div class="ty-track"></div><div class="ty-text"></div>
        <input class="ty-in" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" aria-label="Type here"><div class="ty-foot"></div>`;
      input = root.querySelector('.ty-in')!;
      input.addEventListener('input', onInput);
      input.addEventListener('paste', noPaste);
      input.addEventListener('drop', noPaste);
      root.addEventListener('pointerdown', onTap);
      window.addEventListener('keydown', onKey);
      raf = requestAnimationFrame(frame);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      if (v.text !== text) { text = v.text; n = 0; e = 0; sentN = 0; lanesKey = ''; }
      const mine = v.lanes.find(l => l.id === app.me);
      if (mine && mine.n > n) n = mine.n;   // back after a reload
      set('.ty-head', `<div class="stagehead"><span class="muted">⌨️ Typing Race</span>${v.phase === 'count' ? `<span class="hk-count">Go in ${countdown(v.startAt)}</span>` : v.phase === 'race' ? timer(v.endAt, TYPING.raceMs) : '<span>🏁 Finished</span>'}</div>`);
      drawLanes(v);
      drawText();
      const play = canPlay(app);
      input.hidden = !play;
      // Open during the countdown (typing is ignored until Go), so a phone's keyboard can be up in time.
      input.disabled = v.phase === 'done' || n >= text.length;
      input.placeholder = v.phase === 'count' ? 'Get ready…' : n >= text.length ? '🏁 Done!' : 'Type here';
      if (racing() && document.activeElement !== input && !app.tv) input.focus();
      set('.ty-foot', !play ? '<p class="center muted">Every right letter moves a player along.</p>'
        : n >= text.length ? `<p class="center">🏁 Finished${e ? ` with ${e} typo${e === 1 ? '' : 's'}` : ' without a typo'}. Waiting for the others.</p>`
        : '<p class="center muted">Type the text above. A wrong key doesn\'t move you. Capitals don\'t matter.</p>');
    },
    unmount() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
};

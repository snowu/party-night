// Incident Response: the page fires at gv.fireAt (server clock). A frame loop flips
// the pad to red the moment it does, and the reaction time is measured from that
// frame to your tap, on your own screen, so network lag doesn't count.
import { chip, esc, fmt, tickTimers, type App, type GameClient } from '../../app.ts';
import { gains, head, waiting } from './views.ts';
import { canPlay } from './wrap.ts';

export const incidentGame = (): GameClient => {
  let root: HTMLElement, app: App;
  let raf = 0, stage = -1, shownAt = 0, sent = false;
  const last: Record<string, string> = {};
  const gv = () => app.s.gv as any;

  const set = (sel: string, html: string) => {
    if (last[sel] === html) return;
    last[sel] = html;
    const el = root.querySelector(sel);
    if (el) { el.innerHTML = html; tickTimers(app.now()); }
  };

  const live = () => { const v = gv(); return v && v.step === 'q' && v.mine === null && !sent && canPlay(app); };

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const v = gv();
    const pad = root.querySelector<HTMLElement>('.inc-pad');
    if (!v || !pad) return;
    const firing = v.step === 'q' && app.now() >= v.fireAt;
    if (firing && !shownAt) shownAt = t;
    pad.classList.toggle('alarm', firing && v.mine === null && !sent);
    pad.classList.toggle('done', v.mine !== null || sent);
    pad.hidden = v.step === 'rev';
    const text = v.mine === 'early' ? '🙈 False alarm. Wait for the page next time.'
      : typeof v.mine === 'number' ? `✅ Acked in <b>${v.mine}ms</b>`
      : firing ? `🚨 ${esc(v.alert)}<small>${canPlay(app) ? 'ACK! Tap now' : 'Paging…'}</small>`
      : `🟢 All systems nominal<small>${canPlay(app) ? 'Tap the moment this turns red' : 'Waiting for something to break'}</small>`;
    if (pad.dataset.html !== text) { pad.dataset.html = text; pad.innerHTML = text; }
  }

  function ack() {
    if (!live()) return;
    sent = true;
    const v = gv();
    app.net.game({ k: 'ans', i: v.stage, v: shownAt ? Math.round(performance.now() - shownAt) : 'early' });
  }
  const onPointer = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.inc-pad')) { e.preventDefault(); ack(); } };
  const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); ack(); } };

  return {
    mount(r, a) {
      root = r; app = a;
      root.className = 'social incident';
      root.innerHTML = `<div class="inc-head"></div><button class="inc-pad"></button><div class="inc-foot"></div>`;
      root.addEventListener('pointerdown', onPointer);
      window.addEventListener('keydown', onKey);
      raf = requestAnimationFrame(frame);
      this.update(a);
    },
    update(a) {
      app = a;
      const v = gv();
      if (!v) return;
      if (v.stage !== stage) { stage = v.stage; shownAt = 0; sent = false; }
      set('.inc-head', head(v, 'Page'));
      const rev = v.step === 'rev' ? v.rev : null;
      set('.inc-foot', rev
        ? `<p class="center muted">${esc(v.alert)}</p><div class="gains">${rev.acks.map((x: any) => chip(app.player(x.id), `<span class="muted">${fmt(x.ms)}ms</span><em>+${fmt(rev.gains[x.id] ?? 0)}</em>`)).join('')}${rev.early.map((id: string) => chip(app.player(id), '<span class="muted">🙈 false alarm</span>')).join('')}</div>${rev.acks.length || rev.early.length ? '' : gains(app, {})}`
        : waiting(app, v));
    },
    unmount() {
      cancelAnimationFrame(raf);
      root.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    },
  };
};

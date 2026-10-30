// Social rounds are plain HTML re-rendered from each state message. The wrapper
// only touches the DOM when the markup changes, keeps whatever you were typing,
// and routes clicks/submits on [data-act] elements to the view.
import { tickTimers, type App, type GameClient } from '../../app.ts';

export interface SocialView {
  render(app: App, gv: any): string;
  act?(app: App, act: string, el: HTMLElement, gv: any): void;
}

export function social(view: SocialView): () => GameClient {
  return () => {
    let root: HTMLElement;
    let app: App;
    let last = '';
    const onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || el.tagName === 'FORM' || (el as HTMLButtonElement).disabled) return;
      view.act?.(app, el.dataset.act!, el, app.s.gv);
      client.update(app);   // local choices (agree before locking in) redraw straight away
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      const el = e.target as HTMLElement;
      if (el.dataset.act) view.act?.(app, el.dataset.act, el, app.s.gv);
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.dataset.live) view.act?.(app, el.dataset.live, el, app.s.gv);
    };
    const client: GameClient = {
      mount(r, a) {
        root = r; app = a;
        root.className = 'social';
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);
        root.addEventListener('input', onInput);
        this.update(a);
      },
      update(a) {
        app = a;
        if (!a.s.gv) return;
        const html = view.render(a, a.s.gv);
        if (html === last) return;
        last = html;
        // Keep the field you're typing in: id, value and caret survive the re-render.
        const f = document.activeElement as HTMLInputElement | null;
        const keep = f && root.contains(f) && f.id ? { id: f.id, v: f.value, at: f.selectionStart } : null;
        const values = [...root.querySelectorAll<HTMLInputElement>('input[id],textarea[id]')].map(i => [i.id, i.value] as const);
        root.innerHTML = html;
        tickTimers(a.now());   // a fresh bar starts at the right width, not full
        for (const [id, v] of values) { const i = root.querySelector<HTMLInputElement>(`#${id}`); if (i && i.type !== 'range') i.value = v; }
        if (keep) {
          const i = root.querySelector<HTMLInputElement>(`#${keep.id}`);
          if (i) { i.focus(); try { i.setSelectionRange(keep.at, keep.at); } catch {} }
        }
      },
      unmount() {
        root.removeEventListener('click', onClick);
        root.removeEventListener('submit', onSubmit);
        root.removeEventListener('input', onInput);
        root.innerHTML = '';
      },
    };
    return client;
  };
}

export const canPlay = (app: App) => !!app.me && app.s.participants.includes(app.me);

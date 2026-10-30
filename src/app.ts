// Shared client plumbing: the App handle every screen and game gets, and small
// DOM helpers.
import type { PlayerPub, ShellState } from '../shared/protocol.ts';
import type { Net } from './net.ts';

export interface App {
  net: Net;
  s: ShellState;
  me: string | null;              // null on the spectator screen
  tv: boolean;
  now(): number;                  // server clock
  player(id: string): PlayerPub | undefined;
  isHost(): boolean;
  toast(text: string): void;
}

// The minigame client contract. Games own `root` while mounted.
export interface GameClient {
  mount(root: HTMLElement, app: App): void;
  update(app: App): void;                         // every state message
  raw?(m: any): void;                             // non-state server messages (ink)
  bc?(from: string, e: string, p: any): void;     // relayed from another client
  unmount(): void;
}

export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const avatarSrc = (key: string) => `assets/avatars/${key}.svg`;

// A player chip: sprite in their colour ring, hat on top, name.
export function chip(p: PlayerPub | undefined, extra = ''): string {
  if (!p) return '';
  return `<span class="chip${p.connected ? '' : ' off'}" style="--c:${p.color}">${face(p)}<b>${esc(p.name)}</b>${extra}</span>`;
}
export const face = (p: PlayerPub, cls = '') =>
  `<span class="face ${cls}" style="--c:${p.color}"><img src="${avatarSrc(p.avatar)}" alt="">${p.hat ? `<i>${p.hat}</i>` : ''}</span>`;

// A shrinking bar for a deadline in server time; the shell's ticker keeps it moving.
export const timer = (endsAt: number, durMs: number) => `<div class="timer" data-ends="${endsAt}" data-dur="${durMs}"><i></i></div>`;
export const countdown = (endsAt: number) => `<span data-count="${endsAt}"></span>`;

export function tickTimers(now: number) {
  for (const el of document.querySelectorAll<HTMLElement>('.timer')) {
    const left = Math.max(0, Number(el.dataset.ends) - now);
    (el.firstElementChild as HTMLElement).style.width = `${Math.min(100, (100 * left) / Number(el.dataset.dur))}%`;
    el.classList.toggle('low', left < 4000);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    el.textContent = String(Math.max(0, Math.ceil((Number(el.dataset.count) - now) / 1000)));
  }
}

export const fmt = (n: number) => n.toLocaleString('en-US');

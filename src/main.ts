// ─── PARTY NIGHT (client) ─────────────────────────────────────────────────────
// Boot, the landing page, and the shell: one socket into the room, the screens
// between rounds, and mounting each round's minigame client while it's in play.
import { CODE_ALPHABET, type ShellState } from '../shared/protocol.ts';
import { esc, tickTimers, type App, type GameClient } from './app.ts';
import { Net, httpUrl } from './net.ts';
import { intro, landing, lobby, podium, results, standingsTable, topbar } from './shell/screens.ts';
import { birdGame } from './games/bird/client.ts';
import { SOCIAL } from './games/social/views.ts';
import { guessGame } from './games/social/guess.ts';
import { galleryGame } from './games/social/gallery.ts';
import { incidentGame } from './games/social/incident.ts';
import { SATIRE } from './games/social/satire.ts';
import { photoFinish } from './shell/photo.ts';

const GAMES: Record<string, () => GameClient> = {
  race: birdGame,
  ...SOCIAL,
  draw: guessGame,
  perform: guessGame,
  gallery: galleryGame,
  ...SATIRE,
  incident: incidentGame,
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const params = new URLSearchParams(location.search);
const tv = params.get('tv') === '1';
// Dev hooks for the browser tests: always on localhost, and on the live site with ?dev=1.
const local = !location.hostname.endsWith('github.io') || params.get('dev') === '1';

function store(k: string, v?: string) {
  try { if (v === undefined) return localStorage.getItem(k) ?? ''; localStorage.setItem(k, v); } catch {}
  return '';
}

// ── toasts ──
function toast(text: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3500);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild!.remove();
}

// Swap in new markup only when it changed, keeping the field you're typing in.
const lastHtml = new WeakMap<HTMLElement, string>();
function patch(el: HTMLElement, html: string) {
  if (lastHtml.get(el) === html) return false;
  lastHtml.set(el, html);
  const f = document.activeElement as HTMLInputElement | null;
  const keep = f && el.contains(f) && f.id ? { id: f.id, v: f.value } : null;
  el.innerHTML = html;
  if (app?.s) tickTimers(app.now());
  if (keep) { const i = el.querySelector<HTMLInputElement>(`#${keep.id}`); if (i) { i.value = keep.v; i.focus(); } }
  return true;
}

// ── landing ──
async function showLanding() {
  const room = (params.get('room') ?? '').toUpperCase().slice(0, 4);
  const render = (hof: unknown) => patch($('#screen'), landing(hof, room));
  render(null);
  fetch(`${httpUrl()}/api/hof`).then(r => r.json()).then(render).catch(() => {});
  $('#screen').onsubmit = e => {
    e.preventDefault();
    const name = ($('#name') as HTMLInputElement).value.trim().slice(0, 16);
    let code = ($('#code') as HTMLInputElement).value.trim().toUpperCase();
    if (!name) return;
    if (!/^[A-Z]{4}$/.test(code)) code = Array.from(crypto.getRandomValues(new Uint8Array(4)), x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
    store('pn-name', name);
    history.replaceState(null, '', `?room=${code}`);
    enter(code, name);
  };
}

// ── the room ──
let app: App;
let game: GameClient | null = null;
let gameKey = '';

function enter(code: string, name: string) {
  let pid = store('pn-pid');
  if (!pid) { pid = crypto.randomUUID(); store('pn-pid', pid); }
  const query = tv ? 'tv=1' : `pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`;
  document.body.classList.toggle('tv', tv);
  const net = new Net(query, {
    state: s => onState(s),
    bc: (from, e, p) => game?.bc?.(from, e, p),
    event: toast,
    raw: m => game?.raw?.(m),
    status: (up, why) => {
      document.body.classList.toggle('offline', !up);
      if (why) patch($('#screen'), `<div class="landing"><h1 class="brand">Party Night</h1><p class="center">Disconnected: ${esc(why)}</p><a class="big" href="./">Back</a></div>`);
    },
  }, code);
  app = {
    net, s: null as unknown as ShellState, me: tv ? null : pid, tv,
    now: net.now,
    player: id => app.s.players.find(p => p.id === id),
    isHost: () => !!app.me && app.s.hostId === app.me,
    toast,
  };
  net.connect();
  if (!tv) {
    // Re-send the saved look once connected, so a reconnect keeps it.
    const look = JSON.parse(store('pn-look') || '{}');
    const once = setInterval(() => { if (app.s) { net.send({ t: 'set', ...look }); clearInterval(once); } }, 200);
  }
  if (local) Object.assign(window, { devApp: () => app, devState: () => app.s, devGame: () => game });
}

function onState(s: ShellState) {
  app.s = s;
  document.body.dataset.phase = s.phase;
  patch($('#top'), topbar(app));
  if (tv) patch($('#side'), `<h2>Room ${s.code}</h2>${standingsTable(app, 16)}`);

  // Mount the round's minigame while it's in play; tear it down after.
  const key = s.phase === 'play' && s.game ? `${s.round}:${s.game.id}:${s.seed}` : '';
  if (key !== gameKey) {
    game?.unmount();
    game = null;
    gameKey = key;
    if (key && GAMES[s.game!.id]) {
      game = GAMES[s.game!.id]();
      game.mount($('#game'), app);
    }
  } else game?.update(app);

  const screen = s.phase === 'lobby' ? (tv ? `<div class="intro"><h1 class="brand">Party Night</h1><p>Join at <b>${esc(location.origin + location.pathname)}?room=${s.code}</b></p><div class="roomcode">${s.code}</div></div>` : lobby(app))
    : s.phase === 'intro' ? intro(app)
    : s.phase === 'results' && s.outcome ? results(app)
    : s.phase === 'podium' ? podium(app) : '';
  if (patch($('#screen'), screen)) {
    const pf = document.querySelector<HTMLCanvasElement>('canvas.photofinish');
    if (pf) photoFinish(pf, app);
  }
}

// ── clicks on shell screens ──
function look(k: string, v: unknown) {
  const cur = JSON.parse(store('pn-look') || '{}');
  cur[k] = v;
  store('pn-look', JSON.stringify(cur));
  app.net.send({ t: 'set', [k]: v });
}

document.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || !app?.s || el.closest('#game')) return;
  const act = el.dataset.act!, v = el.dataset.v ?? '';
  const host = (op: string, extra = {}) => app.net.host(op, extra);
  switch (act) {
    case 'avatar': case 'color': case 'hat': look(act, v); break;
    case 'performer': look('performer', (el as HTMLInputElement).checked); break;
    case 'copy': navigator.clipboard?.writeText(v).then(() => toast('🔗 Invite link copied')); break;
    case 'bot+': case 'bot-': case 'start': case 'next': case 'again': host(act); break;
    case 'skip': if (confirm('Skip this round? Nobody scores.')) host('skip'); break;
    case 'end': if (confirm('End the night now and go to the podium?')) host('end'); break;
    case 'rounds': host('settings', { rounds: Number(v) }); break;
    case 'game': {
      const on = (el as HTMLInputElement).checked;
      const games = app.s.settings.games.filter(g => g !== v).concat(on ? [v] : []);
      if (games.length) host('settings', { games });
      break;
    }
  }
});

// Timer bars move every frame (no CSS transition: a re-render would replay it).
const frame = () => { if (app?.s) tickTimers(app.now()); requestAnimationFrame(frame); };
requestAnimationFrame(frame);

// ── boot ──
const code = (params.get('room') ?? '').toUpperCase();
if (tv && /^[A-Z]{4}$/.test(code)) enter(code, '');
else if (/^[A-Z]{4}$/.test(code) && store('pn-name') && params.get('auto') !== '0' && store('pn-room') === code) enter(code, store('pn-name'));
else showLanding();
window.addEventListener('beforeunload', () => { if (app?.s) store('pn-room', app.s.code); });

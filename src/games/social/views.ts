// Screens for the staged social rounds (server: server/src/games/staged.ts and
// friends). Every view gets the same gv shape: stage, step ('q' | 'rev'), endsAt,
// answered ids, mine (my answer), rev (the stage's reveal) and scores.
import { chip, esc, face, fmt, timer, type App } from '../../app.ts';
import { canPlay, social, type SocialView } from './wrap.ts';

const head = (gv: any, label: string) =>
  `<div class="stagehead"><span class="muted">${label} ${gv.stage + 1}/${gv.stages}</span>${gv.step === 'q' ? timer(gv.endsAt, gv.stageMs) : '<div class="timer done"><i></i></div>'}</div>`;

// Who has answered (faces light up), so the room can see who they're waiting on.
function waiting(app: App, gv: any) {
  const ids = app.s.participants.filter(id => !gv.bench.includes(id));
  return `<div class="waiting">${ids.map(id => { const p = app.player(id); return p ? face(p, gv.answered.includes(id) ? 'in' : 'dim') : ''; }).join('')}</div>`;
}

function gains(app: App, g: Record<string, number>) {
  const rows = Object.entries(g).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="muted center">Nobody scored on that one.</p>';
  return `<div class="gains">${rows.map(([id, n]) => chip(app.player(id), `<em>+${fmt(n)}</em>`)).join('')}</div>`;
}

const ans = (app: App, i: number, v: unknown) => app.net.game({ k: 'ans', i, v });
const locked = (gv: any, app: App) => gv.mine !== null || !canPlay(app) || gv.step !== 'q' || gv.bench.includes(app.me);

// ── Pop Quiz ────────────────────────────────────────────────────────────────
export const quiz: SocialView = {
  render(app, gv) {
    const q = gv.q;
    let body: string;
    if (q.closest) {
      body = gv.step === 'rev'
        ? `<div class="bigans">${fmt(gv.rev.answer)}</div><div class="gains">${gv.rev.guesses.map((g: any) => chip(app.player(g.id), `<span class="muted">${fmt(g.v)}</span><em>+${fmt(gv.rev.gains[g.id] ?? 0)}</em>`)).join('')}</div>`
        : gv.mine !== null ? `<p class="center locked">Locked in: <b>${fmt(gv.mine)}</b></p>`
        : canPlay(app) ? `<form class="row" data-act="num"><input id="num" inputmode="decimal" autocomplete="off" placeholder="Your best guess"><button class="big">Lock in</button></form>` : '';
    } else {
      const rev = gv.step === 'rev' ? gv.rev : null;
      body = `<div class="opts">${q.options.map((o: string, i: number) => {
        const cls = rev ? (i === rev.correct ? 'right' : gv.mine === i ? 'wrong' : 'fade') : gv.mine === i ? 'picked' : '';
        return `<button class="opt o${i} ${cls}" data-act="ans" data-v="${i}" ${locked(gv, app) ? 'disabled' : ''}>${esc(o)}${rev ? `<small>${rev.counts[i]}</small>` : ''}</button>`;
      }).join('')}</div>${rev ? gains(app, rev.gains) : ''}`;
    }
    return `${head(gv, q.closest ? 'Closest wins ·' : 'Question')}<h2 class="prompt">${esc(q.text)}</h2>${body}${gv.step === 'q' ? waiting(app, gv) : ''}`;
  },
  act(app, act, el, gv) {
    if (act === 'ans') ans(app, gv.stage, Number(el.dataset.v));
    if (act === 'num') {
      const v = Number((el.querySelector('input') as HTMLInputElement).value.replace(/[,_ ]/g, ''));
      if (Number.isFinite(v)) ans(app, gv.stage, v);
    }
  },
};

// ── Approve or Deny ─────────────────────────────────────────────────────────
export const approve: SocialView = {
  render(app, gv) {
    const c = gv.card;
    const policy = JSON.stringify({ Version: '2012-10-17', Statement: c.statements }, null, 2);
    const rev = gv.step === 'rev' ? gv.rev : null;
    const btn = (v: boolean, label: string) => {
      const cls = rev ? (rev.allow === v ? 'right' : gv.mine === v ? 'wrong' : 'fade') : gv.mine === v ? 'picked' : '';
      return `<button class="opt ${v ? 'o3' : 'o0'} ${cls}" data-act="ans" data-v="${v}" ${locked(gv, app) ? 'disabled' : ''}>${label}</button>`;
    };
    return `${head(gv, 'Request')}
      <p class="request"><b>${esc(c.who)}</b> wants <code>${esc(c.action)}</code> on <code>${esc(c.resource)}</code></p>
      <pre class="policy">${esc(policy)}</pre>
      <div class="opts two">${btn(true, '✅ Approve')}${btn(false, '⛔ Deny')}</div>
      ${rev ? `<p class="why"><b>${rev.allow ? '✅ Allowed' : '⛔ Denied'}</b> · ${esc(rev.why)}</p>${gains(app, rev.gains)}` : waiting(app, gv)}`;
  },
  act(app, act, el, gv) { if (act === 'ans') ans(app, gv.stage, el.dataset.v === 'true'); },
};

// ── Hot Takes ───────────────────────────────────────────────────────────────
let takePick: { stage: number; agree: boolean | null; pct: number } = { stage: -1, agree: null, pct: 50 };
export const hottake: SocialView = {
  render(app, gv) {
    if (takePick.stage !== gv.stage) takePick = { stage: gv.stage, agree: null, pct: 50 };
    const rev = gv.step === 'rev' ? gv.rev : null;
    let body: string;
    if (rev) {
      // Each voter shows the share they guessed and what it earned, best guess first.
      const side = (ids: string[], label: string, cls: string) => `<div class="side ${cls}"><h3>${label} · ${ids.length}</h3>${
        [...ids].sort((a, b) => (rev.gains[b] ?? 0) - (rev.gains[a] ?? 0)).map(id =>
          chip(app.player(id), `<span class="muted">said ${rev.guesses[id]}%</span>${rev.gains[id] ? `<em>+${fmt(rev.gains[id])}</em>` : ''}`)).join('')
        || '<span class="muted">Nobody</span>'}</div>`;
      body = `<div class="split"><div class="yes ${rev.pct ? '' : 'none'}" style="flex:${rev.pct}">👍 ${rev.pct}%</div><div class="no ${rev.pct < 100 ? '' : 'none'}" style="flex:${100 - rev.pct}">${100 - rev.pct}% 👎</div></div>
        <p class="center muted">${rev.pct}% of the team agree</p>
        <div class="sides">${side(rev.agree, '👍 Agree', 'yes')}${side(rev.disagree, '👎 Disagree', 'no')}</div>`;
    } else if (gv.mine) {
      body = `<p class="center locked">You ${gv.mine.agree ? 'agree' : 'disagree'}, and think <b>${gv.mine.pct}%</b> of the team agree.</p>`;
    } else if (canPlay(app)) {
      const a = takePick.agree;
      body = `<div class="opts two">
          <button class="opt o3 ${a === true ? 'picked' : ''}" data-act="agree" data-v="1">👍 Agree</button>
          <button class="opt o0 ${a === false ? 'picked' : ''}" data-act="agree" data-v="0">👎 Disagree</button></div>
        <label class="slider">How many of the team agree? <b id="pctv">${takePick.pct}%</b>
          <input id="pct" type="range" min="0" max="100" step="5" value="${takePick.pct}" data-live="pct"></label>
        <button class="big wide" data-act="lock" ${a === null ? 'disabled' : ''}>Lock in</button>`;
    } else body = '';
    return `${head(gv, 'Hot take')}<h2 class="prompt take">“${esc(gv.take)}”</h2>${body}${rev ? '' : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'agree') takePick.agree = el.dataset.v === '1';
    if (act === 'pct') { takePick.pct = Number((el as HTMLInputElement).value); const v = document.getElementById('pctv'); if (v) v.textContent = `${takePick.pct}%`; }
    if (act === 'lock' && takePick.agree !== null) ans(app, gv.stage, { agree: takePick.agree, pct: takePick.pct });
  },
};

// ── Who Wrote It ────────────────────────────────────────────────────────────
export const who: SocialView = {
  render(app, gv) {
    if (gv.stage === 0) {
      const body = gv.step === 'rev' ? `<p class="center">${gv.rev.entries ? `✍️ ${gv.rev.entries} answers are in. Who wrote what?` : 'Not enough answers to play. Moving on.'}</p>`
        : gv.mine !== null ? `<p class="center locked">Submitted: “${esc(gv.mine)}”</p>`
        : canPlay(app) ? `<form data-act="write" class="col"><textarea id="write" maxlength="120" rows="3" placeholder="Something true. Or plausible."></textarea><button class="big">Submit</button></form>` : '';
      return `${head(gv, 'Write')}<h2 class="prompt">${esc(gv.prompt)}</h2>${body}${gv.step === 'q' ? waiting(app, gv) : ''}`;
    }
    const rev = gv.step === 'rev' ? gv.rev : null;
    const opts = app.s.participants.filter(id => id !== app.me);
    let body: string;
    if (rev) {
      body = `<p class="center">Written by ${chip(app.player(rev.author))}</p>
        <div class="gains">${Object.entries(rev.picks as Record<string, string>).map(([id, v]) => chip(app.player(id), `<span class="muted">→ ${esc(app.player(v)?.name)}</span>${v === rev.author ? ' ✅' : ''}`)).join('')}</div>${gains(app, rev.gains)}`;
    } else if (gv.entry.mine) body = `<p class="center locked">This one's yours. Keep a straight face.</p>`;
    else body = `<div class="pickgrid">${opts.map(id => `<button class="pick ${gv.mine === id ? 'picked' : ''}" data-act="ans" data-v="${esc(id)}" ${locked(gv, app) ? 'disabled' : ''}>${chip(app.player(id))}</button>`).join('')}</div>`;
    return `${head(gv, 'Who wrote it?')}<p class="muted center">${esc(gv.prompt)}</p><h2 class="prompt take">“${esc(gv.entry.text)}”</h2>${body}${rev ? '' : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'write') { const t = (el.querySelector('textarea') as HTMLTextAreaElement).value.trim(); if (t) ans(app, 0, t); }
    if (act === 'ans') ans(app, gv.stage, el.dataset.v);
  },
};

// ── Most Likely To ──────────────────────────────────────────────────────────
export const mostlikely: SocialView = {
  render(app, gv) {
    const rev = gv.step === 'rev' ? gv.rev : null;
    const opts = app.s.participants;
    const body = `<div class="pickgrid">${opts.map(id => {
      const n = rev?.counts[id] ?? 0;
      const cls = rev ? (rev.winners.includes(id) ? 'right' : 'fade') : gv.mine === id ? 'picked' : '';
      return `<button class="pick ${cls}" data-act="ans" data-v="${esc(id)}" ${locked(gv, app) ? 'disabled' : ''}>${chip(app.player(id), rev ? `<em>${n}</em>${rev.winners.includes(id) ? ' 👑' : ''}` : '')}</button>`;
    }).join('')}</div>`;
    return `${head(gv, 'Vote')}<h2 class="prompt">${esc(gv.prompt)}</h2>${body}${rev ? gains(app, rev.gains) : waiting(app, gv)}`;
  },
  act(app, act, el, gv) { if (act === 'ans') ans(app, gv.stage, el.dataset.v); },
};

export const SOCIAL = {
  quiz: social(quiz), approve: social(approve), hottake: social(hottake), who: social(who), mostlikely: social(mostlikely),
};

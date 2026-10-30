// Screens for the software-satire rounds (server: rootcause, hivemind, review,
// codereview, planning, oncall). Same gv shape as views.ts; On-Call has its own.
import { chip, esc, face, fmt, type App } from '../../app.ts';
import { ans, gains, head, locked, waiting } from './views.ts';
import { canPlay, social, type SocialView } from './wrap.ts';

const blank = (q: string) => esc(q).replace('___', '<span class="blank">_____</span>');
const chips = (app: App, ids: string[]) => ids.map(id => chip(app.player(id))).join('');
const canWrite = (app: App, gv: any) => gv.step === 'q' && gv.mine === null && canPlay(app) && !gv.bench.includes(app.me);

// ── Root Cause Analysis ─────────────────────────────────────────────────────
export const rootcause: SocialView = {
  render(app, gv) {
    const title = `<h2 class="prompt">${blank(gv.prompt)}</h2>`;
    const fact = (label: string) => head({ ...gv, stage: gv.stage >> 1, stages: gv.stages / 2 }, label);
    if (gv.phase === 'write') {
      const body = gv.step === 'rev' ? `<p class="center">🔍 ${gv.rev.fakes} fake${gv.rev.fakes === 1 ? '' : 's'} in. Now find the real one.</p>`
        : gv.mine !== null ? `<p class="center locked">Your fake: “${esc(gv.mine)}”</p>`
        : canWrite(app, gv) ? `<form class="row" data-act="write"><input id="lie" maxlength="40" autocomplete="off" placeholder="A believable fake"><button class="big">Submit</button></form>` : '';
      return `${fact('Write a fake · fact')}${title}${body}${gv.step === 'q' ? waiting(app, gv) : ''}`;
    }
    const rev = gv.step === 'rev' ? gv.rev : null;
    if (rev) {
      const pickers = (i: number) => Object.entries(rev.picks as Record<string, number>).filter(([, v]) => v === i).map(([id]) => id);
      const rows = rev.options.map((o: any, i: number) => `<div class="rc-row ${o.truth ? 'truth' : ''}">
          <b>${o.truth ? '✅' : '🤥'} ${esc(o.text)}</b>
          <span class="muted small">${o.truth ? 'the real root cause' : `fake by ${o.authors.map((id: string) => esc(app.player(id)?.name)).join(' & ') || '?'}`}</span>
          <div class="gains">${chips(app, pickers(i))}</div></div>`).join('');
      return `${fact('Root cause · fact')}${title}<div class="rc-list">${rows}</div>${gains(app, rev.gains)}`;
    }
    const opts = gv.options.map((o: any, i: number) => `<button class="opt o${i % 4} ${gv.mine === i ? 'picked' : ''}" data-act="ans" data-v="${i}" ${locked(gv, app) || o.mine ? 'disabled' : ''}>${esc(o.text)}${o.mine ? '<small>yours</small>' : ''}</button>`).join('');
    return `${fact('Pick the truth · fact')}${title}<div class="opts">${opts}</div>${waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'write') { const t = (el.querySelector('input') as HTMLInputElement).value.trim(); if (t) ans(app, gv.stage, t); }
    if (act === 'ans') ans(app, gv.stage, Number(el.dataset.v));
  },
};

// ── Alignment Meeting ───────────────────────────────────────────────────────
export const hivemind: SocialView = {
  render(app, gv) {
    const rev = gv.step === 'rev' ? gv.rev : null;
    let body: string;
    if (rev) {
      body = `<div class="hm-groups">${rev.groups.map((g: any) => `<div class="hm-row ${g.ids.length > 1 ? 'match' : ''}">
          <b>${esc(g.text)}</b><em>×${g.ids.length}</em><div class="gains">${chips(app, g.ids)}</div></div>`).join('')}</div>${gains(app, rev.gains)}`;
    } else if (gv.mine !== null) body = `<p class="center locked">You said: <b>${esc(gv.mine)}</b></p>`;
    else body = canWrite(app, gv) ? `<form class="row" data-act="write"><input id="hive" maxlength="30" autocomplete="off" placeholder="What will everyone else say?"><button class="big">Submit</button></form>` : '';
    return `${head(gv, 'Prompt')}<h2 class="prompt">${esc(gv.prompt)}</h2>${body}${rev ? '' : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'write') { const t = (el.querySelector('input') as HTMLInputElement).value.trim(); if (t) ans(app, gv.stage, t); }
  },
};

// ── Performance Review ──────────────────────────────────────────────────────
let lie: { stage: number; v: number | null } = { stage: -1, v: null };
export const review: SocialView = {
  render(app, gv) {
    if (gv.stage === 0) {
      if (lie.stage !== gv.stage) lie = { stage: gv.stage, v: null };
      let body: string;
      if (gv.step === 'rev') body = `<p class="center">${gv.rev.reviews ? `📋 ${gv.rev.reviews} self-reviews are in. Calibration begins.` : 'Not enough self-reviews to calibrate. Moving on.'}</p>`;
      else if (gv.mine !== null) body = `<p class="center locked">Submitted. HR thanks you for your honesty (mostly).</p>`;
      else if (canWrite(app, gv)) body = `<form class="col" data-act="review">
          ${[0, 1, 2].map(i => `<label class="rv-line"><input id="rv${i}" maxlength="80" autocomplete="off" placeholder="${['A real achievement', 'Another real one', 'A total fabrication'][i]}">
            <span class="rv-lie"><input type="radio" name="lie" value="${i}" data-live="lie" ${lie.v === i ? 'checked' : ''}> the lie</span></label>`).join('')}
          <button class="big">Submit for review</button></form>`;
      else body = '';
      return `${head(gv, 'Self-review ·')}<h2 class="prompt">Two truths and a lie about your work life</h2>${body}${gv.step === 'q' ? waiting(app, gv) : ''}`;
    }
    const r = gv.review, rev = gv.step === 'rev' ? gv.rev : null;
    const opts = r.statements.map((t: string, i: number) => {
      const cls = rev ? (i === rev.lie ? 'right' : 'fade') : gv.mine === i ? 'picked' : '';
      const who = rev ? Object.entries(rev.picks as Record<string, number>).filter(([, v]) => v === i).map(([id]) => esc(app.player(id)?.name)).join(', ') : '';
      return `<button class="opt o${i} ${cls}" data-act="ans" data-v="${i}" ${locked(gv, app) || r.mine ? 'disabled' : ''}>${esc(t)}${rev ? `<small>${i === rev.lie ? '🤥 lie' : '✅ true'}${who ? ` · ${who}` : ''}</small>` : ''}</button>`;
    }).join('');
    const note = r.mine && !rev ? '<p class="center muted">This is yours. Keep a straight face.</p>' : '';
    return `${head(gv, 'Review')}<p class="center">${chip(app.player(r.author))} <span class="muted">self-review: which one is the lie?</span></p>
      <div class="opts one">${opts}</div>${note}${rev ? gains(app, rev.gains) : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'lie') lie.v = Number((el as HTMLInputElement).value);
    if (act === 'review') {
      const s = [0, 1, 2].map(i => (el.querySelector(`#rv${i}`) as HTMLInputElement).value.trim());
      if (!s.every(t => t)) app.toast('📋 Fill in all three lines');
      else if (lie.v === null) app.toast('🤥 Mark which one is the lie');
      else ans(app, 0, { s, lie: lie.v });
    }
    if (act === 'ans') ans(app, gv.stage, Number(el.dataset.v));
  },
};

// ── Code Review ─────────────────────────────────────────────────────────────
export const codereview: SocialView = {
  render(app, gv) {
    if (gv.stage === 0) {
      let body: string;
      if (gv.step === 'rev') body = `<p class="center">${gv.rev.matchups ? `🔀 ${gv.rev.matchups} PR${gv.rev.matchups === 1 ? '' : 's'} up for review.` : 'No PRs to review. Everyone is on holiday.'}</p>${Object.keys(gv.rev.gains).length ? gains(app, gv.rev.gains) : ''}`;
      else if (!gv.prompt) body = `<p class="center muted">The authors are writing their PRs. Reviewers, get your nitpicks ready.</p>`;
      else if (gv.mine !== null) body = `<p class="center locked">Opened: “${esc(gv.mine)}”</p>`;
      else body = canWrite(app, gv) ? `<form class="col" data-act="quip"><textarea id="quip" maxlength="80" rows="2" placeholder="Make it funny. Someone else got the same prompt."></textarea><button class="big">Open PR</button></form>` : '';
      return `${head(gv, 'Write a PR ·')}${gv.prompt ? `<h2 class="prompt">${esc(gv.prompt)}</h2>` : ''}${body}${gv.step === 'q' ? waiting(app, gv) : ''}`;
    }
    const m = gv.matchup, rev = gv.step === 'rev' ? gv.rev : null;
    const best = rev ? Math.max(...rev.counts) : 0;
    const opts = m.texts.map((t: string, i: number) => {
      const cls = rev ? (rev.counts[i] === best && best > 0 ? 'right' : 'fade') : gv.mine === i ? 'picked' : '';
      const tag = rev ? `<small>${esc(app.player(rev.authors[i])?.name)} · ${rev.counts[i]} ✅</small>` : i === m.mine ? '<small>your PR</small>' : '';
      return `<button class="opt o${i % 4} ${cls}" data-act="ans" data-v="${i}" ${locked(gv, app) ? 'disabled' : ''}>${esc(t)}${tag}</button>`;
    }).join('');
    const note = m.mine >= 0 && !rev ? '<p class="center muted">One of these is yours. Look innocent.</p>' : '';
    return `${head(gv, 'Review')}<p class="center muted">Which one gets merged?</p><h2 class="prompt">${esc(gv.prompt)}</h2>
      <div class="opts ${m.texts.length > 2 ? '' : 'two'}">${opts}</div>${note}${rev ? gains(app, rev.gains) : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act === 'quip') { const t = (el.querySelector('textarea') as HTMLTextAreaElement).value.trim(); if (t) ans(app, 0, t); }
    if (act === 'ans') ans(app, gv.stage, Number(el.dataset.v));
  },
};

// ── Planning Poker ──────────────────────────────────────────────────────────
export const planning: SocialView = {
  render(app, gv) {
    const rev = gv.step === 'rev' ? gv.rev : null;
    let body: string;
    if (rev) {
      body = `<div class="bigans">${fmt(rev.answer)}</div><div class="gains">${rev.guesses.map((g: any) =>
        chip(app.player(g.id), `<span class="muted">${fmt(g.v)}</span>${g.over ? '<em class="over">💸 over</em>' : `<em>+${fmt(rev.gains[g.id] ?? 0)}</em>`}`)).join('')}</div>`;
    } else if (gv.mine !== null) body = `<p class="center locked">Your estimate: <b>${fmt(gv.mine)}</b></p>`;
    else body = canPlay(app) ? `<form class="row" data-act="num"><input id="num" inputmode="decimal" autocomplete="off" placeholder="Your estimate"><button class="big">Commit</button></form>` : '';
    return `${head(gv, 'Estimate')}<p class="center muted">Closest without going over</p><h2 class="prompt">${esc(gv.q)}</h2>${body}${rev ? '' : waiting(app, gv)}`;
  },
  act(app, act, el, gv) {
    if (act !== 'num') return;
    const v = Number((el.querySelector('input') as HTMLInputElement).value.replace(/[,_ ]/g, ''));
    if (Number.isFinite(v) && v >= 0) ans(app, gv.stage, v);
  },
};

// ── On-Call Rotation ────────────────────────────────────────────────────────
export const oncall: SocialView = {
  render(app, gv) {
    const status = `<p class="center muted">Incident ${Math.max(1, gv.incident)} of ${gv.incidents}</p>`;
    const asleep = `<div class="waiting">${gv.alive.map((id: string) => { const p = app.player(id); return p ? face(p, id === gv.holder && gv.phase === 'live' ? 'in' : '') : ''; }).join('')}</div>`;
    const paged = gv.out.length ? `<p class="center muted small">Paged: ${gv.out.map((id: string) => esc(app.player(id)?.name)).join(', ')}</p>` : '';
    let body: string;
    if (gv.phase === 'wait') body = `<div class="pager calm">📟<p>The pager is warming up. Whoever holds it when it goes off is out.</p></div>`;
    else if (gv.phase === 'boom') body = `<div class="pager boom">💥<p>${chip(app.player(gv.out[gv.out.length - 1]))} got paged at 3am</p></div>`;
    else if (gv.holder === app.me) {
      body = `<div class="pager hot">📟<p><b>It's yours.</b> Pass it on!</p></div>
        <div class="opts">${gv.alive.filter((id: string) => id !== app.me).map((id: string, i: number) => `<button class="opt o${i % 4}" data-act="pass" data-v="${esc(id)}">${esc(app.player(id)?.name)}</button>`).join('')}</div>`;
    } else body = `<div class="pager calm">📟<p>${chip(app.player(gv.holder))} has the pager</p></div>`;
    return `${status}${body}${asleep}${paged}`;
  },
  act(app, act, el) { if (act === 'pass') app.net.game({ k: 'pass', to: el.dataset.v }); },
};

export const SATIRE = {
  rootcause: social(rootcause), hivemind: social(hivemind), review: social(review),
  codereview: social(codereview), planning: social(planning), oncall: social(oncall),
};

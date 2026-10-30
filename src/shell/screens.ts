// The between-rounds screens. Each returns HTML from the shell state; main.ts
// patches it in and routes [data-act] clicks back here.
import { CATALOG, gameById } from '../../shared/catalog.ts';
import { PLACE_POINTS } from '../../shared/points.ts';
import { ordinal } from '../../shared/bird.ts';
import { AVATARS, COLORS, HATS, ROUND_CHOICES, type RoundOutcome } from '../../shared/protocol.ts';
import { avatarSrc, chip, countdown, esc, face, fmt, timer, type App } from '../app.ts';

const crown = (app: App, id: string) => (app.s.hostId === id ? ' <span title="host">⭐</span>' : '');

// ── standings (results, podium, TV sidebar) ──
export function standingsTable(app: App, upTo = 99, highlight?: RoundOutcome | null) {
  const ranked = [...app.s.players].sort((a, b) => b.points - a.points);
  const place = (pts: number) => 1 + ranked.filter(p => p.points > pts).length;
  return `<ol class="table">${ranked.slice(0, upTo).map(p => {
    const gained = highlight?.ranking.find(r => r.id === p.id)?.gained ?? 0;
    return `<li class="${p.id === app.me ? 'me' : ''}"><span class="pl">${place(p.points)}</span>${chip(p)}<b class="pts">${fmt(p.points)}${gained ? `<em>+${gained}</em>` : ''}</b></li>`;
  }).join('')}</ol>`;
}

// ── landing ──
export function landing(hof: any, room: string) {
  const name = localStorage.getItem('pn-name') ?? '';
  const nights = hof?.nights ?? [];
  return `<div class="landing">
    <h1 class="brand">Party Night</h1>
    <p class="tag muted center">Minigames for the retro. Flap, guess, draw, judge IAM policies.</p>
    <form class="card" data-act="enter">
      <label>Your name<input id="name" maxlength="16" required value="${esc(name)}" placeholder="Kevin from Billing"></label>
      <label>Room code <span class="muted">(leave empty to start a new room)</span><input id="code" maxlength="4" value="${esc(room)}" placeholder="ABCD" autocomplete="off"></label>
      <button class="big">${room ? `Join ${esc(room)}` : 'Start or join'}</button>
    </form>
    ${nights.length ? `<div class="card hof"><h2>🏛️ Hall of fame</h2>
      ${hof.champions.length ? `<p class="muted">Most nights won: ${hof.champions.slice(0, 5).map((c: any) => `<b>${esc(c.name)}</b> ×${c.wins}`).join(' · ')}</p>` : ''}
      <ul>${nights.slice(0, 6).map((n: any) => `<li><span class="muted">${new Date(n.at).toLocaleDateString()}</span> ${n.podium.map((p: any, i: number) => `${['🥇', '🥈', '🥉'][i]} ${esc(p.name)}`).join(' ')}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

// ── lobby ──
export function lobby(app: App) {
  const s = app.s;
  const me = app.me ? app.player(app.me) : null;
  const host = app.isHost();
  const link = `${location.origin}${location.pathname}?room=${s.code}`;
  const games = CATALOG.map(g => `<label class="toggle ${s.settings.games.includes(g.id) ? 'on' : ''}">
      <input type="checkbox" data-act="game" data-v="${g.id}" ${s.settings.games.includes(g.id) ? 'checked' : ''} ${host ? '' : 'disabled'}>
      <b>${g.kind === 'bird' ? '🐦' : '🎲'} ${esc(g.title)}</b><span class="muted">${esc(g.blurb)}</span></label>`).join('');
  return `<div class="lobby">
    <div class="joinbox card">
      <span class="muted">Room code</span>
      <div class="roomcode">${s.code}</div>
      <button class="ghost" data-act="copy" data-v="${esc(link)}">🔗 Copy invite link</button>
      <a class="muted small" href="?room=${s.code}&tv=1" target="_blank">📺 Open the spectator screen (for screen sharing)</a>
    </div>
    <div class="card">
      <h2>Players · ${s.players.length}</h2>
      <div class="players">${s.players.map(p => chip(p, crown(app, p.id) + (p.performer ? ' 🎤' : ''))).join('')}</div>
      ${host ? `<div class="row"><button class="ghost" data-act="bot+">🤖 Add bot</button><button class="ghost" data-act="bot-">Remove bot</button></div>` : ''}
    </div>
    ${me ? `<div class="card">
      <h2>You</h2>
      <div class="pickrow">${AVATARS.map(a => `<button class="av ${me.avatar === a ? 'on' : ''}" data-act="avatar" data-v="${a}"><img src="${avatarSrc(a)}" alt="${a}"></button>`).join('')}</div>
      <div class="pickrow">${COLORS.map(c => `<button class="sw ${me.color === c ? 'on' : ''}" data-act="color" data-v="${c}" style="--c:${c}"></button>`).join('')}</div>
      <div class="pickrow">${HATS.map(h => `<button class="hat ${me.hat === h ? 'on' : ''}" data-act="hat" data-v="${h}">${h || '∅'}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" data-act="performer" ${me.performer ? 'checked' : ''}> 🎤 I'm up for Hum &amp; Mime (you perform on camera)</label>
    </div>` : ''}
    <div class="card wide">
      <h2>Tonight</h2>
      <div class="row"><span class="muted">Rounds</span>${ROUND_CHOICES.map(n => `<button class="pillbtn ${s.settings.rounds === n ? 'on' : ''}" data-act="rounds" data-v="${n}" ${host ? '' : 'disabled'}>${n}</button>`).join('')}</div>
      <p class="muted small">Each round is a random pick from the ticked games, with no repeats. Bird Race is never the first round. Points: ${PLACE_POINTS.join('/')} by place, ties share; every 4th round and the last are 🌪️ chaos rounds worth double.</p>
      <div class="games">${games}</div>
      ${host ? `<button class="big wide" data-act="start">Start the night</button>` : `<p class="center muted">Waiting for ${esc(app.player(s.hostId)?.name ?? 'the host')} to start…</p>`}
    </div>
  </div>`;
}

// ── intro card ──
export function intro(app: App) {
  const s = app.s, g = s.game!;
  return `<div class="intro ${g.chaos ? 'chaos' : ''}">
    <p class="muted">Round ${s.round} of ${s.totalRounds}</p>
    ${g.chaos ? '<div class="chaosbadge">🌪️ Chaos round · double points</div>' : ''}
    <h1 class="display title">${esc(g.title)}</h1>
    <p class="blurb">${esc(g.blurb)}</p>
    <p class="how">${esc(g.how)}</p>
    <div class="startsin">Starting in ${countdown(s.phaseEndsAt)}</div>
    ${timer(s.phaseEndsAt, 6000)}
    ${app.isHost() ? '<button class="ghost" data-act="next">Skip intro ⏭️</button>' : ''}
  </div>`;
}

// ── results ──
export function results(app: App) {
  const s = app.s, o = s.outcome!;
  const g = gameById(o.game);
  const mine = o.ranking.find(r => r.id === app.me);
  const pf = o.photoFinish;
  return `<div class="results">
    <p class="muted">Round ${s.round} of ${s.totalRounds} · ${esc(g?.title)}${o.chaos ? ' · 🌪️ double points' : ''}</p>
    <h1 class="headline">${esc(o.headline)}</h1>
    ${o.roast ? `<p class="roast">${esc(o.roast)}</p>` : ''}
    ${pf ? `<div class="card photo"><h2>📸 Photo finish · ${(pf.margin / 1000).toFixed(2)}s</h2>
      <canvas class="photofinish" width="700" height="180" data-a="${esc(pf.a)}" data-b="${esc(pf.b)}" data-margin="${pf.margin}"></canvas></div>` : ''}
    <div class="cols">
      <div class="card">
        <h2>This round</h2>
        <ol class="table">${o.ranking.map(r => `<li class="${r.id === app.me ? 'me' : ''}"><span class="pl">${r.place}</span>${chip(app.player(r.id))}<span class="muted stat">${esc(r.stat ?? '')}</span><b class="pts">${r.gained ? `+${r.gained}` : ''}</b></li>`).join('')}</ol>
      </div>
      <div class="card">
        <h2>Standings</h2>
        ${standingsTable(app, 99, o)}
      </div>
    </div>
    ${o.awards.length ? `<div class="awards">${o.awards.map(a => `<div class="award"><span class="aw">${a.emoji}</span><b>${esc(a.title)}</b>${chip(app.player(a.id))}<span class="muted">${esc(a.desc)}</span></div>`).join('')}</div>` : ''}
    <div class="next"><span>${s.round < s.totalRounds ? 'Next round' : 'The podium'} in ${countdown(s.phaseEndsAt)}s</span>
      ${app.isHost() ? '<button class="ghost" data-act="next">Go now ⏭️</button>' : ''}</div>
    ${mine ? `<p class="center muted">You came ${ordinal(mine.place)} for ${mine.gained} point${mine.gained === 1 ? '' : 's'}.</p>` : ''}
  </div>`;
}

// ── podium ──
export function podium(app: App) {
  const s = app.s;
  const ranked = [...s.players].sort((a, b) => b.points - a.points);
  const top = ranked.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return `<div class="podium">
    <h1 class="brand">That's the night!</h1>
    <div class="steps">${order.map(p => {
      const i = top.indexOf(p);
      return `<div class="step s${i + 1}">${face(p, 'big')}<b>${esc(p.name)}</b><span>${fmt(p.points)} pts</span><div class="block">${['🥇', '🥈', '🥉'][i]}</div></div>`;
    }).join('')}</div>
    ${s.nightAwards.length ? `<div class="awards">${s.nightAwards.map(a => `<div class="award"><span class="aw">${a.emoji}</span><b>${esc(a.title)}</b>${chip(app.player(a.id))}<span class="muted">${esc(a.desc)}</span></div>`).join('')}</div>` : ''}
    <div class="card">${standingsTable(app)}</div>
    <div class="card"><h2>Rounds played</h2><ol class="played">${s.history.map(o => `<li><b>${esc(gameById(o.game)?.title)}</b>${o.chaos ? ' 🌪️' : ''} <span class="muted">${esc(o.headline)}</span></li>`).join('')}</ol></div>
    ${app.isHost() ? '<button class="big wide" data-act="again">Back to the lobby</button>' : ''}
  </div>`;
}

// ── top bar (during a night) ──
export function topbar(app: App) {
  const s = app.s;
  if (s.phase === 'lobby') return `<span class="display logo">Party Night</span><span class="muted">Room <b>${s.code}</b></span>`;
  const host = app.isHost();
  return `<span class="display logo">Party Night</span>
    <span class="muted">Round <b>${s.round}</b>/${s.totalRounds}${s.game ? ` · ${esc(s.game.title)}${s.game.chaos ? ' 🌪️' : ''}` : ''}</span>
    <span class="hostctl">${host && s.phase === 'play' ? '<button class="ghost small" data-act="skip">Skip round</button>' : ''}
    ${host && s.phase !== 'podium' ? '<button class="ghost small" data-act="end">End night</button>' : ''}</span>`;
}

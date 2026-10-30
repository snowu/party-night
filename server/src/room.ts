// ─── ROOM CORE ────────────────────────────────────────────────────────────────
// Everything a room knows, with no Cloudflare in sight: the Durable Object feeds it
// sockets, messages and a tick every 250ms, and it answers through Conn.send.
// The clock is injected, so tests can run a whole night in milliseconds.
//
// The room is the authority for the shell: who is host (the earliest-joined human
// still connected), the round rotation, points and awards. Each round's game
// module decides that round's ranking; the room turns places into points.
import { DEFAULT_GAMES, gameById } from '../../shared/catalog.ts';
import { isChaos, mulberry32, pointsFor } from '../../shared/points.ts';
import {
  AVATARS, COLORS, HATS, MAX_BOTS, MAX_FRAME, MAX_PLAYERS, ROUND_CHOICES,
  type Award, type Phase, type PlayerPub, type RoundOutcome, type Settings, type ShellState,
} from '../../shared/protocol.ts';
import { BOT_NAMES } from './games/content.ts';
import { FACTORIES } from './games/index.ts';
import type { GameCtx, ServerGame } from './games/types.ts';

export interface Conn { pid: string | null; send(data: string): void; close?(code: number, reason: string): void }

export interface HofRecord {
  at: number;
  code: string;
  rounds: number;
  podium: Array<{ name: string; avatar: string; points: number }>;
}

interface P extends Omit<PlayerPub, 'connected'> { conns: Set<Conn>; lastSeen: number }

export const INTRO_MS = 6000;
export const RESULTS_MS = 14000;
const LOBBY_DROP_MS = 30000;   // a human who left the lobby is forgotten after this
export const HOF_MIN_HUMANS = 3;

export class RoomCore {
  players = new Map<string, P>();
  conns = new Set<Conn>();
  phase: Phase = 'lobby';
  settings: Settings = { rounds: 8, games: [...DEFAULT_GAMES] };
  playlist: string[] = [];        // games played (or playing) tonight, in order
  totalRounds = 0;
  round = 0;
  gameId = '';
  game: ServerGame | null = null;
  participants: string[] = [];
  seed = 0;
  phaseEndsAt = 0;
  outcome: RoundOutcome | null = null;
  history: RoundOutcome[] = [];
  nightAwards: Award[] = [];
  dirty = false;

  constructor(
    public code: string,
    public clock: () => number = Date.now,
    public hooks: { onPodium?(rec: HofRecord): void } = {},
    public rand: () => number = Math.random,
  ) {}

  // ── sockets ────────────────────────────────────────────────────────────────
  join(conn: Conn, q: { pid?: string; name?: string; tv?: boolean }) {
    this.conns.add(conn);
    if (q.tv) {
      conn.pid = null;
    } else {
      const id = (q.pid ?? '').slice(0, 64);
      const name = (q.name ?? '').trim().slice(0, 16);
      if (!id || !name || id.startsWith('bot-')) return this.reject(conn, 4000, 'missing name');
      let p = this.players.get(id);
      if (!p) {
        if (this.players.size >= MAX_PLAYERS) return this.reject(conn, 4009, 'room full');
        p = this.newPlayer(id, name, false);
      }
      p.name = name;
      p.conns.add(conn);
      conn.pid = id;
    }
    this.game?.onJoin?.(conn.pid, msg => conn.send(JSON.stringify(msg)));
    this.dirty = true;
    this.flush();
  }

  leave(conn: Conn) {
    this.conns.delete(conn);
    const p = conn.pid ? this.players.get(conn.pid) : null;
    if (p) { p.conns.delete(conn); p.lastSeen = this.clock(); }
    this.dirty = true;
    this.flush();
  }

  private reject(conn: Conn, code: number, reason: string) {
    this.conns.delete(conn);
    conn.close?.(code, reason);
  }

  private newPlayer(id: string, name: string, bot: boolean): P {
    const used = new Set([...this.players.values()].map(p => p.avatar));
    const free = AVATARS.filter(a => !used.has(a));
    const p: P = {
      id, name, bot, points: 0, performer: false, hat: '',
      avatar: (free.length ? free : AVATARS)[Math.floor(this.rand() * (free.length || AVATARS.length))],
      color: COLORS[this.players.size % COLORS.length],
      conns: new Set(), lastSeen: this.clock(),
    };
    this.players.set(id, p);
    return p;
  }

  connected = (id: string) => { const p = this.players.get(id); return !!p && (p.bot || p.conns.size > 0); };
  hostId = () => [...this.players.values()].find(p => !p.bot && p.conns.size > 0)?.id ?? '';

  // ── messages ───────────────────────────────────────────────────────────────
  message(conn: Conn, data: unknown) {
    if (typeof data !== 'string' || data.length > MAX_FRAME) return;
    let m: any;
    try { m = JSON.parse(data); } catch { return; }
    const pid = conn.pid;
    if (m?.t === 'bc' && pid && typeof m.e === 'string') {
      const out = JSON.stringify({ t: 'bc', e: m.e, p: m.p, from: pid });
      for (const c of this.conns) if (c !== conn) c.send(out);
      return;
    }
    const p = pid ? this.players.get(pid) : null;
    if (!p) return;
    const now = this.clock();
    if (m.t === 'set') this.setProfile(p, m);
    else if (m.t === 'g' && this.phase === 'play' && this.game) this.game.onMessage(p.id, m, now);
    else if (m.t === 'host' && p.id === this.hostId()) this.hostOp(m, now);
    this.flush();
  }

  private setProfile(p: P, m: any) {
    if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.trim().slice(0, 16);
    if (AVATARS.includes(m.avatar)) p.avatar = m.avatar;
    if (COLORS.includes(m.color)) p.color = m.color;
    if (HATS.includes(m.hat)) p.hat = m.hat;
    if (typeof m.performer === 'boolean') p.performer = m.performer;
    this.dirty = true;
  }

  private hostOp(m: any, now: number) {
    const between = this.phase !== 'play';
    switch (m.op) {
      case 'bot+': {
        const bots = [...this.players.values()].filter(p => p.bot);
        if (!between || bots.length >= MAX_BOTS || this.players.size >= MAX_PLAYERS) return;
        const taken = new Set([...this.players.values()].map(p => p.name));
        const name = BOT_NAMES.find(n => !taken.has(n)) ?? `Bot ${bots.length + 1}`;
        const b = this.newPlayer(`bot-${Math.floor(this.rand() * 1e9).toString(36)}`, name, true);
        b.color = COLORS[Math.floor(this.rand() * COLORS.length)];
        break;
      }
      case 'bot-': {
        const bot = [...this.players.values()].filter(p => p.bot).pop();
        if (bot && between) this.players.delete(bot.id);
        break;
      }
      case 'settings': {
        if (this.phase !== 'lobby') return;
        if (ROUND_CHOICES.includes(m.rounds)) this.settings.rounds = m.rounds;
        if (Array.isArray(m.games)) {
          const games = m.games.filter((g: unknown) => typeof g === 'string' && gameById(g));
          if (games.length) this.settings.games = games;
        }
        break;
      }
      case 'start':
        if (this.phase !== 'lobby') return;
        for (const p of this.players.values()) p.points = 0;
        this.history = [];
        this.playlist = [];
        this.totalRounds = this.settings.rounds;
        this.round = 0;
        this.advance(now);
        break;
      case 'next':
        if (this.phase === 'intro') this.beginPlay(now);
        else if (this.phase === 'results') this.advance(now);
        break;
      case 'skip':   // abandon the round in play: nobody scores
        if (this.phase === 'play') { this.event(`⏭️ Round skipped`); this.advance(now); }
        break;
      case 'end':
        if (this.phase !== 'lobby' && this.phase !== 'podium') this.podium(now);
        break;
      case 'again':
        if (this.phase !== 'podium') return;
        for (const p of this.players.values()) p.points = 0;
        Object.assign(this, { phase: 'lobby', round: 0, totalRounds: 0, playlist: [], history: [], outcome: null, nightAwards: [], game: null, gameId: '', phaseEndsAt: 0 });
        break;
    }
    this.dirty = true;
  }

  // ── rotation ───────────────────────────────────────────────────────────────
  // Picked one round at a time, from who's actually here: no game twice in a night
  // until every eligible one has been played, and bird rounds spread out to their
  // share of the enabled games (about one in three), never two in a row, with
  // the night opening on one.
  pickNext(): string {
    const kind = (g: string) => gameById(g)?.kind;
    const enabled = this.settings.games.filter(g => gameById(g));
    const ok = enabled.filter(g => this.eligible(g));
    const pool = ok.length ? ok : ['quiz'];
    const last = this.playlist[this.playlist.length - 1];
    let fresh = pool.filter(g => !this.playlist.includes(g));
    if (!fresh.length) fresh = pool.filter(g => g !== last);
    if (!fresh.length) fresh = pool;
    const share = enabled.filter(g => kind(g) === 'bird').length / Math.max(1, enabled.length);
    const k = this.playlist.length + 1;
    const birds = this.playlist.filter(g => kind(g) === 'bird').length;
    const wantBird = kind(last ?? '') !== 'bird' && birds < Math.round((k - 0.5) * share + 0.5);
    const lane = fresh.filter(g => (kind(g) === 'bird') === wantBird);
    return this.shuffled(lane.length ? lane : fresh)[0];
  }

  private shuffled<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  eligible(id: string): boolean {
    const g = gameById(id);
    if (!g) return false;
    const live = [...this.players.values()].filter(p => p.bot || p.conns.size);
    const humans = live.filter(p => !p.bot);
    if (live.length < g.minPlayers || !humans.length) return false;
    if (g.needs === 'artist') return live.length >= 2;
    if (g.needs === 'artists') return humans.length >= 2;
    if (g.needs === 'performer') return live.length >= 2 && humans.some(p => p.performer);
    return true;
  }

  private advance(now: number) {
    this.game = null;
    this.outcome = null;
    if (this.round >= this.totalRounds) return this.podium(now);
    this.round++;
    const id = this.pickNext();
    this.playlist.push(id);
    this.gameId = id;
    this.participants = [...this.players.values()].filter(p => p.bot || p.conns.size).map(p => p.id);
    this.seed = Math.floor(this.rand() * 0xffffffff) >>> 0;
    this.phase = 'intro';
    this.phaseEndsAt = now + INTRO_MS;
    this.dirty = true;
  }

  private beginPlay(now: number) {
    const ctx: GameCtx = {
      seed: this.seed,
      rng: mulberry32(this.seed),
      players: this.participants.map(id => this.players.get(id)).filter((p): p is P => !!p)
        .map(p => ({ id: p.id, name: p.name, bot: p.bot, performer: p.performer })),
      connected: this.connected,
      hostId: this.hostId,
      event: text => this.event(text),
      send: (id, msg) => { const s = JSON.stringify(msg); for (const c of this.players.get(id)?.conns ?? []) c.send(s); },
      toAllBut: (id, msg) => { const s = JSON.stringify(msg); for (const c of this.conns) if (c.pid !== id) c.send(s); },
      changed: () => { this.dirty = true; },
    };
    this.game = FACTORIES[this.gameId](ctx, now);
    this.phase = 'play';
    this.phaseEndsAt = 0;
    this.dirty = true;
    if (this.game.result) this.endRound(now);
  }

  private endRound(now: number) {
    const r = this.game!.result!;
    const chaos = isChaos(this.round, this.totalRounds);
    const ranking = r.ranking.map(x => ({ ...x, gained: pointsFor(x.place, chaos) }));
    for (const x of ranking) { const p = this.players.get(x.id); if (p) p.points += x.gained; }
    this.outcome = {
      game: this.gameId, chaos, headline: r.headline, roast: r.roast ?? '', ranking, awards: r.awards,
      photoFinish: r.photoFinish ?? null,
    };
    this.history.push(this.outcome);
    this.game = null;
    this.phase = 'results';
    this.phaseEndsAt = now + RESULTS_MS;
    this.dirty = true;
  }

  private podium(now: number) {
    this.game = null;
    this.phase = 'podium';
    this.phaseEndsAt = 0;
    this.nightAwards = this.computeNightAwards();
    this.dirty = true;
    // Real retros only: a night needs 3+ humans to make the hall of fame, so solo and
    // two-person test runs never land in it.
    const humans = [...this.players.values()].filter(p => !p.bot).length;
    if (this.history.length && humans >= HOF_MIN_HUMANS) this.hooks.onPodium?.({
      at: now, code: this.code, rounds: this.history.length,
      podium: this.standings().filter(p => !p.bot).slice(0, 3).map(p => ({ name: p.name, avatar: p.avatar, points: p.points })),
    });
  }

  standings() { return [...this.players.values()].sort((a, b) => b.points - a.points); }

  computeNightAwards(): Award[] {
    const out: Award[] = [];
    const ids = [...this.players.keys()];
    const count = (f: (o: RoundOutcome, id: string) => number) => new Map(ids.map(id => [id, this.history.reduce((s, o) => s + f(o, id), 0)]));
    const best = (m: Map<string, number>, min: number) => [...m].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1])[0];

    const wins = best(count((o, id) => o.ranking.some(r => r.id === id && r.place === 1) ? 1 : 0), 2);
    if (wins) out.push({ emoji: '🥇', title: 'Medal Hoarder', desc: `won ${wins[1]} rounds`, id: wins[0] });

    // Comeback: places climbed between the halfway mark and the end.
    const half = Math.floor(this.history.length / 2);
    if (half >= 1 && ids.length >= 3) {
      const totals = (n: number) => new Map(ids.map(id => [id, this.history.slice(0, n).reduce((s, o) => s + (o.ranking.find(r => r.id === id)?.gained ?? 0), 0)]));
      const rankIn = (t: Map<string, number>, id: string) => 1 + [...t.values()].filter(v => v > t.get(id)!).length;
      const mid = totals(half), end = totals(this.history.length);
      const climb = best(new Map(ids.map(id => [id, rankIn(mid, id) - rankIn(end, id)])), 2);
      if (climb) out.push({ emoji: '🎢', title: 'Comeback Kid', desc: `climbed ${climb[1]} places in the second half`, id: climb[0] });
    }

    const chaos = best(count((o, id) => o.chaos ? o.ranking.find(r => r.id === id)?.gained ?? 0 : 0), 10);
    if (chaos) out.push({ emoji: '🌪️', title: 'Chaos Agent', desc: `${chaos[1]} points from chaos rounds`, id: chaos[0] });

    const magnet = best(count((o, id) => o.awards.filter(a => a.id === id).length), 2);
    if (magnet) out.push({ emoji: '🧲', title: 'Award Magnet', desc: `picked up ${magnet[1]} round awards`, id: magnet[0] });

    const ranked = this.standings();
    if (ranked.length >= 3) {
      const last = ranked[ranked.length - 1];
      out.push({ emoji: '🏅', title: 'Participation Trophy', desc: 'came last, but showed up', id: last.id });
    }
    return out;
  }

  // ── clock ──────────────────────────────────────────────────────────────────
  tick() {
    const now = this.clock();
    if (this.phase === 'intro' && now >= this.phaseEndsAt) this.beginPlay(now);
    else if (this.phase === 'play' && this.game) {
      this.game.onTick(now);
      if (this.game.result) this.endRound(now);
    } else if (this.phase === 'results' && now >= this.phaseEndsAt) this.advance(now);
    else if (this.phase === 'lobby') {
      for (const p of [...this.players.values()]) {
        if (!p.bot && !p.conns.size && now - p.lastSeen > LOBBY_DROP_MS) { this.players.delete(p.id); this.dirty = true; }
      }
    }
    this.flush();
  }

  // ── output ─────────────────────────────────────────────────────────────────
  event(text: string) {
    const s = JSON.stringify({ t: 'event', text });
    for (const c of this.conns) c.send(s);
  }

  stateFor(pid: string | null, now: number): ShellState {
    const info = this.gameId ? gameById(this.gameId) : null;
    return {
      t: 'state',
      code: this.code,
      phase: this.phase,
      me: pid,
      hostId: this.hostId(),
      players: [...this.players.values()].map(({ conns, lastSeen, ...p }) => ({ ...p, connected: p.bot || conns.size > 0 })),
      round: this.round,
      totalRounds: this.totalRounds || this.settings.rounds,
      game: info && this.phase !== 'lobby' && this.phase !== 'podium'
        ? { id: info.id, title: info.title, blurb: info.blurb, kind: info.kind, how: info.how, chaos: isChaos(this.round, this.totalRounds) }
        : null,
      participants: this.participants,
      seed: this.seed,
      phaseEndsAt: this.phaseEndsAt,
      now,
      settings: this.settings,
      outcome: this.phase === 'results' ? this.outcome : null,
      history: this.history,
      nightAwards: this.phase === 'podium' ? this.nightAwards : [],
      gv: this.phase === 'play' && this.game ? this.game.view(pid, now) : null,
    };
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const now = this.clock();
    for (const c of this.conns) c.send(JSON.stringify(this.stateFor(c.pid, now)));
  }
}

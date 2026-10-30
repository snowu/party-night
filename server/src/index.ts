// ─── PARTY NIGHT SERVER (Cloudflare Worker + Durable Objects) ────────────────
//   /ws/<CODE>   one in-memory Room per 4-letter code (see room.ts); no storage, so
//                the room is gone once the last socket leaves and it's evicted.
//                ?pid=&name= to play, ?tv=1 for the spectator screen.
//   /api/hof     the hall of fame: one SQLite-backed object for every night's podium.
import { DurableObject } from 'cloudflare:workers';
import { RoomCore, type Conn, type HofRecord } from './room.ts';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  HOF: DurableObjectNamespace<HallOfFame>;
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const TICK_MS = 250;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/hof') {
      const hof = env.HOF.get(env.HOF.idFromName('global'));
      return Response.json(await hof.list(), { headers: CORS });
    }
    const m = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (!m) return new Response('party-night: connect to /ws/<CODE>', { status: 404, headers: CORS });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  core: RoomCore | null = null;
  timer: ReturnType<typeof setInterval> | null = null;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.slice(-4);
    this.core ??= new RoomCore(code, Date.now, {
      onPodium: rec => { this.ctx.waitUntil(this.env.HOF.get(this.env.HOF.idFromName('global')).add(rec).catch(() => {})); },
    });
    const core = this.core;
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn: Conn = {
      pid: null,
      send: d => { try { server.send(d); } catch {} },
      close: (c, r) => { try { server.close(c, r); } catch {} },
    };
    core.join(conn, { pid: url.searchParams.get('pid') ?? '', name: url.searchParams.get('name') ?? '', tv: url.searchParams.get('tv') === '1' });
    if (core.conns.has(conn)) {
      server.addEventListener('message', e => core.message(conn, e.data));
      const drop = () => {
        if (!core.conns.has(conn)) return;
        core.leave(conn);
        if (!core.conns.size && this.timer) { clearInterval(this.timer); this.timer = null; }
      };
      server.addEventListener('close', drop);
      server.addEventListener('error', drop);
      this.timer ??= setInterval(() => core.tick(), TICK_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}

const HOF_KEEP = 50;

export class HallOfFame extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS nights (at INTEGER, code TEXT, rounds INTEGER, podium TEXT)`);
  }

  async add(rec: HofRecord) {
    const sql = this.ctx.storage.sql;
    sql.exec('INSERT INTO nights VALUES (?, ?, ?, ?)', rec.at, rec.code, rec.rounds, JSON.stringify(rec.podium));
    sql.exec(`DELETE FROM nights WHERE at NOT IN (SELECT at FROM nights ORDER BY at DESC LIMIT ${HOF_KEEP})`);
  }

  async list(): Promise<{ nights: HofRecord[]; champions: Array<{ name: string; wins: number }> }> {
    const nights = this.ctx.storage.sql.exec<{ at: number; code: string; rounds: number; podium: string }>('SELECT * FROM nights ORDER BY at DESC')
      .toArray().map(r => ({ at: r.at, code: r.code, rounds: r.rounds, podium: JSON.parse(r.podium) }));
    const wins = new Map<string, number>();
    for (const n of nights) if (n.podium[0]) wins.set(n.podium[0].name, (wins.get(n.podium[0].name) ?? 0) + 1);
    const champions = [...wins].map(([name, w]) => ({ name, wins: w })).sort((a, b) => b.wins - a.wins).slice(0, 10);
    return { nights: nights.slice(0, 12), champions };
  }
}

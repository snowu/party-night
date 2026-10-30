// One WebSocket into the room. Reconnects a second after a drop (the server keeps
// our seat by player id), and tracks the server clock so countdowns agree.
import type { ShellState } from '../shared/protocol.ts';

// The deployed Worker when served from GitHub Pages; a local `wrangler dev` otherwise.
// (A function, not a constant, so this module also loads in Node.)
export const serverUrl = () => location.hostname.endsWith('github.io')
  ? 'wss://party-night.zancato-t.workers.dev'
  : `ws://${location.hostname || 'localhost'}:8799`;
export const httpUrl = () => serverUrl().replace(/^ws/, 'http');

export interface NetHandlers {
  state(s: ShellState): void;
  bc(from: string, e: string, p: any): void;
  event(text: string): void;
  raw(m: any): void;                 // anything else (ink strokes…), for the current game
  status(up: boolean, why?: string): void;
}

// Dev only: ?lag=80&jitter=40 delays every message each way (in order, like TCP),
// to feel a real network on localhost.
const qs = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
const LAG = Number(qs?.get('lag')) || 0, JITTER = Number(qs?.get('jitter')) || 0;
function delayed() {
  let last = 0;
  return (f: () => void) => {
    if (!LAG && !JITTER) return f();
    last = Math.max(last, performance.now() + LAG + Math.random() * JITTER);
    setTimeout(f, last - performance.now());
  };
}

export class Net {
  ws: WebSocket | null = null;
  private inbound = delayed();
  private outbound = delayed();
  offset = 0;                        // server clock − local clock
  private synced = false;
  private closed = false;

  constructor(private query: string, private h: NetHandlers, public code: string) {}

  now = () => Date.now() + this.offset;

  connect() {
    const ws = new WebSocket(`${serverUrl()}/ws/${this.code}?${this.query}`);
    this.ws = ws;
    ws.onopen = () => this.h.status(true);
    ws.onmessage = e => this.inbound(() => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') {
        // Smooth the skew: one late packet shouldn't jolt every countdown.
        const skew = m.now - Date.now();
        this.offset = this.synced ? this.offset * 0.8 + skew * 0.2 : skew;
        this.synced = true;
        this.h.state(m);
      } else if (m.t === 'bc') this.h.bc(m.from, m.e, m.p);
      else if (m.t === 'event') this.h.event(m.text);
      else this.h.raw(m);
    });
    ws.onclose = e => {
      if (this.closed) return;
      if (e.code >= 4000 && e.code < 4100) { this.h.status(false, e.reason || 'closed'); return; }
      this.h.status(false);
      setTimeout(() => { if (!this.closed) this.connect(); }, 1000);
    };
  }

  send(m: unknown) {
    const data = JSON.stringify(m);
    this.outbound(() => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data); });
  }
  game(m: object) { this.send({ t: 'g', ...m }); }
  host(op: string, extra: object = {}) { this.send({ t: 'host', op, ...extra }); }
  relay(e: string, p: unknown) { this.send({ t: 'bc', e, p }); }
  close() { this.closed = true; this.ws?.close(); }
}

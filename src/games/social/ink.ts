// Ink shared by the two drawing rounds (Draw It, Draw Off): strokes are points on a
// 0–1000 square, painted onto any canvas size, and a pen that streams new points
// every 50ms while you draw.
export const INK = ['#111111', '#ffffff', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#6d4c41'];
export const SIZES = [6, 14, 30];

export interface Stroke { c: string; w: number; pts: number[] }

export function paint(cv: HTMLCanvasElement, strokes: Iterable<Stroke>) {
  const x = cv.getContext('2d')!;
  const k = cv.width / 1000;
  x.setTransform(k, 0, 0, k, 0, 0);
  x.fillStyle = '#fffdf6';
  x.fillRect(0, 0, 1000, 1000);
  x.lineCap = x.lineJoin = 'round';
  for (const s of strokes) {
    x.strokeStyle = x.fillStyle = s.c;
    x.lineWidth = s.w;
    if (s.pts.length === 2) { x.beginPath(); x.arc(s.pts[0], s.pts[1], s.w / 2, 0, Math.PI * 2); x.fill(); continue; }
    x.beginPath();
    x.moveTo(s.pts[0], s.pts[1]);
    for (let i = 2; i < s.pts.length; i += 2) x.lineTo(s.pts[i], s.pts[i + 1]);
    x.stroke();
  }
}

export interface Pen { color: string; size: number; stop(): void }

// `strokes` is the caller's map; the pen adds to it, calls `changed` to repaint and
// `send` with each batch of new points (re-sending the last point so lines join).
export function pen(cv: HTMLCanvasElement, strokes: Map<string, Stroke>, enabled: () => boolean,
  changed: () => void, send: (id: string, s: Stroke, pts: number[]) => void): Pen {
  const p: Pen = { color: INK[0], size: SIZES[1], stop: () => {} };
  let cur: { id: string; sent: number } | null = null;
  let timer = 0;
  const at = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 1000)];
  };
  const flush = () => {
    if (!cur) return;
    const s = strokes.get(cur.id)!;
    const from = Math.max(0, cur.sent - 2);
    if (s.pts.length > cur.sent && s.pts.length - from >= 2) {
      send(cur.id, s, s.pts.slice(from));
      cur.sent = s.pts.length;
    }
  };
  cv.onpointerdown = e => {
    if (!enabled()) return;
    cv.setPointerCapture(e.pointerId);
    const id = Math.random().toString(36).slice(2, 10);
    strokes.set(id, { c: p.color, w: p.size, pts: at(e) });
    cur = { id, sent: 0 };
    changed();
    clearInterval(timer);
    timer = window.setInterval(flush, 50);
  };
  cv.onpointermove = e => {
    if (!cur) return;
    strokes.get(cur.id)!.pts.push(...at(e));
    changed();
  };
  cv.onpointerup = cv.onpointercancel = () => { flush(); clearInterval(timer); cur = null; };
  p.stop = () => { clearInterval(timer); cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onpointercancel = null; };
  return p;
}

export const toolsHtml = (p: Pen) =>
  `${INK.map(c => `<button class="ink ${c === p.color ? 'on' : ''}" data-c="${c}" style="--ink:${c}"></button>`).join('')}
  ${SIZES.map(w => `<button class="size ${w === p.size ? 'on' : ''}" data-w="${w}"><i style="width:${w / 2 + 4}px;height:${w / 2 + 4}px"></i></button>`).join('')}
  <button class="ghost" data-clear>🧽 Clear</button>`;

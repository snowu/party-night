// Photo finish: when the top two cross within 0.3s, the results screen replays
// the last moment in slow motion. Positions come from the finish times: both
// birds fly at race speed, so the gap at the line is the time margin × speed.
import { avatarSrc, type App } from '../app.ts';

const SPEED_PX_PER_MS = 0.27;   // ~4.5 px/tick at 60Hz
const ZOOM = 4;                 // the gap is drawn 4× wider than life, so 0.05s still shows
const LOOP_MS = 3200;

export function photoFinish(cv: HTMLCanvasElement, app: App) {
  const g = cv.getContext('2d')!;
  const a = app.player(cv.dataset.a!), b = app.player(cv.dataset.b!);
  const margin = Number(cv.dataset.margin);
  if (!a || !b) return;
  const imgs = [a, b].map(p => { const i = new Image(); i.src = avatarSrc(p.avatar); return i; });
  const line = cv.width - 120;
  const t0 = performance.now();
  const draw = () => {
    if (!cv.isConnected) return;
    const k = Math.min(1, ((performance.now() - t0) % LOOP_MS) / (LOOP_MS * 0.75));
    const lead = -60 + k * (line + 90);
    g.fillStyle = '#1d1340';
    g.fillRect(0, 0, cv.width, cv.height);
    for (let row = 0; row * 12 < cv.height; row++) {
      g.fillStyle = row % 2 ? '#111' : '#fff';
      g.fillRect(line, row * 12, 12, 12);
      g.fillStyle = row % 2 ? '#fff' : '#111';
      g.fillRect(line + 12, row * 12, 12, 12);
    }
    const xs = [lead, lead - Math.max(14, margin * SPEED_PX_PER_MS * ZOOM)];
    [a, b].forEach((p, i) => {
      const y = 50 + i * 80;
      if (imgs[i].complete) g.drawImage(imgs[i], xs[i] - 28, y - 28, 56, 56);
      g.font = '600 16px Inter, sans-serif';
      g.fillStyle = p.color;
      g.fillText(`${i ? '🥈' : '🥇'} ${p.name}`, 12, y + 6);
    });
    g.fillStyle = '#ffd23f';
    g.font = '14px Bungee, sans-serif';
    g.fillText(`by ${(margin / 1000).toFixed(2)}s`, line - 110, cv.height - 12);
    requestAnimationFrame(draw);
  };
  draw();
}

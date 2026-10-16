/*
 * Find Property — paints one frame of the search field onto a 2D context.
 * Pure drawing: it reads the state and never changes it.
 */
import { along, type FieldState } from './searchField.ts';

export interface FieldPalette { gold: string; ink: string; node: string }
const hsla = (hsl: string, a: number) => `hsl(${hsl} / ${a.toFixed(3)})`;

export function drawField(ctx: CanvasRenderingContext2D, s: FieldState, palette: FieldPalette): void {
  const { w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const searching = s.mode === 'SEARCHING';

  for (const p of s.particles) {
    ctx.fillStyle = hsla(palette.node, p.alpha * (0.7 + 0.3 * Math.sin(s.time * 0.8 + p.phase)));
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }

  // Faint links between neighbouring lit listings: the field remembers where it has been.
  ctx.lineWidth = 0.6;
  for (let i = 0; i < s.nodes.length; i++) {
    const a = s.nodes[i];
    if (a.glow < 0.15) continue;
    for (let j = i + 1; j < s.nodes.length; j++) {
      const b = s.nodes[j];
      if (b.glow < 0.15) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > Math.min(w, h) * 0.55) continue;
      ctx.strokeStyle = hsla(palette.gold, 0.12 * Math.min(a.glow, b.glow));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  for (const b of s.branches) {
    const to = s.nodes[b.to];
    const steps = 18, end = Math.max(1, Math.round(steps * b.progress));
    ctx.strokeStyle = hsla(palette.gold, 0.45 * b.fade);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.from.x, b.from.y);
    for (let i = 1; i <= end; i++) { const q = along(b, to, i / steps); ctx.lineTo(q.x, q.y); }
    ctx.stroke();
    if (b.progress < 1) {
      const tip = along(b, to, b.progress);
      ctx.fillStyle = hsla(palette.gold, 0.9);
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  for (const n of s.nodes) {
    const breathe = 0.5 + 0.5 * Math.sin(s.time * 1.1 + n.phase);
    if (n.glow > 0.02) {
      ctx.fillStyle = hsla(palette.gold, 0.18 * n.glow);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 4.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = n.glow > 0.02 ? hsla(palette.gold, 0.5 + 0.5 * n.glow) : hsla(palette.node, 0.28 + 0.18 * breathe);
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
  }

  // The path: older segments fade, the head end is brightest.
  const trail = s.trail;
  if (trail.length > 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const u = i / (trail.length - 1);
      ctx.strokeStyle = hsla(palette.gold, (searching ? 0.75 : 0.35) * u * u);
      ctx.lineWidth = 0.6 + 2.2 * u;
      ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
    }
  }
  if (searching) {
    const glow = ctx.createRadialGradient(s.head.x, s.head.y, 0, s.head.x, s.head.y, 16);
    glow.addColorStop(0, hsla(palette.gold, 0.55));
    glow.addColorStop(1, hsla(palette.gold, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(s.head.x, s.head.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsla(palette.ink, 1);
    ctx.beginPath(); ctx.arc(s.head.x, s.head.y, 2.6, 0, Math.PI * 2); ctx.fill();
  }
}

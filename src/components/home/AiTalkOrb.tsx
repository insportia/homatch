/*
 * AI TALK — the voice, as something to look at.
 *
 * WHY A CANVAS AND NOT CSS
 *
 * The orb has to react to a number that changes fifty times a second. Driving
 * that through React state re-renders the whole panel on every audio block;
 * driving it through CSS custom properties still hands the browser a fresh
 * style recalculation each time. A canvas reads the level from a ref inside
 * its own animation frame and touches nothing else on the page.
 *
 * WHAT IT MUST NEVER DO
 *
 * Animate independently of the thing it claims to show. An idle shimmer that
 * keeps moving while the microphone is dead is a lie told at exactly the
 * moment a person is trying to work out whether they are being heard. Every
 * ring below is driven by a real measured level, and the only motion that is
 * not is the slow breathing when nothing is happening at all — which is
 * honest, because nothing IS happening.
 */

import { useEffect, useRef } from 'react';

export type OrbMode = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR';

interface OrbProps {
  mode: OrbMode;
  /** Live input or output level, 0-1, read every frame. */
  level: () => number;
  className?: string;
}

/** Homatch gold, and the graphite it sits on. */
const GOLD = [212, 168, 83] as const;
const COOL = [226, 232, 240] as const;
const ROSE = [244, 143, 160] as const;

function palette(mode: OrbMode): readonly [number, number, number] {
  if (mode === 'ERROR') return ROSE;
  if (mode === 'LISTENING') return COOL;
  return GOLD;
}

export function AiTalkOrb({ mode, level, className }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);

  modeRef.current = mode;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let timer = 0;
    let width = 0;
    let height = 0;
    /*
     * THE LOOP ONLY RUNS WHEN THERE IS SOMETHING TO SEE.
     *
     * This sits on the homepage, which means it is on screen for every
     * visitor whether or not they ever press the button. A permanently
     * running animation frame there is real battery on a phone and real CPU
     * on a laptop, for a shape that is doing almost nothing.
     *
     * So it pauses when the tab is hidden and when the panel is scrolled out
     * of view, and it idles at a quarter of the frame rate when nothing is
     * happening. Sixty frames a second is for a voice reacting to a voice.
     */
    let visible = true;
    let hidden = document.visibilityState === 'hidden';

    let smoothed = 0;
    let phase = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);

    const seenObserver = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      schedule();
    }, { threshold: 0 });
    seenObserver.observe(canvas);

    const onVisibility = () => { hidden = document.visibilityState === 'hidden'; schedule(); };
    document.addEventListener('visibilitychange', onVisibility);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    function schedule() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (timer) { clearTimeout(timer); timer = 0; }
      if (hidden || !visible) return;

      const busy = modeRef.current !== 'IDLE' && modeRef.current !== 'ERROR';
      if (busy && !reduced) {
        raf = requestAnimationFrame(() => { draw(); schedule(); });
      } else {
        // Resting: a slow breath, four frames a second, which is plenty for
        // something moving by a couple of pixels.
        timer = window.setTimeout(() => {
          raf = requestAnimationFrame(() => { draw(); schedule(); });
        }, reduced ? 1000 : 250);
      }
    }

    const draw = () => {
      const m = modeRef.current;

      let target = 0;
      try { target = Math.max(0, Math.min(1, levelRef.current() || 0)); } catch { target = 0; }

      // Speech sits low in the 0-1 range; a linear mapping barely moves.
      const shaped = Math.pow(target, 0.55);
      smoothed += (shaped - smoothed) * (shaped > smoothed ? 0.35 : 0.08);

      // Advance by wall time rather than by frame, so the breath is the same
      // speed whether the loop is running at 60fps or at 4.
      const now = performance.now();
      phase = (now / 1000) * (reduced ? 0.25 : 1.0);

      const cx = width / 2;
      const cy = height / 2;
      const base = Math.min(width, height) * 0.5;
      const [r, g, b] = palette(m);

      ctx.clearRect(0, 0, width, height);

      // Breathing when nothing is happening; a calm orbit while thinking.
      const breath = m === 'THINKING'
        ? 0.06 + Math.sin(phase * 2.2) * 0.035
        : 0.035 + Math.sin(phase) * 0.02;
      const energy = m === 'LISTENING' || m === 'SPEAKING' ? smoothed : 0;

      // Outer halo.
      const haloR = base * (0.62 + breath + energy * 0.34);
      const halo = ctx.createRadialGradient(cx, cy, haloR * 0.2, cx, cy, haloR);
      halo.addColorStop(0, `rgba(${r},${g},${b},${0.20 + energy * 0.30})`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // The body: a soft disc that grows with the voice.
      const bodyR = base * (0.30 + breath * 0.5 + energy * 0.16);
      const body = ctx.createRadialGradient(
        cx - bodyR * 0.3, cy - bodyR * 0.35, bodyR * 0.15, cx, cy, bodyR,
      );
      body.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      body.addColorStop(0.6, `rgba(${r},${g},${b},0.55)`);
      body.addColorStop(1, `rgba(${r},${g},${b},0.14)`);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
      ctx.fill();

      // A ring that traces the level, deforming like a membrane rather than
      // pulsing like a circle.
      const ringR = base * (0.44 + breath * 0.6 + energy * 0.22);
      ctx.beginPath();
      const POINTS = 96;
      for (let i = 0; i <= POINTS; i++) {
        const a = (i / POINTS) * Math.PI * 2;
        const wobble = m === 'IDLE' || m === 'ERROR'
          ? 0
          : (Math.sin(a * 3 + phase * 2.1) * 0.5 + Math.sin(a * 5 - phase * 1.4) * 0.5)
            * energy * base * 0.085;
        const rr = ringR + wobble;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.34 + energy * 0.5})`;
      ctx.lineWidth = 1.25 + energy * 1.6;
      ctx.stroke();

      // Thinking: three points travelling the ring, so waiting has a pulse
      // that is clearly not the microphone.
      if (m === 'THINKING') {
        for (let i = 0; i < 3; i++) {
          const a = phase * 1.35 + (i * Math.PI * 2) / 3;
          const x = cx + Math.cos(a) * ringR;
          const y = cy + Math.sin(a) * ringR;
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
          ctx.fill();
        }
      }
    };

    draw();
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      sizeObserver.disconnect();
      seenObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
    />
  );
}

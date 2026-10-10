import { Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/*
 * The way into Snake while a long job runs: a live game card, not a text
 * button. A small board plays itself — the snake circles, eats, grows — and
 * hurries on hover, so the card reads as a game before anyone opens it. The
 * whole card is one button. Purely local UI: it never touches the job.
 *
 * Reduced motion: a still board. Hidden tab: the loop stops.
 */
const COLS = 20;
const ROWS = 7;
const CELL = 10;

// A closed track around the board (x 1..18, y 1..5), clockwise.
const TRACK: Array<[number, number]> = (() => {
  const p: Array<[number, number]> = [];
  for (let x = 1; x <= 18; x++) p.push([x, 1]);
  for (let y = 2; y <= 5; y++) p.push([18, y]);
  for (let x = 17; x >= 1; x--) p.push([x, 5]);
  for (let y = 4; y >= 2; y--) p.push([1, y]);
  return p;
})();
const MIN_LEN = 6;
const MAX_LEN = 12;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function SnakeLaunchCard({ label, bestLabel, onOpen, testId }: {
  label: string;
  /** e.g. "Best: 14" — omitted when there is no record yet. */
  bestLabel?: string | null;
  onOpen: () => void;
  testId?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [head, setHead] = useState(MIN_LEN - 1);
  const [len, setLen] = useState(MIN_LEN);
  const [food, setFood] = useState(MIN_LEN + 10);
  const [burst, setBurst] = useState<number | null>(null);
  const fast = useRef(false);

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (typeof document === 'undefined' || !document.hidden) {
        setHead((h) => (h + 1) % TRACK.length);
      }
      timer = setTimeout(tick, fast.current ? 70 : 150);
    };
    timer = setTimeout(tick, 150);
    return () => clearTimeout(timer);
  }, [reduced]);

  // Eating: the head reaches the food → grow (wrapping back to short), and
  // the food moves well ahead on the track.
  useEffect(() => {
    if (head !== food) return;
    setBurst(food);
    setLen((l) => (l >= MAX_LEN ? MIN_LEN : l + 1));
    setFood((f) => (f + 13 + (f % 5)) % TRACK.length);
    const t = setTimeout(() => setBurst(null), 420);
    return () => clearTimeout(t);
  }, [head, food]);

  const body = useMemo(() => {
    const cells: Array<[number, number]> = [];
    for (let i = len - 1; i >= 0; i--) cells.push(TRACK[(head - i + TRACK.length) % TRACK.length]);
    return cells; // tail → head
  }, [head, len]);

  const [fx, fy] = TRACK[food];
  const score = len - MIN_LEN;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => { fast.current = true; }}
      onMouseLeave={() => { fast.current = false; }}
      onFocus={() => { fast.current = true; }}
      onBlur={() => { fast.current = false; }}
      data-testid={testId}
      className="group relative isolate block w-full overflow-hidden rounded-2xl bg-[#0A0B0D] p-px text-start shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] transition-transform duration-200 ease-out motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9B949] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Gold hairline that brightens on hover. */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-2xl bg-[linear-gradient(135deg,rgba(233,185,73,0.55),rgba(233,185,73,0.08)_40%,rgba(233,185,73,0.08)_60%,rgba(233,185,73,0.5))] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="relative flex items-center gap-3 rounded-[15px] bg-[#0A0B0D] p-2.5 sm:gap-4 sm:p-3">
        <span className="relative block w-[46%] max-w-[260px] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
          <svg viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`} className="block h-auto w-full" aria-hidden="true">
            <defs>
              <radialGradient id="sl-glow" cx="85%" cy="0%" r="95%">
                <stop offset="0%" stopColor="#E9B949" stopOpacity="0.22" />
                <stop offset="75%" stopColor="#E9B949" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={COLS * CELL} height={ROWS * CELL} fill="#0F1114" />
            {Array.from({ length: COLS * ROWS }, (_, i) => ((i % COLS) + Math.floor(i / COLS)) % 2 === 0 ? (
              <rect key={i} x={(i % COLS) * CELL} y={Math.floor(i / COLS) * CELL} width={CELL} height={CELL} fill="#ffffff" opacity="0.03" />
            ) : null)}
            <rect width={COLS * CELL} height={ROWS * CELL} fill="url(#sl-glow)" />
            {burst !== null && (
              <circle cx={TRACK[burst][0] * CELL + CELL / 2} cy={TRACK[burst][1] * CELL + CELL / 2} r="9" fill="none" stroke="#E9B949" strokeWidth="1.5" className="motion-safe:animate-ping" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
            )}
            <circle cx={fx * CELL + CELL / 2} cy={fy * CELL + CELL / 2} r="3.2" fill="#F2C75C" className="motion-safe:animate-pulse" />
            {body.map(([x, y], i) => {
              const isHead = i === body.length - 1;
              return (
                <rect
                  key={i}
                  x={x * CELL + 1.1}
                  y={y * CELL + 1.1}
                  width={CELL - 2.2}
                  height={CELL - 2.2}
                  rx={isHead ? 3 : 2}
                  fill={isHead ? '#FFD978' : '#E9B949'}
                  opacity={0.35 + (i / body.length) * 0.65}
                />
              );
            })}
            <rect x={COLS * CELL - 38} y="5" width="32" height="12" rx="6" fill="#ffffff" opacity="0.1" />
            <text x={COLS * CELL - 22} y="14" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#ffffff" opacity="0.85">{String(score).padStart(2, '0')}</text>
          </svg>
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold leading-snug text-white break-words sm:text-[15px]">{label}</span>
          {bestLabel ? <span className="text-xs text-white/55">{bestLabel}</span> : null}
        </span>

        <span aria-hidden="true" className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#F6D27A,#D9A233)] text-[#14100A] shadow-[0_0_0_4px_rgba(233,185,73,0.14)] transition-transform duration-200 motion-safe:group-hover:scale-110">
          <span className="absolute inset-0 rounded-full ring-2 ring-[#E9B949]/50 motion-safe:animate-ping [animation-duration:2.2s]" />
          <Play className="relative h-5 w-5 translate-x-[1px] fill-current rtl:-scale-x-100" />
        </span>
      </span>
    </button>
  );
}

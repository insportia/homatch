// HOMATCH SNAKE — the game's rules, pure (no timers, no DOM, no randomness of
// its own: the caller passes the random source, so a game is replayable and
// testable).
//
// A board of cols × rows cells. A new game waits for the first move (any
// direction starts it; the opposite one turns the snake round). The snake
// moves one cell per step in its direction; turns are buffered (up to three)
// and can never reverse it onto itself. Eating the food grows the snake by one
// and scores one; the next food appears on a free cell. A step that would hit
// the edge or the snake is held once (one step of grace to turn away); hitting
// it again ends the game. Pausing freezes it; restarting begins a fresh game.
//
// The rules move in whole cells; how a step looks between two cells
// (`between`) is the renderer's business, so the game reads smoothly at any
// refresh rate while its speed comes from `tickMs` alone.

export type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export interface Cell { x: number; y: number }

export interface SnakeState {
  cols: number;
  rows: number;
  /** Head first. */
  snake: Cell[];
  dir: Dir;
  /** Turns asked for since the last step (at most three, so quick turns between steps are never lost). */
  queue: Dir[];
  /** Moving yet: a new game waits for the first move. */
  started: boolean;
  /** The last step was held at an edge or the snake (its one step of grace). */
  graced: boolean;
  food: Cell | null;
  score: number;
  alive: boolean;
  paused: boolean;
  /** Every cell filled: the game is won. */
  won: boolean;
}

export type Rng = () => number;

const DELTA: Record<Dir, Cell> = { UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** A free cell for the food, chosen by `rng`; null when the board is full. */
export function placeFood(cols: number, rows: number, snake: Cell[], rng: Rng): Cell | null {
  const taken = new Set(snake.map((c) => c.y * cols + c.x));
  const free = cols * rows - taken.size;
  if (free <= 0) return null;
  let k = Math.min(free - 1, Math.floor(rng() * free));
  for (let i = 0; i < cols * rows; i += 1) {
    if (taken.has(i)) continue;
    if (k === 0) return { x: i % cols, y: Math.floor(i / cols) };
    k -= 1;
  }
  return null;
}

export function createGame(cols: number, rows: number, rng: Rng): SnakeState {
  const y = Math.floor(rows / 2);
  const x = Math.floor(cols / 3);
  const snake = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
  return { cols, rows, snake, dir: 'RIGHT', queue: [], started: false, graced: false, food: placeFood(cols, rows, snake, rng), score: 0, alive: true, paused: false, won: false };
}

/** Begin moving now (a restart the customer asked for need not wait for another move). */
export const start = (s: SnakeState): SnakeState => (s.alive && !s.started ? { ...s, started: true } : s);

/**
 * Ask for a turn. The first move starts the game (the opposite way turns the
 * snake round first). After that a reversal (or a repeat) of the direction it
 * will be moving in is ignored, and at most three turns wait for the next steps.
 */
export function turn(s: SnakeState, dir: Dir): SnakeState {
  if (!s.alive || s.paused) return s;
  if (!s.started) {
    if (dir === s.dir) return { ...s, started: true };
    if (dir === OPPOSITE[s.dir]) return { ...s, started: true, dir, snake: [...s.snake].reverse() };
    return { ...s, started: true, queue: [dir] };
  }
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (dir === last || dir === OPPOSITE[last] || s.queue.length >= 3) return s;
  return { ...s, queue: [...s.queue, dir] };
}

export const togglePause = (s: SnakeState): SnakeState => (s.alive ? { ...s, paused: !s.paused } : s);

/** One step of the game. */
export function step(s: SnakeState, rng: Rng): SnakeState {
  if (!s.alive || s.paused || !s.started) return s;
  const [next, ...rest] = s.queue;
  const dir = next ?? s.dir;
  const d = DELTA[dir];
  const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };
  const eats = !!s.food && same(head, s.food);
  // The tail moves away this step unless the snake grows, so stepping into it is allowed.
  const body = eats ? s.snake : s.snake.slice(0, -1);
  const out = head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows;
  if (out || body.some((c) => same(c, head))) {
    // One step of grace: held where it is, facing the danger, so a late turn still saves it.
    if (!s.graced) return { ...s, dir, queue: rest, graced: true };
    return { ...s, dir, queue: rest, alive: false };
  }
  const snake = [head, ...body];
  if (!eats) return { ...s, snake, dir, queue: rest, graced: false };
  const food = placeFood(s.cols, s.rows, snake, rng);
  return { ...s, snake, dir, queue: rest, graced: false, score: s.score + 1, food, won: food === null, alive: food !== null };
}

/**
 * Where each part of the snake is drawn `t` (0..1) of the way through a step
 * from `prev` to `next` (head first): every part slides from where it was to
 * where it is now; a part that is new this step (the snake grew) grows out of
 * the old tail.
 */
export function between(prev: Cell[], next: Cell[], t: number): Array<{ x: number; y: number }> {
  const k = Math.max(0, Math.min(1, t));
  return next.map((to, i) => {
    const from = prev[i] ?? prev[prev.length - 1] ?? to;
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  });
}

/**
 * A tap on the board turns the snake towards it: going left or right, a tap
 * above or below turns it up or down; going up or down, a tap to a side turns
 * it that way. Null for a tap on (or in line with) the head.
 */
export function tapDir(head: { x: number; y: number }, dir: Dir, at: { x: number; y: number }): Dir | null {
  const dx = at.x - head.x; const dy = at.y - head.y;
  if (Math.hypot(dx, dy) < 0.6) return null;
  if (dir === 'LEFT' || dir === 'RIGHT') return Math.abs(dy) < 0.35 ? null : dy > 0 ? 'DOWN' : 'UP';
  return Math.abs(dx) < 0.35 ? null : dx > 0 ? 'RIGHT' : 'LEFT';
}

/** The direction of a swipe (or null when it was a tap): the dominant axis, so a sloppy diagonal still reads. */
export function swipeDir(dx: number, dy: number, min = 24): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
}

/** The direction a key asks for: arrows and WASD (layout-independent `code` first). */
export function keyDir(e: { key?: string; code?: string }): Dir | null {
  switch (e.code ?? '') {
    case 'ArrowUp': case 'KeyW': return 'UP';
    case 'ArrowDown': case 'KeyS': return 'DOWN';
    case 'ArrowLeft': case 'KeyA': return 'LEFT';
    case 'ArrowRight': case 'KeyD': return 'RIGHT';
    default: break;
  }
  switch ((e.key ?? '').toLowerCase()) {
    case 'arrowup': case 'w': return 'UP';
    case 'arrowdown': case 's': return 'DOWN';
    case 'arrowleft': case 'a': return 'LEFT';
    case 'arrowright': case 'd': return 'RIGHT';
    default: return null;
  }
}

/**
 * Milliseconds per step: an easy, casual opening pace that quickens gently
 * with the score (about a quarter faster after 20 points, never frantic), and
 * calmer still when motion is reduced.
 */
export function tickMs(score: number, reducedMotion: boolean): number {
  const base = reducedMotion ? 280 : 230;
  return Math.max(reducedMotion ? 180 : 125, Math.round(base - score * 2.5));
}

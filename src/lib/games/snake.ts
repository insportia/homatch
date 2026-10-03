// HOMATCH SNAKE — the game's rules, pure (no timers, no DOM, no randomness of
// its own: the caller passes the random source, so a game is replayable and
// testable).
//
// A board of cols × rows cells. The snake moves one cell per step in its
// direction; a turn takes effect on the next step and can never reverse it
// onto itself. Eating the food grows the snake by one and scores one; the
// next food appears on a free cell. Leaving the board or running into itself
// ends the game. Pausing freezes it; restarting begins a fresh game.

export type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export interface Cell { x: number; y: number }

export interface SnakeState {
  cols: number;
  rows: number;
  /** Head first. */
  snake: Cell[];
  dir: Dir;
  /** Turns asked for since the last step (at most two, so a quick double turn is honoured). */
  queue: Dir[];
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
  return { cols, rows, snake, dir: 'RIGHT', queue: [], food: placeFood(cols, rows, snake, rng), score: 0, alive: true, paused: false, won: false };
}

/** Ask for a turn. A reversal (or a repeat) of the direction it will be moving in is ignored. */
export function turn(s: SnakeState, dir: Dir): SnakeState {
  if (!s.alive || s.paused) return s;
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (dir === last || dir === OPPOSITE[last] || s.queue.length >= 2) return s;
  return { ...s, queue: [...s.queue, dir] };
}

export const togglePause = (s: SnakeState): SnakeState => (s.alive ? { ...s, paused: !s.paused } : s);

/** One step of the game. */
export function step(s: SnakeState, rng: Rng): SnakeState {
  if (!s.alive || s.paused) return s;
  const [next, ...rest] = s.queue;
  const dir = next ?? s.dir;
  const d = DELTA[dir];
  const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };
  const eats = !!s.food && same(head, s.food);
  // The tail moves away this step unless the snake grows, so stepping into it is allowed.
  const body = eats ? s.snake : s.snake.slice(0, -1);
  const out = head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows;
  if (out || body.some((c) => same(c, head))) return { ...s, dir, queue: rest, alive: false };
  const snake = [head, ...body];
  if (!eats) return { ...s, snake, dir, queue: rest };
  const food = placeFood(s.cols, s.rows, snake, rng);
  return { ...s, snake, dir, queue: rest, score: s.score + 1, food, won: food === null, alive: food !== null };
}

/** The direction of a swipe (or null when it was a tap). */
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

/** Steps per second: a little faster as the snake grows, slower when motion is reduced. */
export function tickMs(score: number, reducedMotion: boolean): number {
  const base = reducedMotion ? 210 : 150;
  return Math.max(reducedMotion ? 150 : 85, base - score * 3);
}

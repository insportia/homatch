// HOMATCH SNAKE — the rules, played out step by step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, keyDir, placeFood, step, swipeDir, tickMs, togglePause, turn } from '../snake.ts';

const zero = () => 0;

test('a new game: three cells long, moving right, food on a free cell, score 0', () => {
  const g = createGame(12, 12, zero);
  assert.equal(g.snake.length, 3);
  assert.equal(g.dir, 'RIGHT');
  assert.equal(g.score, 0);
  assert.ok(g.alive && !g.paused && !g.won);
  assert.ok(g.food && !g.snake.some((c) => c.x === g.food.x && c.y === g.food.y));
});

test('it moves one cell per step in its direction', () => {
  const g = createGame(12, 12, zero);
  const n = step({ ...g, food: { x: 0, y: 0 } }, zero);
  assert.deepEqual(n.snake[0], { x: g.snake[0].x + 1, y: g.snake[0].y });
  assert.equal(n.snake.length, 3);
});

test('eating grows it by one, scores one and puts new food on a free cell', () => {
  const g = createGame(12, 12, zero);
  const ahead = { x: g.snake[0].x + 1, y: g.snake[0].y };
  const n = step({ ...g, food: ahead }, () => 0.5);
  assert.equal(n.score, 1);
  assert.equal(n.snake.length, 4);
  assert.ok(n.food && !n.snake.some((c) => c.x === n.food.x && c.y === n.food.y));
});

test('a reversal is ignored; a turn takes effect on the next step', () => {
  let g = createGame(12, 12, zero);
  g = { ...g, food: { x: 0, y: 0 } };
  assert.equal(turn(g, 'LEFT').queue.length, 0, 'never back onto itself');
  const up = turn(g, 'UP');
  assert.deepEqual(up.queue, ['UP']);
  const n = step(up, zero);
  assert.equal(n.dir, 'UP');
  assert.deepEqual(n.snake[0], { x: g.snake[0].x, y: g.snake[0].y - 1 });
});

test('a quick double turn is honoured (up then left, from moving right)', () => {
  let g = { ...createGame(12, 12, zero), food: { x: 0, y: 0 } };
  g = turn(turn(g, 'UP'), 'LEFT');
  assert.deepEqual(g.queue, ['UP', 'LEFT']);
  g = step(step(g, zero), zero);
  assert.equal(g.dir, 'LEFT');
  assert.ok(g.alive);
});

test('leaving the board ends the game', () => {
  let g = { ...createGame(6, 6, zero), food: { x: 0, y: 0 } };
  for (let i = 0; i < 10 && g.alive; i += 1) g = step(g, zero);
  assert.equal(g.alive, false);
});

test('running into itself ends the game', () => {
  const g = {
    cols: 8, rows: 8, dir: 'LEFT', queue: [], food: { x: 7, y: 7 }, score: 0, alive: true, paused: false, won: false,
    snake: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }],
  };
  const n = step(turn(g, 'UP'), zero);
  assert.equal(n.alive, false);
});

test('moving into the cell the tail leaves is allowed', () => {
  const g = {
    cols: 8, rows: 8, dir: 'UP', queue: [], food: { x: 7, y: 7 }, score: 0, alive: true, paused: false, won: false,
    snake: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
  };
  assert.equal(step(g, zero).alive, true);
});

test('pause freezes the game; restart is a fresh game', () => {
  const g = { ...createGame(12, 12, zero), food: { x: 0, y: 0 } };
  const p = togglePause(g);
  assert.equal(step(p, zero), p);
  assert.equal(turn(p, 'UP'), p);
  const fresh = createGame(12, 12, zero);
  assert.equal(fresh.score, 0);
  assert.ok(fresh.alive);
});

test('food is placed only on free cells; a full board has none', () => {
  const snake = [];
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) snake.push({ x, y });
  assert.equal(placeFood(2, 2, snake, zero), null);
  assert.deepEqual(placeFood(2, 2, snake.slice(0, 3), () => 0.99), { x: 1, y: 1 });
});

test('controls: arrows and WASD (by code, any layout), swipes, taps', () => {
  assert.equal(keyDir({ code: 'ArrowUp' }), 'UP');
  assert.equal(keyDir({ code: 'KeyA', key: 'ა' }), 'LEFT', 'a Georgian layout still steers by physical key');
  assert.equal(keyDir({ key: 'd' }), 'RIGHT');
  assert.equal(keyDir({ key: 'Enter' }), null);
  assert.equal(swipeDir(60, 5), 'RIGHT');
  assert.equal(swipeDir(-3, -80), 'UP');
  assert.equal(swipeDir(5, 6), null, 'a tap is not a swipe');
});

test('speed rises with the score and is gentler with reduced motion', () => {
  assert.ok(tickMs(10, false) < tickMs(0, false));
  assert.ok(tickMs(0, true) > tickMs(0, false));
  assert.ok(tickMs(1000, false) >= 85);
});

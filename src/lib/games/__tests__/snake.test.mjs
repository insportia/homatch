// HOMATCH SNAKE — the rules, played out step by step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { between, createGame, keyDir, placeFood, start, step, swipeDir, tapDir, tickMs, togglePause, turn } from '../snake.ts';

const zero = () => 0;
/** A game already moving, with its food out of the way. */
const moving = (cols = 12, rows = 12) => start({ ...createGame(cols, rows, zero), food: { x: 0, y: 0 } });

test('a new game: three cells long, facing right, food on a free cell, score 0, waiting for the first move', () => {
  const g = createGame(12, 12, zero);
  assert.equal(g.snake.length, 3);
  assert.equal(g.dir, 'RIGHT');
  assert.equal(g.score, 0);
  assert.ok(g.alive && !g.paused && !g.won && !g.started);
  assert.ok(g.food && !g.snake.some((c) => c.x === g.food.x && c.y === g.food.y));
  assert.equal(step(g, zero), g, 'nothing moves until the customer does');
});

test('the first move starts it: the same way, a side, or the opposite way (the snake turns round)', () => {
  const g = { ...createGame(12, 12, zero), food: { x: 0, y: 0 } };
  const same = turn(g, 'RIGHT');
  assert.ok(same.started);
  assert.deepEqual(step(same, zero).snake[0], { x: g.snake[0].x + 1, y: g.snake[0].y });
  const side = step(turn(g, 'UP'), zero);
  assert.deepEqual(side.snake[0], { x: g.snake[0].x, y: g.snake[0].y - 1 });
  const back = turn(g, 'LEFT');
  assert.equal(back.dir, 'LEFT');
  assert.deepEqual(back.snake[0], g.snake[2], 'the old tail is the new head');
  assert.ok(step(back, zero).alive, 'turning round at the start is never a collision');
});

test('it moves one cell per step in its direction', () => {
  const g = moving();
  const n = step(g, zero);
  assert.deepEqual(n.snake[0], { x: g.snake[0].x + 1, y: g.snake[0].y });
  assert.equal(n.snake.length, 3);
});

test('eating grows it by one, scores one and puts new food on a free cell', () => {
  const g = moving();
  const ahead = { x: g.snake[0].x + 1, y: g.snake[0].y };
  const n = step({ ...g, food: ahead }, () => 0.5);
  assert.equal(n.score, 1);
  assert.equal(n.snake.length, 4);
  assert.ok(n.food && !n.snake.some((c) => c.x === n.food.x && c.y === n.food.y));
});

test('a reversal is ignored; a turn takes effect on the next step', () => {
  const g = moving();
  assert.equal(turn(g, 'LEFT').queue.length, 0, 'never back onto itself');
  const up = turn(g, 'UP');
  assert.deepEqual(up.queue, ['UP']);
  const n = step(up, zero);
  assert.equal(n.dir, 'UP');
  assert.deepEqual(n.snake[0], { x: g.snake[0].x, y: g.snake[0].y - 1 });
});

test('quick turns between steps are buffered, up to three, and never lost', () => {
  let g = turn(turn(moving(), 'UP'), 'LEFT');
  assert.deepEqual(g.queue, ['UP', 'LEFT']);
  g = turn(g, 'DOWN');
  assert.deepEqual(g.queue, ['UP', 'LEFT', 'DOWN']);
  assert.deepEqual(turn(g, 'RIGHT').queue, ['UP', 'LEFT', 'DOWN'], 'a fourth waits for room');
  g = step(step(g, zero), zero);
  assert.equal(g.dir, 'LEFT');
  assert.ok(g.alive);
});

test('the edge: one step of grace to turn away, then the game ends', () => {
  let g = moving(6, 6);
  for (let i = 0; i < 20 && !g.graced; i += 1) g = step(g, zero);
  assert.ok(g.graced && g.alive, 'held at the edge');
  const head = g.snake[0];
  const saved = step(turn(g, 'UP'), zero);
  assert.ok(saved.alive && !saved.graced, 'a late turn saves it');
  assert.deepEqual(saved.snake[0], { x: head.x, y: head.y - 1 });
  const lost = step(g, zero);
  assert.equal(lost.alive, false, 'going on into the edge ends it');
});

test('running into itself: held once, then the game ends', () => {
  const g = {
    cols: 8, rows: 8, dir: 'LEFT', queue: [], started: true, graced: false, food: { x: 7, y: 7 }, score: 0, alive: true, paused: false, won: false,
    snake: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }],
  };
  const held = step(turn(g, 'UP'), zero);
  assert.ok(held.alive && held.graced);
  assert.deepEqual(held.snake, g.snake, 'nothing moved');
  assert.equal(step(held, zero).alive, false);
});

test('moving into the cell the tail leaves is allowed', () => {
  const g = {
    cols: 8, rows: 8, dir: 'UP', queue: [], started: true, graced: false, food: { x: 7, y: 7 }, score: 0, alive: true, paused: false, won: false,
    snake: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
  };
  const n = step(g, zero);
  assert.equal(n.alive, true);
  assert.equal(n.graced, false);
});

test('pause freezes the game; restart is a fresh game', () => {
  const p = togglePause(moving());
  assert.equal(step(p, zero), p);
  assert.equal(turn(p, 'UP'), p);
  const fresh = createGame(12, 12, zero);
  assert.equal(fresh.score, 0);
  assert.ok(fresh.alive);
  assert.ok(start(fresh).started, 'a restart the customer asked for can begin at once');
});

test('food is placed only on free cells inside the board; a full board has none', () => {
  const snake = [];
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) snake.push({ x, y });
  assert.equal(placeFood(2, 2, snake, zero), null);
  assert.deepEqual(placeFood(2, 2, snake.slice(0, 3), () => 0.99), { x: 1, y: 1 });
  for (let i = 0; i < 200; i += 1) {
    const f = placeFood(17, 17, [{ x: 5, y: 8 }, { x: 4, y: 8 }], Math.random);
    assert.ok(f.x >= 0 && f.x < 17 && f.y >= 0 && f.y < 17);
  }
});

test('controls: arrows and WASD (by code, any layout), swipes by their dominant axis, taps towards a side', () => {
  assert.equal(keyDir({ code: 'ArrowUp' }), 'UP');
  assert.equal(keyDir({ code: 'KeyA', key: 'ა' }), 'LEFT', 'a Georgian layout still steers by physical key');
  assert.equal(keyDir({ key: 'd' }), 'RIGHT');
  assert.equal(keyDir({ key: 'Enter' }), null);
  assert.equal(swipeDir(60, 5), 'RIGHT');
  assert.equal(swipeDir(-3, -80), 'UP');
  assert.equal(swipeDir(40, -30), 'RIGHT', 'a sloppy diagonal reads as its dominant direction');
  assert.equal(swipeDir(-22, 30, 16), 'DOWN');
  assert.equal(swipeDir(5, 6), null, 'a tap is not a swipe');
  const head = { x: 5.5, y: 5.5 };
  assert.equal(tapDir(head, 'RIGHT', { x: 9, y: 2 }), 'UP', 'going right, a tap above turns up');
  assert.equal(tapDir(head, 'RIGHT', { x: 1, y: 9 }), 'DOWN', 'even behind the head');
  assert.equal(tapDir(head, 'UP', { x: 9, y: 5 }), 'RIGHT');
  assert.equal(tapDir(head, 'UP', { x: 5.6, y: 1 }), null, 'in line with the way it goes: nothing to turn');
  assert.equal(tapDir(head, 'LEFT', { x: 5.7, y: 5.6 }), null, 'a tap on the head');
});

test('smooth: each part slides between its cells; a new part grows out of the old tail', () => {
  const prev = [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const next = [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }];
  assert.deepEqual(between(prev, next, 0), prev);
  assert.deepEqual(between(prev, next, 1), next);
  assert.deepEqual(between(prev, next, 0.5)[0], { x: 2.5, y: 1 });
  const grown = [{ x: 3, y: 1 }, ...prev];
  assert.deepEqual(between(prev, grown, 0.5)[3], { x: 0, y: 1 }, 'the new last part waits at the old tail');
  assert.deepEqual(between(prev, next, 7), next, 'clamped');
});

test('pace: an easy start, a gentle rise with the score, calmer with reduced motion, never frantic', () => {
  assert.ok(tickMs(0, false) >= 220, 'casual at the start');
  assert.ok(tickMs(10, false) < tickMs(0, false));
  assert.ok(tickMs(20, false) >= 170, 'a gentle rise');
  assert.ok(tickMs(0, true) > tickMs(0, false));
  assert.ok(tickMs(1000, false) >= 120);
});

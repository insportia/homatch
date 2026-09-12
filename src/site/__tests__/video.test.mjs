import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVideo, parseVideo } from '../video.ts';

/*
 * VIDEO URLS.
 *
 * This is the one content field whose stored value becomes an iframe src —
 * an arbitrary third-party document inside our page, with our users looking
 * at it. So the refusals here matter more than the acceptances, and they are
 * tested first.
 */

const ok = (input) => {
  const v = parseVideo(input);
  assert.ok(isVideo(v), `expected ${input} to be accepted, got ${JSON.stringify(v)}`);
  return v;
};
const err = (input) => {
  const v = parseVideo(input);
  assert.equal(isVideo(v), false, `expected ${input} to be refused`);
  return v.error;
};

test('a javascript: URL is refused, not embedded', () => {
  assert.equal(err('javascript:alert(1)'), 'insecure');
  assert.equal(err('JavaScript:alert(1)'), 'insecure');
});

test('a data: document is refused', () => {
  assert.equal(err('data:text/html,<script>alert(1)</script>'), 'insecure');
});

test('plain http is refused rather than silently upgraded', () => {
  // A mixed-content iframe is blocked by the browser anyway; refusing it here
  // means the admin is told, instead of finding an empty box in production.
  assert.equal(err('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'insecure');
});

test('an arbitrary https page is refused', () => {
  assert.equal(err('https://example.com/some/page'), 'unsupported');
  assert.equal(err('https://evil.test/embed/anything'), 'unsupported');
});

test('empty input is its own answer, not an error state', () => {
  assert.equal(err(''), 'empty');
  assert.equal(err('   '), 'empty');
  assert.equal(err(undefined), 'empty');
});

test('YouTube is accepted in every shape people actually paste', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ]) {
    const v = ok(url);
    assert.equal(v.kind, 'youtube');
    assert.equal(v.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  }
});

test('the YouTube embed is the no-cookie host, with no foreign related videos', () => {
  const v = ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.match(v.src, /youtube-nocookie\.com/, 'a marketing page should not set ad cookies');
  assert.match(v.src, /rel=0/, 'the end screen must not advertise other channels');
});

test('Vimeo is accepted and normalised to its player', () => {
  const v = ok('https://vimeo.com/123456789');
  assert.equal(v.kind, 'vimeo');
  assert.equal(v.src, 'https://player.vimeo.com/video/123456789');
  assert.equal(ok('https://vimeo.com/video/123456789').src, v.src);
});

test('a direct file is accepted, because <video> is not a document', () => {
  // It cannot run script or navigate, which is why it needs no provider.
  for (const ext of ['mp4', 'webm', 'ogg']) {
    const v = ok(`https://cdn.example.com/tour.${ext}`);
    assert.equal(v.kind, 'file');
  }
  assert.equal(ok('https://cdn.example.com/tour.mp4?v=2').kind, 'file');
});

test('a file over plain http is still refused', () => {
  assert.equal(err('http://cdn.example.com/tour.mp4'), 'insecure');
});

test('what the admin typed is kept, so the field can be shown back', () => {
  const typed = 'https://youtu.be/dQw4w9WgXcQ';
  assert.equal(ok(typed).original, typed);
});

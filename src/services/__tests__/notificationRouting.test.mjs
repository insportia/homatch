import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * EVERY NOTIFICATION GOES THROUGH ONE DOOR.
 *
 * `notify_emit` existed for a week before anything used it. Seventeen
 * `from('notifications').insert(...)` sites across thirteen files carried on
 * writing rows directly — which meant no dedupe, no aggregation, no
 * preferences, no quiet hours and no push, for every real product event in
 * Homatch. The pipeline was complete and connected to nothing.
 *
 * A migration fixes that once. This stops it drifting back: the easiest thing
 * for the next feature to do is copy the nearest existing notification, and
 * the nearest existing notification must not be a bare insert.
 *
 * WHAT IS ALLOWED TO TOUCH THE TABLE DIRECTLY
 *
 *   notify.ts        the helper itself — it is the door.
 *   push-send        reads a notification to decide delivery, and stamps
 *                    pushed_at afterwards. It does not create them.
 *   the client       SELECT and an UPDATE of (read, seen_at). Marking your
 *                    own notification read is not creating one, and the
 *                    grant makes creation impossible from a browser anyway.
 */

const ROOT = 'supabase/functions';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Files whose job is the notification table itself. */
const OWNERS = ['_shared/notify.ts', 'push-send/index.ts'];

function isOwner(file) {
  const path = file.replace(/\\/g, '/');
  return OWNERS.some((o) => path.endsWith(o));
}

test('no edge function writes the notifications table directly', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    if (isOwner(file)) continue;
    const src = readFileSync(file, 'utf8');
    /* `.insert(` on the notifications table, however it is spelled. Reads and
       updates are not the concern: creating is. */
    if (/from\(\s*['"]notifications['"]\s*\)\s*\.insert/.test(src)) {
      offenders.push(file.replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(offenders, [],
    `these bypass notify_emit, so their events get no dedupe, aggregation, preferences, quiet hours or push:\n${offenders.join('\n')}`);
});

test('the browser does not write the notifications table at all', () => {
  const offenders = [];
  const walkSrc = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walkSrc(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const src = readFileSync(full, 'utf8');
      if (/from\(\s*['"]notifications['"]\s*\)\s*\.insert/.test(src)) {
        offenders.push(full.replace(/\\/g, '/'));
      }
    }
  };
  walkSrc('src');
  /* `authenticated` holds SELECT and a column-scoped UPDATE and has never
     held INSERT, so a call like this is refused by the grant and swallowed by
     whatever catch is nearest. One shipped for months and told nobody
     anything; the console error was the only trace. */
  assert.deepEqual(offenders, [],
    `the client cannot insert notifications — the grant refuses it, silently:\n${offenders.join('\n')}`);
});

test('product code does not decide push for itself', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    if (isOwner(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (/invoke\(\s*['"]push-send['"]/.test(src)) offenders.push(file.replace(/\\/g, '/'));
  }
  /* Preferences, quiet hours, category and priority are one decision made in
     one place. A feature that calls push-send is a feature that will get one
     of those wrong, and it will be the one nobody tests: quiet hours. */
  assert.deepEqual(offenders, [],
    `these call push-send directly instead of letting notify() decide:\n${offenders.join('\n')}`);
});

test('the canonical helper is what the producers actually call', () => {
  /* The inverse of the checks above: proving nothing inserts is worthless if
     nothing notifies either. */
  let callers = 0;
  for (const file of walk(ROOT)) {
    if (isOwner(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*notify\.ts['"]/.test(src)) callers += 1;
  }
  assert.ok(callers >= 10,
    `only ${callers} functions import the notification helper — the migration is incomplete`);
});

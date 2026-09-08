import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logBrowserLifecycle, BrowserDisconnectedError } from '../.tstest-build/browser/BrowserlessRuntime.js';

// Mandate: "Diagnostics must never be able to break the research flow" and
// must never log a secret. These tests capture console.log to verify both
// invariants without touching real stdout expectations elsewhere.

function captureConsoleLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('logBrowserLifecycle: emits one JSON line with the event name and safe fields', () => {
  const lines = captureConsoleLog(() => {
    logBrowserLifecycle('research_context_ready', { jobId: 'job-123', source: 'TAS_MAP', adopted: true });
  });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.scope, 'browserless_lifecycle');
  assert.equal(parsed.event, 'research_context_ready');
  assert.equal(parsed.jobId, 'job-123');
  assert.equal(parsed.source, 'TAS_MAP');
  assert.equal(parsed.adopted, true);
  assert.equal(typeof parsed.at, 'string');
});

test('logBrowserLifecycle: never throws even when console.log itself throws (diagnostics must not be able to break the research flow)', () => {
  const original = console.log;
  console.log = () => {
    throw new Error('stdout is broken');
  };
  try {
    assert.doesNotThrow(() => logBrowserLifecycle('close_page', { jobId: 'job-1' }));
  } finally {
    console.log = original;
  }
});

test('logBrowserLifecycle: never throws on a circular fields object (JSON.stringify would otherwise throw)', () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logBrowserLifecycle('close_context', { circular }));
});

test('logBrowserLifecycle: default fields argument works when omitted entirely', () => {
  const lines = captureConsoleLog(() => {
    logBrowserLifecycle('browser_connected');
  });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, 'browser_connected');
});

// A meta-check on the mandate's explicit secret list: this is not a runtime
// guarantee (logBrowserLifecycle only ever receives what call sites pass
// it — see BrowserlessRuntime.ts's and ResearchOrchestrator.ts's own call
// sites, which are the actual audited boundary), but it documents and
// enforces the intended contract for this helper's own call sites within
// this file's exports: none of them ever pass a token/key/URL field name.
test('logBrowserLifecycle call sites contract: BrowserlessRuntime.ts source never logs a secret-named field', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/browser/BrowserlessRuntime.ts', import.meta.url), 'utf8');
  const forbidden = /logBrowserLifecycle\([^)]*\b(token|bridgeKey|BRIDGE_KEY|WORKER_TOKEN|connectUrl|cdpUrl)\b/i;
  const calls = src.match(/logBrowserLifecycle\([\s\S]*?\);/g) || [];
  assert.ok(calls.length > 0, 'expected at least one logBrowserLifecycle call site to check');
  for (const call of calls) {
    assert.equal(forbidden.test(call), false, `logBrowserLifecycle call site appears to reference a secret field: ${call}`);
  }
});

test('BrowserDisconnectedError: has the correct name and is a real Error subclass', () => {
  const e = new BrowserDisconnectedError('browser is gone');
  assert.equal(e.name, 'BrowserDisconnectedError');
  assert.equal(e.message, 'browser is gone');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof BrowserDisconnectedError);
});

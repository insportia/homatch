// META CONNECT — the one-button flow, as a small pure state machine.
//
//   IDLE ─tap→ PREPARING ─url→ REDIRECTING ─(Meta)→ back with ?connect=…
//                 │                 │
//                 └─error→ FAILED   └─back button (bfcache)→ IDLE
//
// There is exactly ONE way to Meta: a same-tab, top-level navigation to
// Meta's official Login dialog (www.facebook.com/<v>/dialog/oauth). Meta
// documents no way for a web page to hand its login to the Facebook app —
// app switch belongs to Meta's native Android/iOS SDKs — so HOMATCH never
// guesses a URI scheme. Where Facebook itself routes its dialog to the app,
// that happens inside Facebook's own page. One path means there is no second
// attempt to race: no timer, no popup, no fallback that could fire after a
// success.
//
// The return trip (draft and step) travels inside the signed OAuth state
// (oauth.ts safeReturnPath), so it survives a different browser context.

export type ConnectState = 'IDLE' | 'PREPARING' | 'REDIRECTING' | 'CONNECTED' | 'CANCELLED' | 'FAILED';
export type ConnectEvent =
  | { type: 'TAP' }
  | { type: 'URL' }
  | { type: 'MOCK_DONE' }
  | { type: 'ERROR' }
  | { type: 'PAGE_RESTORED' }
  | { type: 'RETURNED'; result: string };

/** Busy states ignore every further tap: one attempt at a time. */
export const CONNECT_BUSY: ReadonlySet<ConnectState> = new Set(['PREPARING', 'REDIRECTING']);

export function nextConnect(s: ConnectState, e: ConnectEvent): ConnectState {
  switch (e.type) {
    case 'TAP': return CONNECT_BUSY.has(s) ? s : 'PREPARING';
    case 'URL': return s === 'PREPARING' ? 'REDIRECTING' : s;
    case 'MOCK_DONE': return s === 'PREPARING' ? 'CONNECTED' : s;
    case 'ERROR': return CONNECT_BUSY.has(s) ? 'FAILED' : s;
    // Back from Meta's page with the browser's back button: the attempt is over.
    case 'PAGE_RESTORED': return s === 'REDIRECTING' ? 'IDLE' : s;
    case 'RETURNED': return e.result === 'ok' ? 'CONNECTED' : e.result === 'denied' ? 'CANCELLED' : 'FAILED';
  }
}

/** The connect results the callback can return, and the copy for each (never a raw OAuth error). */
export const CONNECT_RESULTS = ['ok', 'denied', 'bad_state', 'error', 'encryption_missing', 'mock_mode'] as const;
export function connectResultOf(raw: string | null | undefined): (typeof CONNECT_RESULTS)[number] | null {
  const v = String(raw ?? '');
  return (CONNECT_RESULTS as readonly string[]).includes(v) ? (v as (typeof CONNECT_RESULTS)[number]) : (v ? 'error' : null);
}

/** Where HOMATCH is open, for diagnostics and the one honest note — never to pick a hidden path. */
export type BrowserKind = 'META_IN_APP' | 'OTHER_IN_APP' | 'BROWSER';
export function browserKind(ua: string): BrowserKind {
  const u = String(ua ?? '');
  if (/\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bInstagram\b/.test(u)) return 'META_IN_APP';
  // Android WebView marks itself "; wv)"; known third-party in-app browsers name themselves.
  if (/;\s?wv\)|\bLine\/|\bTelegram\b|\bMicroMessenger\b|\bSnapchat\b|\bTwitter\b/.test(u)) return 'OTHER_IN_APP';
  return 'BROWSER';
}

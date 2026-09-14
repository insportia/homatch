// HOMATCH AI TALK — what the assistant may send somebody to, and when the
// call should end.
//
// WHY THE ROUTES LIVE HERE AND NOT IN THE PROMPT
//
// A voice assistant that says "open the Verify page" and cannot take you there
// is worse than one that says nothing: the visitor now has to find it. So the
// assistant offers a real destination and the UI renders a button.
//
// The failure mode of that idea is a model inventing `/properties/tbilisi-vake`
// because it sounds like a route. Nothing downstream would catch it — it is a
// plausible string, it renders as a button, and it 404s in front of a customer.
//
// So the model never supplies a URL that is trusted. It picks a KEY from the
// list below; the key resolves to a path this application actually registers;
// anything unrecognised resolves to nothing and the turn simply has no button.
// The list lives beside the router rather than inside a prompt because that is
// where somebody renaming a route will be standing.
//
// It is also where somebody RETIRING one will be standing, which matters more
// than it sounds. The first draft of this list offered two destinations for
// products Homatch had deliberately removed. Their routes still resolve, so
// nothing would have crashed; the assistant would simply have spent its one
// recommendation sending people to things that no longer exist. Two standing
// tests caught it, which is why this is a comment and not a bug report.

/** A destination AI TALK is allowed to offer an anonymous visitor. */
export interface TalkDestination {
  /** Stable key the model chooses. Never a path. */
  key: string;
  /** The route this application registers. */
  path: string;
  /** What the assistant is describing, for the model's benefit. */
  purpose: string;
}

/**
 * Visitor-facing destinations only.
 *
 * AI TALK is a PUBLIC surface: the caller is anonymous and may never have
 * signed in. Every `/admin/*` route is deliberately absent — offering one
 * would send a stranger to a page that will refuse them, which reads as the
 * product being broken rather than as the guard working.
 */
export const TALK_DESTINATIONS: readonly TalkDestination[] = [
  { key: 'search', path: '/active-search', purpose: 'start or continue a property search with live matching' },
  { key: 'verify', path: '/verify', purpose: 'check a property in the public registry: owner, extract, encumbrances' },
  { key: 'mortgage', path: '/mortgage', purpose: 'mortgage and instalment options' },
  { key: 'developers', path: '/developers', purpose: 'developers and their projects' },
  { key: 'viewings', path: '/viewings', purpose: 'booked and requested property viewings' },
  { key: 'add_property', path: '/property/add', purpose: 'list a property for sale or rent' },
  { key: 'dashboard', path: '/dashboard', purpose: 'their own saved properties, matches and activity' },
  { key: 'notifications', path: '/notifications', purpose: 'their alerts and updates' },
  { key: 'messages', path: '/chat', purpose: 'their Homatch messages' },
  { key: 'pricing', path: '/pricing', purpose: 'what Homatch costs' },
  { key: 'credits', path: '/credits', purpose: 'credits and billing' },
  { key: 'sign_in', path: '/auth/login', purpose: 'sign in or create an account' },
] as const;

const BY_KEY = new Map(TALK_DESTINATIONS.map((d) => [d.key, d]));

/** The catalogue as the model sees it: keys and what each is for. */
export function destinationMenu(): string {
  return TALK_DESTINATIONS.map((d) => `${d.key} — ${d.purpose}`).join('\n');
}

/**
 * Resolve a key the model chose into a path this app registers.
 *
 * Returns null for anything unknown, which is the whole point: an invented
 * key produces no button rather than a broken one.
 */
export function resolveDestination(key: unknown): TalkDestination | null {
  const k = String(key ?? '').trim().toLowerCase();
  return BY_KEY.get(k) ?? null;
}

/** Why AI TALK ended, when it ended itself. */
export type TalkEndReason =
  | 'OBJECTIVE_MET'
  | 'FAREWELL'
  | 'HANDED_OFF'
  | 'NOTHING_ACTIONABLE'
  | 'ABUSE';

const END_REASONS = new Set<string>([
  'OBJECTIVE_MET', 'FAREWELL', 'HANDED_OFF', 'NOTHING_ACTIONABLE', 'ABUSE',
]);

export interface TalkAction {
  /** Where to offer to send them, if anywhere. */
  destination: TalkDestination | null;
  /** Should the call end after this reply has been spoken? */
  end: boolean;
  endReason: TalkEndReason | null;
}

/**
 * The marker the model appends, and the boundary of what gets spoken.
 *
 * WHY A MARKER IN THE TEXT AND NOT A SECOND CALL
 *
 * A second model call to ask "should this end, and where should they go" costs
 * a whole extra round trip on a path whose entire problem is latency, and it
 * asks a model that can no longer see why it said what it said.
 *
 * WHY IT IS STRIPPED RATHER THAN TRUSTED
 *
 * Because the model will sometimes get it wrong, and the specific way it gets
 * it wrong is speaking the marker out loud. Everything from the marker onwards
 * is removed from the spoken text and from the transcript, whether or not it
 * parses. A malformed marker therefore costs a missing button, never a voice
 * reading punctuation to somebody.
 */
export const ACTION_MARKER = '<<ACT';

/** Everything before the marker: the only part anybody hears. */
export function spokenPart(raw: string): string {
  const at = raw.indexOf(ACTION_MARKER);
  return (at === -1 ? raw : raw.slice(0, at)).trim();
}

/**
 * The action the model asked for, validated into something safe to render.
 *
 * Defensive by construction. Unknown keys, unknown reasons, missing braces and
 * text that is not JSON at all all resolve to "no action", because every one
 * of those is likelier than the model being right about a route it invented.
 */
export function parseAction(raw: string): TalkAction {
  const none: TalkAction = { destination: null, end: false, endReason: null };

  const at = raw.indexOf(ACTION_MARKER);
  if (at === -1) return none;

  const open = raw.indexOf('{', at);
  const close = raw.indexOf('}', open + 1);
  if (open === -1 || close === -1) return none;

  let body: { go?: unknown; end?: unknown; why?: unknown };
  try { body = JSON.parse(raw.slice(open, close + 1)) as typeof body; } catch { return none; }

  const why = String(body.why ?? '').trim().toUpperCase();
  return {
    destination: resolveDestination(body.go),
    end: body.end === true,
    endReason: END_REASONS.has(why) ? (why as TalkEndReason) : (body.end === true ? 'OBJECTIVE_MET' : null),
  };
}

/**
 * Whether a reply is still carrying an unfinished marker.
 *
 * The text arrives a token at a time, so `<<A` is a prefix of the marker and
 * must not be spoken on the chance that it becomes one. Held back until it is
 * either completed or ruled out.
 */
export function endsWithPartialMarker(text: string): boolean {
  for (let i = 1; i < ACTION_MARKER.length; i++) {
    if (text.endsWith(ACTION_MARKER.slice(0, i))) return true;
  }
  return false;
}

/*
 * IS THIS REQUEST FROM HOMATCH ITSELF?
 *
 * Some edge actions exist only for other edge code: push-send's `deliver`
 * interrupts a customer's phone about a notification, and nothing but the
 * notify() helper — running under the service role — has any business asking
 * for that. The platform's JWT check does not answer the question: the anon
 * key is a valid JWT, it ships in every browser bundle, and with it anybody
 * could ask push-send to deliver any notification id they could guess or had
 * seen, early and outside its aggregation window.
 *
 * The answer is the same one revalidate-supply and ingest-live-chat give: the
 * bearer must BE the service key. Compared in constant time, because it is a
 * secret compared against caller input.
 *
 * Pure and dependency-free so node can test it without Deno.
 */

/** The bearer token of an Authorization header, or '' when there is none. */
export function bearerOf(authorization: string | null | undefined): string {
  const raw = (authorization ?? '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : '';
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True only when the request presents the service key as its bearer.
 *
 * An unset service key is never a match — an environment missing its secret
 * must refuse everybody, not admit everybody who also sends nothing.
 */
export function isServiceCaller(
  authorization: string | null | undefined,
  serviceKey: string | null | undefined,
): boolean {
  const key = (serviceKey ?? '').trim();
  if (!key) return false;
  const presented = bearerOf(authorization);
  if (!presented) return false;
  return constantTimeEqual(presented, key);
}

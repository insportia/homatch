// PORTAL-ACCOUNT CREDENTIAL ENCRYPTION — AES-256-GCM with WebCrypto (Deno and
// Node both have it), so node:test runs it.
//
// The key lives ONLY in the publishing-engine function's environment
// (PUBLISHING_CREDENTIALS_KEY, 32 random bytes, base64). The database stores the
// ciphertext envelope { v, kid, iv, ct } and never the key; the portal id is bound
// in as additional data, so a ciphertext copied to another portal's row does not
// decrypt. Plaintext is never logged, never returned to a browser, never written.
//
// No adapter has a verified mechanism that would use a stored credential, so
// index.ts refuses to store one today (CREDENTIAL_NOT_ACCEPTED): a password that
// nothing uses is only a liability. This module is what an adapter with a
// verified, permitted login would use.

export interface Envelope { v: 1; kid: string; iv: string; ct: string }

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(keyB64: string | undefined | null): Promise<{ key: CryptoKey; kid: string }> {
  if (!keyB64) throw new Error('CREDENTIAL_KEY_NOT_CONFIGURED');
  let raw: Uint8Array;
  try { raw = unb64(keyB64.trim()); } catch { throw new Error('CREDENTIAL_KEY_INVALID'); }
  if (raw.length !== 32) throw new Error('CREDENTIAL_KEY_INVALID');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const kid = [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']), kid };
}

export async function sealCredential(plaintext: string, portalId: string, keyB64: string | undefined | null): Promise<Envelope> {
  if (typeof plaintext !== 'string' || !plaintext || plaintext.length > 4096) throw new Error('CREDENTIAL_INVALID');
  const { key, kid } = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(portalId) }, key, new TextEncoder().encode(plaintext)));
  return { v: 1, kid, iv: b64(iv), ct: b64(ct) };
}

export async function openCredential(envelope: Envelope, portalId: string, keyB64: string | undefined | null): Promise<string> {
  const { key, kid } = await importKey(keyB64);
  if (!envelope || envelope.v !== 1 || envelope.kid !== kid) throw new Error('CREDENTIAL_KEY_MISMATCH');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: new TextEncoder().encode(portalId) }, key, unb64(envelope.ct));
    return new TextDecoder().decode(pt);
  } catch { throw new Error('CREDENTIAL_UNREADABLE'); }
}

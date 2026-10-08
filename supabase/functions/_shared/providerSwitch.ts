// The Admin → Providers switch, read the same way everywhere.
//
// admin_settings.provider_disabled_list names the providers an operator has
// switched off. It is stored as a JSON array, sometimes as JSON text; a value
// that cannot be read disables nothing (callers that must fail closed check
// for that themselves). Every path that can spend money with a provider asks
// this BEFORE it builds a request.

export function providerDisabledByAdmin(list: unknown, provider: string): boolean {
  let v = list;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return false; } }
  const want = provider.toUpperCase();
  return Array.isArray(v) && v.some((p) => String(p).toUpperCase() === want);
}

/** The switched-off providers, upper-cased. Empty when the setting is absent or unreadable. */
export async function loadDisabledProviders(db: any): Promise<Set<string>> {
  try {
    const { data, error } = await db.from('admin_settings').select('value').eq('key', 'provider_disabled_list').maybeSingle();
    if (error) return new Set();
    let v: unknown = (data as { value?: unknown } | null)?.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return new Set(); } }
    return new Set(Array.isArray(v) ? v.map((p) => String(p).toUpperCase()) : []);
  } catch {
    return new Set();
  }
}

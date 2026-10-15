/* Small, dependency-free HTML readers shared by the portal adapters. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
export const strip = (html) => decode(String(html ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ‍]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
/** "1,064,012" / "389 383" / "56.3" → number; null when absent or not a number. */
export const num = (s) => { if (s == null) return null; const t = String(s).replace(/[\s ‍,]/g, '').replace(/[^\d.]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
export const int = (s) => { const n = num(s); return n == null ? null : Math.round(n); };
export const meta = (html, prop) => { const m = String(html).match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i')) ?? String(html).match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i')); return m ? decode(m[1]).trim() : null; };
export const absolute = (href, base) => { try { return new URL(decode(href), base).href; } catch { return null; } };
export const ldjson = (html) => [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => { try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v : [v]; } catch { return []; } });
/** Georgian mobile numbers published on the listing (5XX XX XX XX), normalised to +995. */
export const phones = (text) => [...new Set((String(text ?? '').match(/(?:\+?995[\s-]?)?5\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}|5-\d{2}-\d{6}/g) ?? []).map((p) => '+995' + p.replace(/\D/g, '').replace(/^995/, '')))].filter((p) => p.length === 13);
/** Exact Georgian date "29.09.2026" → ISO, null if invalid. */
export const dmy = (s) => { const m = String(s ?? '').match(/(\d{2})\.(\d{2})\.(\d{4})/); if (!m) return null; const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[1] ? null : d.toISOString(); };
/** A JSON object assigned in an inline script (`window.X = {...}`), read by brace matching. */
export function assignedJson(html, marker) {
  const s = String(html), at = s.indexOf(marker); if (at < 0) return null;
  const start = s.indexOf('{', at); if (start < 0) return null;
  let depth = 0, str = false, esc = false;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, j + 1)); } catch { return null; } }
  }
  return null;
}

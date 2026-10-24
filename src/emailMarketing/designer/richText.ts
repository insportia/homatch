// EMAIL DESIGNER — rich text. Owner brief (UX pass §4): select a word, link it, bold it, colour it.
//
// The designer's text and heading blocks may carry `rich`: a TINY HTML subset produced by the
// in-canvas editor (contentEditable). It is never trusted: sanitizeRich() rebuilds it from tokens,
// so the only markup that can survive is what this file writes itself —
//
//   <strong> <em> <u> <br> <ul> <ol> <li>
//   <span style="color:#RRGGBB">          (a colour, nothing else)
//   <a href="https://… | mailto:… | tel:… | {{unsubscribe_url}}">
//
// Everything else (scripts, styles, event handlers, images, iframes, classes, unknown tags) is
// dropped; its text stays, escaped. Paragraphs and divs become line breaks. The server runs the
// same function on save (normalizeDoc), so a crafted request cannot store anything else, and the
// renderer adds the inline styles mail clients need.

export const RICH_MAX = 10_000;

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8}|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) { const n = parseInt(k.slice(2), 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    if (k.startsWith('#')) { const n = parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[k] ?? m;
  });
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** https, mailto, tel or the unsubscribe merge field — the link targets a recipient may receive. */
export function safeRichHref(raw: string): string | null {
  const h = decodeEntities(raw).trim();
  if (/^https:\/\/[^\s<>"'`]{1,2000}$/i.test(h)) return h;
  if (/^mailto:[^\s<>"'`]+@[^\s<>"'`]+$/i.test(h)) return h;
  if (/^tel:\+?[0-9 ()-]{5,20}$/.test(h)) return h;
  if (/^\{\{\s*unsubscribe_url\s*\}\}$/.test(h)) return '{{unsubscribe_url}}';
  return null;
}

function hexColor(v: string): string | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${(m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase()}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
  if (m) {
    const h = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
    return `#${h.toUpperCase()}`;
  }
  return null;
}

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function styleMap(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

type Out = 'strong' | 'em' | 'u' | 'span' | 'a' | 'ul' | 'ol' | 'li';
const BLOCKISH = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'header', 'footer', 'pre', 'tr', 'table']);

/** Anything → the safe subset. Idempotent: sanitizeRich(sanitizeRich(x)) === sanitizeRich(x). */
export function sanitizeRich(input: unknown): string {
  let html = typeof input === 'string' ? input.slice(0, RICH_MAX * 2) : '';
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|iframe|object|embed|svg|math|noscript|title|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|template|iframe|object|embed|svg|math|noscript|title|head)\b[^>]*>/gi, '');

  const out: string[] = [];
  /* One frame per SOURCE element; each remembers the output tags it opened, closed together. */
  const frames: Array<{ tag: string; opened: Out[] }> = [];
  const openCount = (t: Out) => frames.reduce((n, f) => n + f.opened.filter((x) => x === t).length, 0);
  const lastIsBreak = () => {
    const last = out[out.length - 1] ?? '';
    return out.length === 0 || last === '<br>' || last === '<ul>' || last === '<ol>' || last === '</ul>' || last === '</ol>' || last === '<li>' || last === '</li>';
  };
  const push = (opened: Out[], tag: string) => frames.push({ tag, opened });
  const closeFrame = (i: number) => {
    /* Close every frame above i (unbalanced source) and then i itself, innermost first. */
    while (frames.length > i) {
      const f = frames.pop()!;
      for (const t of [...f.opened].reverse()) out.push(`</${t}>`);
    }
  };

  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g)) {
    if (m[4] != null || m[5] != null) {
      const text = decodeEntities(m[4] ?? '<').replace(/ /g, ' ');
      if (text) out.push(esc(text).replace(/\r?\n/g, ' '));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const a = attrs(m[3] ?? '');

    if (tag === 'br') { out.push('<br>'); continue; }
    if (BLOCKISH.has(tag)) {
      if (!closing && !lastIsBreak()) out.push('<br>');
      if (closing && tag !== 'div' && tag !== 'p' && !lastIsBreak()) out.push('<br>');
      continue;
    }
    if (closing) {
      for (let i = frames.length - 1; i >= 0; i--) {
        if (frames[i].tag === tag) { closeFrame(i); break; }
      }
      continue;
    }

    const opened: Out[] = [];
    const open = (t: Out, attr = '') => { out.push(`<${t}${attr}>`); opened.push(t); };
    switch (tag) {
      case 'strong': case 'b': open('strong'); break;
      case 'em': case 'i': open('em'); break;
      case 'u': case 'ins': open('u'); break;
      case 'ul': case 'ol': open(tag); break;
      case 'li':
        if (openCount('ul') + openCount('ol') > openCount('li')) open('li');
        else if (!lastIsBreak()) out.push('<br>');
        break;
      case 'a': {
        const href = a.href != null ? safeRichHref(a.href) : null;
        if (href && openCount('a') === 0) open('a', ` href="${esc(href)}"`);
        break;
      }
      case 'span': case 'font': {
        const st = styleMap(a.style ?? '');
        const w = st['font-weight'];
        if (w && (w === 'bold' || w === 'bolder' || Number(w) >= 600)) open('strong');
        if (st['font-style'] === 'italic') open('em');
        if ((st['text-decoration'] ?? st['text-decoration-line'] ?? '').includes('underline')) open('u');
        const c = hexColor(st.color ?? (tag === 'font' ? a.color ?? '' : ''));
        if (c) open('span', ` style="color:${c}"`);
        break;
      }
      default: break; /* unknown element: its text stays, the tag does not */
    }
    push(opened, tag);
  }
  closeFrame(0);

  let s = out.join('')
    /* empty pairs and leading/trailing breaks carry nothing */
    .replace(/<(strong|em|u|span[^>]*|a[^>]*)><\/(strong|em|u|span|a)>/g, '')
    .replace(/^(?:<br>)+/, '')
    .replace(/(?:<br>)+$/, '');
  if (s.length > RICH_MAX) s = sanitizeRich(s.slice(0, RICH_MAX));
  return s;
}

/** The plain-text alternative of rich text (and what HOMI reads). */
export function richToText(rich: string): string {
  return decodeEntities(
    rich
      .replace(/<br>/g, '\n')
      .replace(/<li>/g, '• ')
      .replace(/<\/li>/g, '\n')
      .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_m, href: string, label: string) => `${label} (${decodeEntities(href)})`)
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text (or a model's edit) → rich text: escaped, newlines kept. */
export function textToRich(text: string): string {
  return esc(String(text ?? '')).replace(/\r?\n/g, '<br>');
}

/** Sanitized rich text → email HTML: the inline styles mail clients need, nothing else. */
export function richToEmailHtml(rich: string, linkColor: string): string {
  return sanitizeRich(rich)
    .replace(/<a href="/g, `<a target="_blank" style="color:${linkColor};text-decoration:underline;" href="`)
    .replace(/<ul>/g, '<ul style="margin:6px 0;padding:0 0 0 1.3em;">')
    .replace(/<ol>/g, '<ol style="margin:6px 0;padding:0 0 0 1.3em;">')
    .replace(/<li>/g, '<li style="margin:0 0 4px 0;">');
}

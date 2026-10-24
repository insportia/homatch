// EMAIL DESIGNER — the advanced HTML block's sanitizer.
//
// The one block where an author writes markup. It is rebuilt from tokens, like rich text, against
// an email-safe allowlist: layout and text tags, a short list of attributes, https/mailto/tel links,
// https images, and inline styles filtered property by property (no url(), no expressions, no
// positioning, no behaviour). Scripts, styles, forms, iframes, event handlers, comments and
// conditional comments are dropped. Unbalanced markup is closed. The server runs this on save, so
// what is stored and sent can only ever be the allowlisted subset.

import { decodeEntities, safeRichHref } from './richText.ts';

export const HTML_BLOCK_MAX = 20_000;

const TAGS = new Set(['table', 'tbody', 'thead', 'tr', 'td', 'th', 'p', 'div', 'span', 'a', 'img', 'strong', 'b', 'em', 'i', 'u',
  'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'hr', 'center', 'small', 'sup', 'sub', 'blockquote']);
const VOID = new Set(['br', 'img', 'hr']);
const ATTRS: Record<string, string[]> = {
  '*': ['style', 'align', 'dir'],
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  table: ['width', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'role'],
  td: ['width', 'height', 'valign', 'bgcolor', 'colspan', 'rowspan'],
  th: ['width', 'valign', 'bgcolor', 'colspan', 'rowspan'],
  tr: ['valign', 'bgcolor'],
};
const CSS = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-decoration',
  'text-transform', 'line-height', 'letter-spacing', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-collapse', 'width', 'max-width', 'min-width', 'height', 'vertical-align', 'display', 'white-space']);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sanitizeCss(style: string): string {
  return style.split(';').map((d) => {
    const i = d.indexOf(':');
    if (i <= 0) return '';
    const prop = d.slice(0, i).trim().toLowerCase();
    const val = decodeEntities(d.slice(i + 1)).trim();
    if (!CSS.has(prop) || !val || val.length > 200) return '';
    if (/url\s*\(|expression|javascript:|behavior|@import|[<>{}\\]/i.test(val)) return '';
    if (prop === 'display' && !/^(block|inline|inline-block|table|table-cell|table-row)$/i.test(val)) return '';
    return `${prop}:${val.replace(/"/g, "'")}`;
  }).filter(Boolean).join(';');
}

function attrList(src: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of src.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  return out;
}

/** The plain-text part for a sanitized HTML block: block ends become line breaks, links keep their URL. */
export function emailHtmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `${label} (${decodeEntities(href)})`)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(p|div|h[1-4]|li|tr|blockquote|table)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Anything → the email-safe subset. Idempotent. */
export function sanitizeEmailHtml(input: unknown): string {
  let html = typeof input === 'string' ? input.slice(0, HTML_BLOCK_MAX * 2) : '';
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[[\s\S]*?\]>/g, '')
    .replace(/<(script|style|template|iframe|object|embed|svg|math|noscript|title|head|form|textarea|select|button|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|template|iframe|object|embed|svg|math|noscript|title|head|form|textarea|select|button|input|link|meta|base)\b[^>]*>/gi, '');
  const out: string[] = [];
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g)) {
    if (m[4] != null || m[5] != null) { out.push(esc(decodeEntities(m[4] ?? '<'))); continue; }
    const tag = m[2].toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (m[1] === '/') {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) { while (stack.length > i) out.push(`</${stack.pop()}>`); }
      continue;
    }
    const allowed = new Set([...(ATTRS['*'] ?? []), ...(ATTRS[tag] ?? [])]);
    const attrs: string[] = [];
    for (const [k, v] of attrList(m[3] ?? '')) {
      if (!allowed.has(k)) continue;
      if (k === 'href') { const h = safeRichHref(v); if (h) attrs.push(`href="${esc(h)}" target="_blank"`); continue; }
      if (k === 'src') { const u = decodeEntities(v).trim(); if (/^https:\/\/[^\s<>"'`]+$/i.test(u)) attrs.push(`src="${esc(u)}"`); continue; }
      if (k === 'style') { const c = sanitizeCss(v); if (c) attrs.push(`style="${esc(c)}"`); continue; }
      if (k === 'dir' && !/^(ltr|rtl|auto)$/i.test(v)) continue;
      if (['width', 'height', 'cellpadding', 'cellspacing', 'border', 'colspan', 'rowspan'].includes(k) && !/^\d{1,4}%?$/.test(v)) continue;
      if (['bgcolor'].includes(k) && !/^#[0-9a-f]{3,6}$/i.test(v)) continue;
      if (['align', 'valign'].includes(k) && !/^(left|right|center|top|middle|bottom)$/i.test(v)) continue;
      attrs.push(`${k}="${esc(decodeEntities(v).slice(0, 200))}"`);
    }
    if (tag === 'img' && !attrs.some((a) => a.startsWith('src='))) continue;
    if (tag === 'img' && !attrs.some((a) => a.startsWith('alt='))) attrs.push('alt=""');
    out.push(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${VOID.has(tag) ? ' /' : ''}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  const s = out.join('');
  return s.length > HTML_BLOCK_MAX ? sanitizeEmailHtml(s.slice(0, HTML_BLOCK_MAX)) : s;
}

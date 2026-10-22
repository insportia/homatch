// RECEIVED EMAIL HTML, MADE SAFE TO LOOK AT.
//
// An inbound email is written by a stranger. It is shown only:
//   1. after an allowlist pass (no script/style-able active content, no forms,
//      no event handlers, no javascript:/data: links), and
//   2. inside an iframe with sandbox="" (no scripts, no same-origin, no top
//      navigation) and a Content-Security-Policy that blocks every network
//      request unless the reader explicitly allows remote images — so opening
//      a message does not fire the sender's tracking pixel.

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
  'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'ol', 'p', 'pre', 'q', 's', 'small',
  'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'frame', 'frameset', 'applet', 'audio', 'video', 'source']);
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color', 'face', 'size', 'dir', 'lang', 'style']);

function safeUrl(v: string, kind: 'href' | 'src'): string | null {
  const s = v.trim();
  if (kind === 'href') return /^(https?:|mailto:|tel:)/i.test(s) ? s : null;
  if (/^https?:/i.test(s)) return s;
  if (/^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
  if (/^cid:/i.test(s)) return null;
  return null;
}

/** Strip url()/expression() from inline styles; everything else visual is kept. */
function safeStyle(v: string): string {
  return v.replace(/expression\s*\(|url\s*\([^)]*\)|@import|behavior\s*:|-moz-binding/gi, '').slice(0, 2000);
}

export function sanitizeEmailHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {
        walk(child);
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name) || name.startsWith('on')) { child.removeAttribute(attr.name); continue; }
        if (name === 'href' || name === 'src') {
          const ok = safeUrl(attr.value, name);
          if (!ok) child.removeAttribute(attr.name); else child.setAttribute(attr.name, ok);
        }
        if (name === 'style') child.setAttribute('style', safeStyle(attr.value));
      }
      if (tag === 'a') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer nofollow'); }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** The iframe document: sanitised body under a CSP that allows nothing remote unless asked. */
export function emailFrameDocument(html: string, opts: { allowRemoteImages: boolean; dir?: 'ltr' | 'rtl' | 'auto' }): string {
  const img = opts.allowRemoteImages ? 'https: data:' : 'data:';
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:12px;font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body dir="${opts.dir ?? 'auto'}">${sanitizeEmailHtml(html)}</body></html>`;
}

/** Whether the message references remote images (so the "load images" control is worth showing). */
export function hasRemoteImages(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?https?:/i.test(html);
}

import { collapseWhitespace, decodeEntities } from '../normalize/text.ts';

/**
 * A small, dependency-free HTML tokenizer.
 *
 * Why not cheerio/parse5: this engine ships zero runtime dependencies so it can
 * be dropped into any Homatch service without a supply-chain conversation. We
 * do not need a spec-compliant DOM - we need title, meta, links, JSON-LD blocks
 * and readable text, extracted the same way every time. `PARSER_VERSION` is part
 * of every cache key, so improving this file safely invalidates old parses.
 */

export const PARSER_VERSION = 'html-1.0.0';

export interface HtmlMeta {
  name: string | null;
  property: string | null;
  httpEquiv: string | null;
  content: string | null;
  charset: string | null;
}

export interface HtmlLink {
  rel: string | null;
  href: string;
  type: string | null;
  title: string | null;
}

export interface HtmlAnchor {
  href: string;
  text: string;
  rel: string | null;
}

export interface HtmlScript {
  type: string | null;
  content: string;
}

export interface HtmlHeading {
  level: number;
  text: string;
}

export interface HtmlItemProp {
  name: string;
  value: string;
}

export interface HtmlDocument {
  title: string | null;
  lang: string | null;
  metas: HtmlMeta[];
  links: HtmlLink[];
  anchors: HtmlAnchor[];
  scripts: HtmlScript[];
  headings: HtmlHeading[];
  itemProps: HtmlItemProp[];
  /** Readable text with scripts, styles and markup removed. */
  text: string;
  rawLength: number;
  parserVersion: string;
}

/** Elements whose content is not markup and must be consumed verbatim. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template']);

/** Elements whose content is never readable page text. */
const NON_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head']);

/** Elements that imply a line break in the extracted text. */
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dd', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const name = (match[1] as string).toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    out[name] = decodeEntities(value);
  }
  return out;
}

interface OpenCapture {
  kind: 'anchor' | 'heading';
  startIndex: number;
  attrs: Record<string, string>;
  level: number;
}

export function parseHtml(html: string): HtmlDocument {
  const metas: HtmlMeta[] = [];
  const links: HtmlLink[] = [];
  const anchors: HtmlAnchor[] = [];
  const scripts: HtmlScript[] = [];
  const headings: HtmlHeading[] = [];
  const itemProps: HtmlItemProp[] = [];

  const textParts: string[] = [];
  const captureStack: OpenCapture[] = [];
  /** Stack of open non-text elements; text is dropped while non-empty. */
  let suppressDepth = 0;
  let title: string | null = null;
  let lang: string | null = null;

  let index = 0;
  const length = html.length;

  while (index < length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }

    if (lt > index) pushText(html.slice(index, lt));

    // Comments and doctype/CDATA.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      index = end === -1 ? length : end + 1;
      continue;
    }

    const isClosing = html[lt + 1] === '/';
    const tagEnd = findTagEnd(html, lt);
    if (tagEnd === -1) {
      pushText(html.slice(lt));
      break;
    }

    const inner = html.slice(lt + (isClosing ? 2 : 1), tagEnd);
    const nameMatch = inner.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nameMatch) {
      index = tagEnd + 1;
      continue;
    }

    const tag = (nameMatch[1] as string).toLowerCase();
    const attrSource = inner.slice((nameMatch[1] as string).length);
    const selfClosing = attrSource.trimEnd().endsWith('/');

    if (isClosing) {
      handleClose(tag);
      index = tagEnd + 1;
      continue;
    }

    const attrs = parseAttributes(attrSource);
    handleOpen(tag, attrs);

    // Raw-text elements: consume to the matching close tag without tokenizing.
    if (RAW_TEXT_ELEMENTS.has(tag) && !selfClosing) {
      const closeIndex = findRawTextEnd(html, tagEnd + 1, tag);
      const content = html.slice(tagEnd + 1, closeIndex === -1 ? length : closeIndex);

      if (tag === 'script') {
        scripts.push({ type: attrs['type'] ?? null, content });
      } else if (tag === 'title' && title === null) {
        title = collapseWhitespace(decodeEntities(content)) || null;
      }

      index = closeIndex === -1 ? length : skipCloseTag(html, closeIndex, tag);
      // The open handler may have incremented suppression; undo it here since
      // we consumed the element wholesale.
      if (NON_TEXT_ELEMENTS.has(tag) && suppressDepth > 0) suppressDepth -= 1;
      continue;
    }

    if (selfClosing || VOID_ELEMENTS.has(tag)) {
      handleClose(tag, true);
    }

    index = tagEnd + 1;
  }

  return {
    title,
    lang,
    metas,
    links,
    anchors,
    scripts,
    headings,
    itemProps,
    text: collapseWhitespace(textParts.join('')),
    rawLength: html.length,
    parserVersion: PARSER_VERSION,
  };

  // -------------------------------------------------------------------------

  function pushText(raw: string): void {
    if (suppressDepth > 0) return;
    if (!raw) return;
    textParts.push(decodeEntities(raw));
  }

  function handleOpen(tag: string, attrs: Record<string, string>): void {
    if (NON_TEXT_ELEMENTS.has(tag)) {
      // `head` is suppressed for text but we still want its meta/link children,
      // which are handled below before any suppression matters.
      suppressDepth += 1;
    }
    if (BLOCK_ELEMENTS.has(tag)) textParts.push('\n');

    switch (tag) {
      case 'html':
        if (attrs['lang']) lang = attrs['lang'].toLowerCase();
        break;
      case 'meta':
        metas.push({
          name: attrs['name']?.toLowerCase() ?? null,
          property: attrs['property']?.toLowerCase() ?? null,
          httpEquiv: attrs['http-equiv']?.toLowerCase() ?? null,
          content: attrs['content'] ?? null,
          charset: attrs['charset']?.toLowerCase() ?? null,
        });
        break;
      case 'link':
        if (attrs['href']) {
          links.push({
            rel: attrs['rel']?.toLowerCase() ?? null,
            href: attrs['href'],
            type: attrs['type'] ?? null,
            title: attrs['title'] ?? null,
          });
        }
        break;
      case 'a':
        if (attrs['href']) {
          captureStack.push({ kind: 'anchor', startIndex: textParts.length, attrs, level: 0 });
        }
        break;
      default:
        if (/^h[1-6]$/.test(tag)) {
          captureStack.push({
            kind: 'heading',
            startIndex: textParts.length,
            attrs,
            level: Number(tag[1]),
          });
        }
        break;
    }

    // Light microdata: `itemprop` with an inline value attribute. Full
    // microdata needs a DOM; JSON-LD covers the structured cases we rely on.
    const itemprop = attrs['itemprop'];
    if (itemprop) {
      const value = attrs['content'] ?? attrs['datetime'] ?? attrs['value'] ?? attrs['href'] ?? '';
      if (value) itemProps.push({ name: itemprop.toLowerCase(), value });
    }
  }

  function handleClose(tag: string, fromSelfClosing = false): void {
    if (NON_TEXT_ELEMENTS.has(tag) && !fromSelfClosing && suppressDepth > 0) suppressDepth -= 1;
    if (BLOCK_ELEMENTS.has(tag)) textParts.push('\n');

    if (tag === 'a' || /^h[1-6]$/.test(tag)) {
      for (let i = captureStack.length - 1; i >= 0; i -= 1) {
        const capture = captureStack[i] as OpenCapture;
        const matches =
          (tag === 'a' && capture.kind === 'anchor') ||
          (capture.kind === 'heading' && capture.level === Number(tag[1]));
        if (!matches) continue;
        captureStack.splice(i, 1);
        const text = collapseWhitespace(textParts.slice(capture.startIndex).join(''));
        if (capture.kind === 'anchor') {
          anchors.push({
            href: capture.attrs['href'] as string,
            text,
            rel: capture.attrs['rel']?.toLowerCase() ?? null,
          });
        } else if (text) {
          headings.push({ level: capture.level, text });
        }
        break;
      }
    }
  }
}

/** Find the `>` that closes a tag, respecting quoted attribute values. */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i] as string;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return i;
  }
  return -1;
}

function findRawTextEnd(html: string, from: number, tag: string): number {
  const needle = `</${tag}`;
  const lower = html.toLowerCase();
  return lower.indexOf(needle, from);
}

function skipCloseTag(html: string, closeIndex: number, tag: string): number {
  const end = html.indexOf('>', closeIndex + tag.length + 2);
  return end === -1 ? html.length : end + 1;
}

import { canonicalizeUrl, resolveUrl } from '../normalize/url.ts';
import { normalizeTimestamp } from '../normalize/dates.ts';
import type { HtmlDocument } from './html.ts';

export const METADATA_PARSER_VERSION = 'metadata-1.0.0';

export interface OpenGraph {
  title: string | null;
  type: string | null;
  url: string | null;
  image: string | null;
  description: string | null;
  siteName: string | null;
  locale: string | null;
  publishedTime: string | null;
  modifiedTime: string | null;
}

export interface PageMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  /**
   * Canonical URL the page declared for itself, or null when it declared none.
   * Distinct from `canonicalUrl`, which falls back to the fetched URL - a
   * mirror that names the original is telling us it is a copy, and dedupe
   * should believe it.
   */
  declaredCanonicalUrl: string | null;
  lang: string | null;
  robots: string | null;
  /** True when the page asks not to be indexed - we honour it as a signal. */
  noindex: boolean;
  author: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  openGraph: OpenGraph;
  twitter: Record<string, string>;
  parserVersion: string;
}

function metaContent(doc: HtmlDocument, predicate: (name: string) => boolean): string | null {
  for (const meta of doc.metas) {
    const key = meta.property ?? meta.name;
    if (!key || !meta.content) continue;
    if (predicate(key)) return meta.content.trim() || null;
  }
  return null;
}

export function extractOpenGraph(doc: HtmlDocument): OpenGraph {
  const og = (suffix: string) => metaContent(doc, (name) => name === `og:${suffix}`);
  return {
    title: og('title'),
    type: og('type'),
    url: og('url'),
    image: og('image'),
    description: og('description'),
    siteName: og('site_name'),
    locale: og('locale'),
    publishedTime:
      normalizeTimestamp(metaContent(doc, (n) => n === 'article:published_time')) ?? null,
    modifiedTime:
      normalizeTimestamp(metaContent(doc, (n) => n === 'article:modified_time')) ?? null,
  };
}

export function extractMetadata(doc: HtmlDocument, documentUrl: string): PageMetadata {
  const openGraph = extractOpenGraph(doc);

  const twitter: Record<string, string> = {};
  for (const meta of doc.metas) {
    const key = meta.name ?? meta.property;
    if (key?.startsWith('twitter:') && meta.content) {
      twitter[key.slice('twitter:'.length)] = meta.content;
    }
  }

  const canonicalHref = doc.links.find((link) => link.rel === 'canonical')?.href ?? null;
  const resolvedCanonical = canonicalHref ? resolveUrl(documentUrl, canonicalHref) : null;

  const robots = metaContent(doc, (n) => n === 'robots' || n === 'googlebot');

  const published =
    openGraph.publishedTime ??
    normalizeTimestamp(metaContent(doc, (n) => n === 'date' || n === 'pubdate' || n === 'publish_date')) ??
    normalizeTimestamp(doc.itemProps.find((p) => p.name === 'datepublished')?.value ?? null);

  const modified =
    openGraph.modifiedTime ??
    normalizeTimestamp(metaContent(doc, (n) => n === 'last-modified' || n === 'lastmod')) ??
    normalizeTimestamp(doc.itemProps.find((p) => p.name === 'datemodified')?.value ?? null);

  return {
    title: doc.title ?? openGraph.title ?? twitter['title'] ?? null,
    description:
      metaContent(doc, (n) => n === 'description') ?? openGraph.description ?? twitter['description'] ?? null,
    // The page's own canonical wins; ours is the fallback.
    canonicalUrl: canonicalizeUrl(resolvedCanonical ?? openGraph.url ?? documentUrl),
    declaredCanonicalUrl: resolvedCanonical
      ? canonicalizeUrl(resolvedCanonical)
      : openGraph.url
        ? canonicalizeUrl(openGraph.url)
        : null,
    lang: doc.lang ?? openGraph.locale?.split(/[-_]/)[0]?.toLowerCase() ?? null,
    robots,
    noindex: /\bnoindex\b/i.test(robots ?? ''),
    author: metaContent(doc, (n) => n === 'author' || n === 'article:author'),
    publishedAt: published,
    modifiedAt: modified,
    openGraph,
    twitter,
    parserVersion: METADATA_PARSER_VERSION,
  };
}

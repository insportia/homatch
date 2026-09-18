import type { HtmlDocument } from './html.ts';

/**
 * JSON-LD extraction.
 *
 * Structured data is the highest-quality parse path we have: when a page ships
 * schema.org JSON-LD we get exact numbers instead of regex guesses, which is
 * why `structuredQuality` is a scoring input.
 */

export const JSON_LD_PARSER_VERSION = 'jsonld-1.0.0';

export type JsonLdNode = Record<string, unknown>;

export interface JsonLdExtraction {
  nodes: JsonLdNode[];
  /** Blocks that failed to parse - surfaced rather than swallowed. */
  errors: string[];
}

export function extractJsonLd(doc: HtmlDocument): JsonLdExtraction {
  const nodes: JsonLdNode[] = [];
  const errors: string[] = [];

  for (const script of doc.scripts) {
    const type = (script.type ?? '').toLowerCase();
    if (!type.includes('ld+json')) continue;

    const raw = stripJsonComments(script.content).trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    collectNodes(parsed, nodes);
  }

  return { nodes, errors };
}

/**
 * Flatten @graph containers and arrays so callers see a flat node list.
 * Nested nodes with an @type are collected too: a RealEstateListing usually
 * carries its Offer, Place and PostalAddress as children.
 */
function collectNodes(value: unknown, out: JsonLdNode[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }

  const node = value as JsonLdNode;

  if ('@graph' in node) {
    collectNodes(node['@graph'], out, depth + 1);
    // A node can carry both @graph and its own type.
  }

  if ('@type' in node || '@id' in node) out.push(node);

  for (const [key, child] of Object.entries(node)) {
    if (key === '@graph' || key === '@context') continue;
    if (child !== null && typeof child === 'object') collectNodes(child, out, depth + 1);
  }
}

/** Some CMSs wrap JSON-LD in CDATA or HTML comments. */
function stripJsonComments(raw: string): string {
  return raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '');
}

/** Node @type as a lowercase array; JSON-LD allows a string or an array. */
export function typesOf(node: JsonLdNode): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type.toLowerCase()];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase());
  return [];
}

export function hasType(node: JsonLdNode, ...candidates: string[]): boolean {
  const types = typesOf(node);
  return candidates.some((candidate) => types.includes(candidate.toLowerCase()));
}

export function findByType(nodes: readonly JsonLdNode[], ...candidates: string[]): JsonLdNode | null {
  return nodes.find((node) => hasType(node, ...candidates)) ?? null;
}

/** Read a possibly-nested property, tolerating JSON-LD's many shapes. */
export function readProperty(node: JsonLdNode, path: string): unknown {
  let current: unknown = node;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) current = current[0];
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  // `{"@value": 97.2}` is a legal JSON-LD scalar wrapper.
  if (current !== null && typeof current === 'object' && !Array.isArray(current) && '@value' in (current as object)) {
    return (current as Record<string, unknown>)['@value'];
  }
  return current;
}

export function readString(node: JsonLdNode, path: string): string | null {
  const value = readProperty(node, path);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function readNumberLike(node: JsonLdNode, path: string): string | number | null {
  const value = readProperty(node, path);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

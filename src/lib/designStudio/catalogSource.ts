// HOMATCH DESIGN STUDIO — the catalogue core: one canonical catalogue for
// every provider.
//
// Providers (Poly Haven for materials and environments, Blendkit for
// physical objects, anything later) plug in as ADAPTERS (catalogProviders/):
// they discover, classify, name and plan their own assets. Everything else —
// identity, licence classification, delivery class, storage keys, naming
// rules, validation, optimisation, indexing, resolution — is here, the same
// for all of them. There is one catalogue, not one per provider.
//
// IDENTITY. A catalogue asset is known by its homatchAssetId, derived from
// the provider, the asset kind and the provider's own asset id — nothing else:
//
//   homatchAssetId = "hma_" + base32(sha256("homatch.asset.v1\n" + provider + "\n" + kind + "\n" + sourceAssetId))[0..26]
//
// so importing again (tomorrow, after the provider re-files it, from another
// machine, in another order) resolves to the SAME id. Names, categories,
// tags, file hashes and storage paths are metadata, never identity. What the
// provider's files were is a VERSION:
//
//   versionId = "hmv_" + base32(sha256("homatch.version.v1\n" + homatchAssetId + "\n" + sourceFilesHash + "\n" + policy))[0..26]
//
// and every object lives under its version: a new release adds objects and
// never overwrites what a saved design points at.
//
// DELIVERY. Who may read a stored object is decided by its licence and what
// it is, and written INTO its key, so a restricted source package can never
// become publicly readable by a rule written for something else:
//
//   design-studio/catalog/public/…      anyone (CC0, or a preview the licence lets anyone see)
//   design-studio/catalog/licensed/…    signed-in HOMATCH users, for the renderer (runtime derivatives a licence allows in-app)
//   design-studio/catalog/restricted/…  staff and the importer only (provider source packages; never delivered)
//
// Pure and dependency-free (Web Crypto only): the browser, the importer and
// the tests run the same code.

export type AssetKind = 'MATERIAL' | 'MODEL' | 'ENVIRONMENT';
export type Delivery = 'public' | 'licensed' | 'restricted';
export const CATALOG_PREFIX = 'design-studio/catalog';

// ── Identity ────────────────────────────────────────────────────────────

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function base32(bytes: Uint8Array, chars: number): string {
  let out = ''; let buffer = 0; let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b; bits += 8;
    while (bits >= 5 && out.length < chars) { out += CROCKFORD[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
    buffer &= (1 << bits) - 1;
    if (out.length >= chars) break;
  }
  return out;
}

export const HMA = /^hma_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;
export const HMV = /^hmv_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;
const PROVIDER_ID = /^[a-z0-9_-]{2,40}$/;

export async function homatchAssetId(provider: string, kind: AssetKind, sourceAssetId: string): Promise<string> {
  if (!PROVIDER_ID.test(provider) || !sourceAssetId) throw new Error('provider and source asset id are required');
  return `hma_${base32(await sha256(`homatch.asset.v1\n${provider}\n${kind}\n${sourceAssetId}`), 26)}`;
}

export async function versionId(assetId: string, sourceFilesHash: string, policy: string): Promise<string> {
  if (!HMA.test(assetId)) throw new Error('not a homatch asset id');
  if (!sourceFilesHash || !policy) throw new Error('a version needs the provider files hash and the policy');
  return `hmv_${base32(await sha256(`homatch.version.v1\n${assetId}\n${sourceFilesHash}\n${policy}`), 26)}`;
}

/** The catalogue row's uuid, derived from the asset id (RFC 4122 layout, version nibble 8: custom), so a rebuilt row keeps it. */
export async function rowUuid(assetId: string): Promise<string> {
  const h = await sha256(`homatch.row.v1\n${assetId}`);
  h[6] = (h[6] & 0x0f) | 0x80;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// ── Licences ────────────────────────────────────────────────────────────

export type LicenseClass = 'CC0' | 'ROYALTY_FREE' | 'UNKNOWN';

export interface License {
  licenseClass: LicenseClass;
  /** The provider's own identifier and version where it gives one ("cc_zero", "royalty_free"). */
  providerLicense: string | null;
  url: string | null;
  /** May the ORIGINAL files be handed to a third party? */
  redistribution: boolean;
  /** May a runtime derivative be delivered to HOMATCH users' browsers for rendering? Decided from the provider's current terms. */
  runtimeDelivery: 'PUBLIC' | 'SIGNED_IN' | 'NONE';
  attributionRequired: boolean;
  credit: string | null;
}

/**
 * A provider's licence word → a licence class. Anything not positively
 * recognised is UNKNOWN, and UNKNOWN never becomes READY: "free" is not CC0.
 */
export function classifyLicense(providerLicense: unknown): LicenseClass {
  const v = String(providerLicense ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['cc0', 'cc_0', 'cc_zero', 'cc0_1.0', 'cc0_1_0', 'public_domain_cc0'].includes(v)) return 'CC0';
  if (['royalty_free', 'rf', 'royaltyfree'].includes(v)) return 'ROYALTY_FREE';
  return 'UNKNOWN';
}

/** Why a licence may not enter the catalogue (null when it may). */
export function licenseRefusal(l: License | null): string | null {
  if (!l || l.licenseClass === 'UNKNOWN') return 'licence unknown: never imported';
  if (l.runtimeDelivery === 'NONE') return `licence ${l.licenseClass} does not permit runtime delivery`;
  return null;
}

/**
 * Where an object may be read from. Source packages are delivered only when
 * the licence lets anyone redistribute them (CC0); otherwise they stay
 * restricted. Runtime derivatives and previews follow the licence's
 * runtime-delivery permission. Metadata carries no provider content.
 */
export function deliveryFor(l: License, what: 'SOURCE' | 'RUNTIME' | 'PREVIEW' | 'METADATA'): Delivery {
  if (what === 'METADATA') return l.redistribution && l.runtimeDelivery === 'PUBLIC' ? 'public' : 'restricted';
  if (what === 'SOURCE') return l.redistribution && l.runtimeDelivery === 'PUBLIC' ? 'public' : 'restricted';
  return l.runtimeDelivery === 'PUBLIC' ? 'public' : l.runtimeDelivery === 'SIGNED_IN' ? 'licensed' : 'restricted';
}

// ── Canonical taxonomy and the plan ─────────────────────────────────────

export interface Canonical { canonicalCategory: string; canonicalSubcategory: string }

export type Role = 'GLTF' | 'GLB' | 'SOURCE_PACKAGE' | 'GEOMETRY' | 'BASE_COLOR' | 'NORMAL' | 'ORM' | 'HEIGHT' | 'OPACITY' | 'EMISSION' | 'HDRI' | 'THUMBNAIL' | 'METADATA';
export type Resolution = '1k' | '2k' | '4k' | null;

export interface PlannedFile {
  role: Role;
  resolution: Resolution;
  /** Path relative to the version folder: glTF references resolve inside it unchanged. */
  relPath: string;
  sourceUrl: string | null;
  /** Exact bytes from the provider (0 when it does not say). */
  bytes: number;
  md5: string | null;
  contentType: string;
  delivery: Delivery;
}

export interface AssetPlan {
  kind: AssetKind;
  sourceAssetId: string;
  resolutions: Array<'1k' | '2k' | '4k'>;
  files: PlannedFile[];
  bytes: number;
  /** Why the asset cannot be imported under the policy (null when it can). */
  refusal: string | null;
}

export interface Naming {
  displayName: string;
  /** Descriptors that tell this asset apart from a namesake, most telling first. */
  qualifiers: string[];
  normalizedName: string;
  styleTags: string[];
  colorTags: string[];
  materialTags: string[];
  aliases: string[];
}

export interface Discovered<A> { sourceAssetId: string; kind: AssetKind; canonical: Canonical; asset: A; naming: Naming }

/** A provider, as the pipeline sees it. Nothing provider-specific lives outside its adapter. */
export interface ProviderAdapter<A = unknown> {
  provider: string;
  policy: string;
  license(asset: A): License;
  discover(fetchJson: (url: string) => Promise<any>): Promise<Array<Discovered<A>>>;
  /** The shape of one of this provider's asset ids (checked before any request is made). */
  idPattern: RegExp;
  /**
   * Discover ONLY the named assets — one lookup each, never the provider's
   * whole listing. Ids the provider does not list, or that HOMATCH cannot
   * place on a shelf, come back in `missing` with the reason.
   */
  discoverIds(ids: string[], fetchJson: (url: string) => Promise<any>): Promise<{ found: Array<Discovered<A>>; missing: Array<{ id: string; reason: string }> }>;
  current(sourceAssetId: string, kind: AssetKind, fetchJson: (url: string) => Promise<any>): Promise<{ asset: A; files: Record<string, unknown>; filesHash: string; categoryId: string | null; categoryPath: string | null }>;
  plan(kind: AssetKind, sourceAssetId: string, asset: A, files: Record<string, unknown>, canonical: Canonical): AssetPlan;
  name(kind: AssetKind, asset: A, canonical: Canonical): Naming;
  environmentClass?(asset: A, canonical: Canonical): { lighting: string; context: string };
  appliesTo?(asset: A): Array<'WALL' | 'FLOOR' | 'CEILING' | 'OBJECT'>;
  physicalSizeMm?(asset: A): [number, number] | null;
  sourcePage(sourceAssetId: string): string;
}

/** The most assets one bounded discovery or enqueue may name (a canary, not a catalogue). */
export const MAX_NAMED_IDS = 50;

/**
 * A comma-separated id list → unique, well-formed ids. Anything malformed is
 * returned in `invalid` and never sent anywhere; more than MAX_NAMED_IDS is an
 * error, not a silent truncation.
 */
export function parseIds(raw: string, pattern: RegExp): { ids: string[]; invalid: string[] } {
  const all = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = [...new Set(all.filter((s) => pattern.test(s)))];
  const invalid = [...new Set(all.filter((s) => !pattern.test(s)))];
  if (ids.length + invalid.length > MAX_NAMED_IDS) throw new Error(`at most ${MAX_NAMED_IDS} ids may be named at once`);
  return { ids, invalid };
}

const CONTENT_TYPE: Record<string, string> = {
  gltf: 'model/gltf+json', bin: 'application/octet-stream', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  hdr: 'image/vnd.radiance', webp: 'image/webp', json: 'application/json', ktx2: 'image/ktx2', glb: 'model/gltf-binary', blend: 'application/octet-stream',
};
export const contentTypeOf = (path: string) => CONTENT_TYPE[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/**
 * What a MODEL delivered to a browser may weigh. The provider's original can
 * be large; the runtime derivative the scene loads is capped, compressed and
 * validated, and a model that cannot meet this is not READY (it is never
 * served in its original, heavyweight form instead).
 */
export const RUNTIME_POLICY = {
  maxTextureEdge: 2048,
  lod1TextureEdge: 1024,
  maxGlbBytes: 20_000_000,
  maxLod1Bytes: 8_000_000,
  simplifyAboveTriangles: 30_000,
} as const;

export interface RuntimeFacts { file: string; bytes: number; textureBytes: number; maxTextureEdge: number; textures: number; compressed: boolean }

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];

/**
 * What a runtime GLB actually carries, read from its bytes: total and texture
 * bytes, the largest texture edge (from each image's own header: KTX2, PNG,
 * JPEG) and whether every texture is GPU-compressed (KTX2).
 */
export function glbRuntimeFacts(bytes: Uint8Array, file = 'model.glb'): RuntimeFacts {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'glTF') throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen + 8;
  let textureBytes = 0; let maxEdge = 0; let compressed = true;
  for (const img of j.images ?? []) {
    const bv = j.bufferViews?.[img.bufferView];
    if (!bv) continue;
    textureBytes += bv.byteLength;
    const at = binStart + (bv.byteOffset ?? 0);
    let w = 0; let h = 0;
    if (KTX2_ID.every((v, i) => bytes[at + i] === v)) { w = dv.getUint32(at + 20, true); h = dv.getUint32(at + 24, true); } else {
      compressed = false;
      if (bytes[at] === 0x89 && bytes[at + 1] === 0x50) { w = dv.getUint32(at + 16); h = dv.getUint32(at + 20); } else if (bytes[at] === 0xff && bytes[at + 1] === 0xd8) {
        let p = at + 2;
        while (p + 8 < at + bv.byteLength) {
          const m = bytes[p + 1]; const len = dv.getUint16(p + 2);
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = dv.getUint16(p + 5); w = dv.getUint16(p + 7); break; }
          p += 2 + len;
        }
      }
    }
    maxEdge = Math.max(maxEdge, w, h);
  }
  return { file, bytes: bytes.byteLength, textureBytes, maxTextureEdge: maxEdge, textures: (j.images ?? []).length, compressed };
}

/** Why a model's runtime derivatives break the policy (null when they meet it). */
export function runtimeRefusal(main: RuntimeFacts | null, lod1: RuntimeFacts | null): string | null {
  if (!main) return 'no runtime derivative (the original is never served)';
  if (main.bytes > RUNTIME_POLICY.maxGlbBytes) return `runtime GLB ${main.bytes} bytes exceeds ${RUNTIME_POLICY.maxGlbBytes}`;
  if (main.maxTextureEdge > RUNTIME_POLICY.maxTextureEdge) return `runtime texture ${main.maxTextureEdge}px exceeds ${RUNTIME_POLICY.maxTextureEdge}px`;
  if (lod1 && lod1.bytes > RUNTIME_POLICY.maxLod1Bytes) return `LOD1 ${lod1.bytes} bytes exceeds ${RUNTIME_POLICY.maxLod1Bytes}`;
  if (lod1 && lod1.maxTextureEdge > RUNTIME_POLICY.lod1TextureEdge) return `LOD1 texture ${lod1.maxTextureEdge}px exceeds ${RUNTIME_POLICY.lod1TextureEdge}px`;
  return null;
}

const AREA: Record<AssetKind, string> = { MATERIAL: 'materials', MODEL: 'models', ENVIRONMENT: 'hdri' };

/** Where a planned file is stored: its delivery class, its area, its asset and version. */
export function objectKey(kind: AssetKind, assetId: string, version: string, f: Pick<PlannedFile, 'role' | 'relPath' | 'delivery'>, variant: 'SOURCE' | 'OPTIMIZED' = 'SOURCE'): string {
  const area = f.role === 'THUMBNAIL' ? 'thumbnails' : f.role === 'METADATA' ? 'metadata' : AREA[kind];
  const rel = variant === 'OPTIMIZED' ? `optimized/${f.relPath}` : f.relPath;
  return `${CATALOG_PREFIX}/${f.delivery}/${area}/${assetId}/${version}/${rel}`;
}

/** A catalogue key, and nothing else, may be signed for the importer. */
export const CATALOG_KEY = /^design-studio\/catalog\/(public|licensed|restricted)\/(models|materials|hdri|thumbnails|metadata)\/hma_[0-9a-z]{26}\/hmv_[0-9a-z]{26}\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){0,3}[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

// ── Names people can read ───────────────────────────────────────────────

/** Words that mean something to a provider's catalogue and nothing to a customer. */
const NOISE = /\b(aerial|pbr|scan|scanned|texture|material|seamless|free|hdri?|\d+k|lowpoly|low poly|game ready|blend)\b/gi;
const SPELLING: Record<string, string> = {
  'arm chair': 'Armchair', 'armchair': 'Armchair', 'tv': 'TV', 'led': 'LED', 'diy': 'DIY', 'bbq': 'BBQ',
};
export const COLORS = ['white', 'black', 'grey', 'gray', 'beige', 'cream', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gold', 'silver', 'dark', 'light'];
export const STYLE_WORDS = ['modern', 'contemporary', 'minimal', 'minimalist', 'scandinavian', 'japandi', 'luxury', 'mid century', 'industrial', 'classic', 'neoclassic', 'traditional', 'art deco', 'rustic', 'mediterranean', 'eclectic', 'farmhouse', 'vintage', 'antique', 'retro', 'ornate', 'victorian', 'boho', 'oriental', 'japanese', 'moroccan'];

export const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ').map((w) => (w.length <= 2 && /^(of|on|in|a|an|to|by)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
export const words = (list: Array<string | undefined>) => [...new Set(list.filter((x): x is string => !!x).map((x) => x.toLowerCase().trim()).filter(Boolean))];

/** "Arm Chair 01" → "Armchair"; "painted_plaster_wall_02" → "Painted Plaster Wall". */
export function cleanSourceName(name: string): string {
  let s = name.replace(/\([^)]*\)/g, ' ').replace(/[_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(NOISE, ' ');
  s = s.replace(/\b(\d{1,3}|[a-z]?\d{2,3}[a-z]?)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let t = titleCase(s);
  for (const [k, v] of Object.entries(SPELLING)) t = t.replace(new RegExp(`\\b${k}\\b`, 'ig'), v);
  return t || titleCase(name);
}

export const normalizeName = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Descriptors that add a word the name does not already say ("Worn Floor Tiles", never "Square Tiles Floor Tiles"). */
export function qualifiersFor(displayName: string, candidates: string[]): string[] {
  return words(candidates)
    .filter((q) => q.length > 2 && q.length < 18 && !q.split(/\s+/).some((w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, '')}s?\\b`, 'i').test(displayName) || displayName.toLowerCase().includes(w.replace(/s$/, ''))))
    .map((q) => titleCase(q.replace(/_/g, ' ')));
}

const LIGHTING_WORDS: Record<string, string> = {
  DAY: 'Clear Day', CLOUDY: 'Overcast', SUNSET: 'Golden Hour', EVENING: 'Evening', NIGHT: 'Night', STUDIO: 'Studio', INTERIOR_ARTIFICIAL: 'Warm Indoor',
};
const CONTEXT_WORDS: Record<string, string> = {
  SKY: 'Sky', RESIDENTIAL_INTERIOR: 'Residential Interior', HOSPITALITY_INTERIOR: 'Dining Interior', BALCONY_ROOFTOP: 'Rooftop View',
  URBAN: 'Street', GARDEN: 'Garden', PARK: 'Park', STUDIO: 'Lighting', OUTDOOR: 'Outdoor',
};
export const environmentName = (lighting: string, context: string, place: string) =>
  `${LIGHTING_WORDS[lighting] ?? 'Outdoor'} ${CONTEXT_WORDS[context] ?? 'Outdoor'} HDRI — ${place}`;

/**
 * Names are unique per kind across the WHOLE catalogue (every provider):
 * a name several assets share is qualified for all of them by what tells
 * them apart, decided in a stable order (by asset id), and `reserved` holds
 * names other providers already use. A re-run names every asset the same way.
 */
export function uniqueNames(
  items: Array<{ assetId: string; kind: AssetKind; displayName: string; qualifiers?: string[] }>,
  reserved: Array<{ kind: AssetKind; name: string }> = [],
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>(reserved.map((r) => `${r.kind}:${normalizeName(r.name)}`));
  const free = (kind: string, name: string) => !taken.has(`${kind}:${normalizeName(name)}`);
  const count = new Map<string, number>();
  for (const it of items) count.set(`${it.kind}:${normalizeName(it.displayName)}`, (count.get(`${it.kind}:${normalizeName(it.displayName)}`) ?? 0) + 1);
  const qualify = (it: { displayName: string }, q: string) => (it.displayName.includes(' — ') ? `${it.displayName} (${q})` : `${q} ${it.displayName}`);
  for (const it of [...items].sort((a, b) => (a.assetId < b.assetId ? -1 : 1))) {
    const shared = (count.get(`${it.kind}:${normalizeName(it.displayName)}`) ?? 0) > 1;
    let name = it.displayName;
    if (shared || !free(it.kind, name)) {
      const q = (it.qualifiers ?? []).find((x) => free(it.kind, qualify(it, x)));
      if (q) name = qualify(it, q);
    }
    let n = 1;
    const base = name;
    while (!free(it.kind, name)) { n += 1; name = `${base} ${n}`; }
    taken.add(`${it.kind}:${normalizeName(name)}`);
    out.set(it.assetId, name);
  }
  return out;
}

// ── Colour: first-class, comparable ─────────────────────────────────────

export const COLOR_FAMILIES = ['WHITE', 'OFF_WHITE', 'CREAM', 'BEIGE', 'BROWN', 'BLACK', 'GRAY', 'BLUE', 'GREEN', 'RED', 'ORANGE', 'YELLOW', 'PINK', 'PURPLE', 'METALLIC', 'WOOD_LIGHT', 'WOOD_MEDIUM', 'WOOD_DARK'] as const;
export type ColorFamily = typeof COLOR_FAMILIES[number];

const WORD_FAMILY: Record<string, ColorFamily> = {
  white: 'WHITE', 'off white': 'OFF_WHITE', ivory: 'OFF_WHITE', cream: 'CREAM', beige: 'BEIGE', sand: 'BEIGE', taupe: 'BEIGE', brown: 'BROWN',
  black: 'BLACK', grey: 'GRAY', gray: 'GRAY', charcoal: 'GRAY', blue: 'BLUE', navy: 'BLUE', green: 'GREEN', olive: 'GREEN', red: 'RED',
  burgundy: 'RED', orange: 'ORANGE', terracotta: 'ORANGE', yellow: 'YELLOW', mustard: 'YELLOW', pink: 'PINK', purple: 'PURPLE',
  gold: 'METALLIC', silver: 'METALLIC', chrome: 'METALLIC', brass: 'METALLIC', copper: 'METALLIC', steel: 'METALLIC',
  oak: 'WOOD_LIGHT', birch: 'WOOD_LIGHT', ash: 'WOOD_LIGHT', pine: 'WOOD_LIGHT', maple: 'WOOD_LIGHT', teak: 'WOOD_MEDIUM', cherry: 'WOOD_MEDIUM', walnut: 'WOOD_DARK', wenge: 'WOOD_DARK', ebony: 'WOOD_DARK',
};

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CIE L*a*b* (D65) of an sRGB colour: distances there track what people see. */
export function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export const deltaE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A hex colour or a colour word → its family (null when neither says). */
export function colorFamily(value: string): ColorFamily | null {
  const w = value.trim().toLowerCase();
  if (WORD_FAMILY[w]) return WORD_FAMILY[w];
  const rgb = hexToRgb(w);
  if (!rgb) return null;
  const [L, a, b] = rgbToLab(rgb);
  const chroma = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  if (chroma < 8) return L > 92 ? 'WHITE' : L > 80 ? 'OFF_WHITE' : L < 22 ? 'BLACK' : 'GRAY';
  if (hue >= 40 && hue < 100 && chroma < 28) return L > 82 ? 'CREAM' : L > 58 ? 'BEIGE' : 'BROWN';
  if (hue >= 20 && hue < 75 && L < 58) return 'BROWN';
  if (hue < 20 || hue >= 345) return L > 70 && chroma < 45 ? 'PINK' : 'RED';
  if (hue < 50) return 'ORANGE';
  if (hue < 100) return 'YELLOW';
  if (hue < 190) return 'GREEN';
  // In CIE Lab, blue sits near 300° and purple near 330°.
  if (hue < 310) return 'BLUE';
  if (hue < 340) return 'PURPLE';
  return 'PINK';
}

// ── How the renderer uses it ────────────────────────────────────────────

/** Existing ds_catalog_materials.category (the surface family the editor groups by). */
export const MATERIAL_FAMILY: Record<string, string> = {
  'MATERIAL.WOOD': 'WOOD', 'MATERIAL.STONE': 'STONE', 'MATERIAL.CERAMIC': 'TILE', 'MATERIAL.METAL': 'METAL', 'MATERIAL.TEXTILE': 'FABRIC',
  'MATERIAL.CONCRETE': 'WALL', 'MATERIAL.MASONRY': 'WALL', 'MATERIAL.WALLCOVERING': 'WALL', 'MATERIAL.RESILIENT': 'FLOOR',
  'MATERIAL.EXTERIOR_GROUND': 'FLOOR', 'MATERIAL.GLASS': 'GLASS',
};

type Maps = { albedo?: string | null; normal?: string | null; orm?: string | null; height?: string | null; opacity?: string | null; emission?: string | null };

/**
 * What the renderer needs to lay a material down: maps per resolution (1K
 * for mobile and distance, 2K for desktop — variants of the same asset), and
 * the controls the editor may change with their defaults. The physical size
 * one tile covers comes from the provider (millimetres), so repeat is exact.
 */
export function materialPbr(physicalSizeMm: [number, number] | null, mapsByRes: Record<string, Maps>) {
  const sizeM = physicalSizeMm ? [Math.round(physicalSizeMm[0]) / 1000, Math.round(physicalSizeMm[1]) / 1000] as [number, number] : null;
  const first = mapsByRes['1k'] ?? Object.values(mapsByRes)[0] ?? {};
  return {
    baseColor: '#ffffff',
    roughness: 1,
    metalness: 1,
    maps: { albedo: first.albedo ?? undefined, normal: first.normal ?? undefined, roughness: first.orm ?? undefined },
    mapsByRes,
    variants: { mobile: '1k', desktop: mapsByRes['2k'] ? '2k' : '1k' },
    ormPacking: 'glTF: R = occlusion, G = roughness, B = metalness',
    normalConvention: 'OpenGL (Y+)',
    colorSpace: { albedo: 'sRGB', normal: 'linear', orm: 'linear', height: 'linear', opacity: 'linear', emission: 'sRGB' },
    physicalSizeM: sizeM,
    repeatM: sizeM ? sizeM[0] : 1,
    rotationDeg: 0,
    controls: { repeatM: sizeM ? sizeM[0] : 1, rotationDeg: 0, scale: 1, roughnessFactor: 1, metalnessFactor: 1, normalScale: 1 },
  };
}

const SMALL = new Set(['ORNAMENT', 'SCULPTURE', 'VASE', 'FRAME', 'WALL_ART', 'CLOCK', 'COMPUTING', 'AUDIO_VIDEO', 'COOKWARE', 'TABLEWARE', 'UTENSIL', 'BOOKS', 'STATIONERY', 'TABLE_LAMP', 'PILLOW', 'THROW', 'ACCESSORY']);
const WALL = new Set(['WALL_DECOR', 'WALL_ART', 'FRAME', 'WALL_LIGHT', 'MIRROR', 'WALL_CABINET', 'UPPER_CABINET', 'RANGE_HOOD', 'RADIATOR', 'CURTAIN', 'BLIND', 'WINDOW', 'TV', 'WALL_MOUNTED_TOILET']);
const CEILING = new Set(['PENDANT', 'CHANDELIER', 'CEILING_LIGHT']);
const ROOMS: Record<string, string[]> = {
  BED: ['BEDROOM'], NIGHTSTAND: ['BEDROOM'], WARDROBE: ['BEDROOM', 'HALL', 'CORRIDOR', 'STORAGE'], DRESSER: ['BEDROOM'],
  KITCHEN: ['KITCHEN'], APPLIANCE: ['KITCHEN'], TOILET: ['BATHROOM', 'WC'], BIDET: ['BATHROOM', 'WC'], SINK: ['BATHROOM', 'WC', 'KITCHEN'],
  VANITY: ['BATHROOM'], BATHTUB: ['BATHROOM'], SHOWER: ['BATHROOM'], DINING_TABLE: ['KITCHEN', 'LIVING'], DINING_CHAIR: ['KITCHEN', 'LIVING'],
  SOFA: ['LIVING'], TV_UNIT: ['LIVING', 'BEDROOM'], DESK: ['LIVING', 'BEDROOM'], OUTDOOR: ['BALCONY', 'TERRACE'],
};

/** How a physical object sits, where it belongs, and what the walkthrough may do with it. */
export function modelPlacement(canonical: Canonical, sizeM: [number, number, number]) {
  const sub = canonical.canonicalSubcategory;
  const family = canonical.canonicalCategory.split('.').pop() ?? '';
  const mount = WALL.has(sub) ? 'WALL' : CEILING.has(sub) ? 'CEILING' : SMALL.has(sub) && Math.max(...sizeM) <= 0.8 ? 'SURFACE' : 'FLOOR';
  const anchor = ['BED', 'WARDROBE', 'DRESSER', 'BOOKCASE', 'TV_UNIT', 'SOFA', 'VANITY', 'TOILET', 'BATHTUB'].includes(sub) || mount === 'WALL' ? 'WALL'
    : ['DINING_TABLE', 'COFFEE_TABLE', 'RUG', 'KITCHEN_ISLAND'].includes(sub) ? 'CENTRE' : ['PLANT', 'FLOOR_LAMP'].includes(sub) ? 'CORNER' : 'FREE';
  const roomKinds = ROOMS[sub] ?? ROOMS[family] ?? [];
  const capabilities = ['MOVABLE', 'ROTATABLE', 'REPLACEABLE', 'DUPLICATABLE', 'HIDEABLE'];
  if (['SOFA', 'ARMCHAIR', 'CHAIR', 'DINING_CHAIR', 'OFFICE_CHAIR', 'BAR_STOOL', 'BENCH', 'OTTOMAN'].includes(sub)) capabilities.push('SITTABLE');
  if (sub === 'BED') capabilities.push('LIEABLE');
  if (family === 'LIGHTING') capabilities.push('SWITCHABLE');
  if (['WARDROBE', 'DOOR', 'REFRIGERATOR', 'OVEN', 'DISHWASHER', 'WASHING_MACHINE', 'CABINET'].includes(sub)) capabilities.push('OPENABLE');
  return { placement: mount, anchor, roomKinds, capabilities };
}

// ── What a glTF actually contains ───────────────────────────────────────

type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function trs(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): M4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export interface GltfFacts {
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  animations: number;
  /** World-space axis-aligned bounds in metres (glTF units), from accessor min/max through the node hierarchy. */
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  sizeM: [number, number, number] | null;
  /** Every external resource the glTF names (buffers and images). */
  uris: string[];
  problems: string[];
}

export function inspectGltf(json: unknown): GltfFacts {
  const g = (json ?? {}) as Record<string, any>;
  const problems: string[] = [];
  if (!g.asset || String(g.asset.version ?? '').split('.')[0] !== '2') problems.push('not glTF 2.0');
  const accessors = Array.isArray(g.accessors) ? g.accessors : [];
  const meshes = Array.isArray(g.meshes) ? g.meshes : [];
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  let triangles = 0;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  const visit = (i: number, parent: M4, depth: number) => {
    if (depth > 64 || !nodes[i]) return;
    const m = mul(parent, trs(nodes[i]));
    const mesh = meshes[nodes[i].mesh];
    for (const p of mesh?.primitives ?? []) {
      const pos = accessors[p.attributes?.POSITION];
      const count = p.indices !== undefined ? accessors[p.indices]?.count : pos?.count;
      if ((p.mode ?? 4) === 4 && Number.isFinite(count)) triangles += Math.floor(count / 3);
      if (pos?.min?.length === 3 && pos?.max?.length === 3) {
        for (let c = 0; c < 8; c += 1) {
          const v = [c & 1 ? pos.max[0] : pos.min[0], c & 2 ? pos.max[1] : pos.min[1], c & 4 ? pos.max[2] : pos.min[2]];
          for (let r = 0; r < 3; r += 1) {
            const w = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r];
            lo[r] = Math.min(lo[r], w); hi[r] = Math.max(hi[r], w);
          }
        }
      } else if (pos) problems.push('POSITION without min/max');
    }
    for (const c of nodes[i].children ?? []) visit(c, m, depth + 1);
  };
  const scene = (g.scenes ?? [])[g.scene ?? 0];
  const roots: number[] = scene?.nodes ?? nodes.map((_: unknown, i: number) => i).filter((i: number) => !nodes.some((n: any) => (n.children ?? []).includes(i)));
  for (const r of roots) visit(r, I4, 0);
  if (!triangles) problems.push('no triangles');
  const bbox = Number.isFinite(lo[0]) ? { min: lo as [number, number, number], max: hi as [number, number, number] } : null;
  const uris = [...(g.buffers ?? []), ...(g.images ?? [])].map((b: any) => b?.uri).filter((u: unknown): u is string => typeof u === 'string' && !u.startsWith('data:'));
  for (const u of uris) if (u.includes('..') || u.startsWith('/') || /^[a-z]+:/i.test(u)) problems.push(`external or unsafe uri: ${u}`);
  return {
    triangles, meshes: meshes.length, materials: (g.materials ?? []).length, textures: (g.textures ?? []).length, animations: (g.animations ?? []).length,
    bbox, sizeM: bbox ? [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((d) => Math.round(d * 1000) / 1000) as [number, number, number] : null,
    uris: uris.map((u: string) => decodeURIComponent(u)), problems,
  };
}

/** Magic bytes: a file is what its role says it is. */
export function looksLike(role: Role, head: Uint8Array): boolean {
  const ascii = (n: number) => String.fromCharCode(...head.subarray(0, n));
  if (role === 'HDRI') return ascii(10) === '#?RADIANCE' || ascii(6) === '#?RGBE';
  const jpgOrPng = (head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && ascii(4).slice(1) === 'PNG');
  if (['BASE_COLOR', 'NORMAL', 'ORM', 'HEIGHT', 'OPACITY', 'EMISSION'].includes(role)) return jpgOrPng;
  if (role === 'THUMBNAIL') return jpgOrPng || ascii(4) === 'RIFF';
  if (role === 'GLTF' || role === 'METADATA') return head[0] === 0x7b; // '{'
  if (role === 'GLB') return ascii(4) === 'glTF';
  // A .blend: plain ("BLENDER"), gzip or zstd compressed.
  if (role === 'SOURCE_PACKAGE') return ascii(7) === 'BLENDER' || (head[0] === 0x1f && head[1] === 0x8b) || (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd);
  return true;
}

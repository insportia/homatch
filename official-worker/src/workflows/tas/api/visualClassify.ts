// visualClassify.ts — deterministic classification and identity hints for
// official TAS visual material (Verify "Visual Property Intelligence").
//
// Everything here is pure: file name + attachment description + the TAS case
// context + (after download) image properties and drawing-page text. No model,
// no network. A wrong guess is worse than an honest OTHER, so:
//   - a render is never called a photo (render evidence always wins);
//   - an unlabelled image stays OTHER with low confidence unless its own EXIF
//     names a camera (PHOTO) or a rendering engine (RENDER);
//   - identity HINTS (building/block labels, unit and floor labels, the case's
//     cadastral codes) are collected here; the customer-facing SCOPE is decided
//     downstream against the requested unit (src/verify/intelligence/
//     visualAssets.ts) because the worker's TAS result is shared per parcel.

export type VisualAssetKind =
  | 'PHOTO'
  | 'RENDER'
  | 'CONSTRUCTION_PHOTO'
  | 'SITE_PLAN'
  | 'MASTER_PLAN'
  | 'FLOOR_PLAN'
  | 'UNIT_PLAN'
  | 'SECTION'
  | 'ELEVATION'
  | 'FACADE'
  | 'STRUCTURAL'
  | 'ENGINEERING'
  | 'LOCATION_DIAGRAM'
  | 'OTHER';

export type VisualCategory = 'BUILDING' | 'APARTMENT' | 'ARCHITECTURE' | 'STRUCTURE' | 'CONSTRUCTION' | 'SITE';

export const CATEGORY_OF_KIND: Record<VisualAssetKind, VisualCategory> = {
  PHOTO: 'BUILDING',
  RENDER: 'BUILDING',
  CONSTRUCTION_PHOTO: 'CONSTRUCTION',
  SITE_PLAN: 'SITE',
  MASTER_PLAN: 'SITE',
  LOCATION_DIAGRAM: 'SITE',
  FLOOR_PLAN: 'ARCHITECTURE',
  UNIT_PLAN: 'APARTMENT',
  SECTION: 'ARCHITECTURE',
  ELEVATION: 'ARCHITECTURE',
  FACADE: 'ARCHITECTURE',
  STRUCTURAL: 'STRUCTURE',
  ENGINEERING: 'STRUCTURE',
  OTHER: 'BUILDING',
};

/** Drawings: rendered from vector PDF pages. Pictures: embedded/native rasters. */
export const DRAWING_KINDS = new Set<VisualAssetKind>([
  'SITE_PLAN', 'MASTER_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN', 'SECTION', 'ELEVATION', 'FACADE', 'STRUCTURAL', 'ENGINEERING', 'LOCATION_DIAGRAM',
]);
export const PICTURE_KINDS = new Set<VisualAssetKind>(['PHOTO', 'RENDER', 'CONSTRUCTION_PHOTO']);

export interface VisualClassification {
  kind: VisualAssetKind;
  category: VisualCategory;
  /** 0..1 — how strongly the evidence supports `kind`. */
  confidence: number;
  /** Which evidence decided it (for audit; never shown raw to a customer). */
  basis: string;
}

/** Paperwork that is never a meaningful visual, whatever its format. */
export const PAPERWORK = /(ხელშეკრულ|contract|договор|ამონაწერ|extract|выписк|ქვითარ|invoice|receipt|გადახდ|payment|მინდობილ|power.?of.?attorney|доверенн|პირადობ|passport|id.?card|განცხადებ|application|заявлен|ბრძანებ|decree|სერტიფიკ|certificate|ლიცენზ|license|ცნობ|განმარტებით|explanatory|ბარათ|ანგარიშ|report)/i;

/**
 * Ordered rules: the FIRST match wins, so specific words come before generic
 * ones ("site plan" before "plan", "unit plan" before "floor plan", render
 * before photo). `weight` ranks candidates before anything is downloaded.
 */
const RULES: Array<{ kind: VisualAssetKind; re: RegExp; confidence: number; weight: number; label: string }> = [
  { kind: 'RENDER', label: 'render', confidence: 0.9, weight: 100, re: /(render|რენდერ|ვიზუალიზაც|vizualiz|visuali[sz]|визуализ|effects?result|lumion|v-?ray|corona|enscape|twinmotion|\b3d\b|perspective|პერსპექტივ|aerial|bird.?s?.?eye)/i },
  { kind: 'MASTER_PLAN', label: 'master plan', confidence: 0.85, weight: 64, re: /(master.?plan|მასტერ.?პლან|განაშენიანების.{0,20}გეგმ|გრგ|gdrp)/i },
  { kind: 'SITE_PLAN', label: 'site plan', confidence: 0.85, weight: 65, re: /(site|გენ\.?\s?გეგმ|გენგეგმ|gen.?gegm|სიტუაციურ|situaci|генплан|ситуацион|ტოპო|topo|შენობის\s*ლაქ|shenobis.?laqa|\blaqa\b|ლაქა|footprint|ლანდშაფტ|landscape|გამწვანებ|озелен)/i },
  { kind: 'LOCATION_DIAGRAM', label: 'location', confidence: 0.6, weight: 45, re: /(location|მდებარეობ|ორთოფოტო|ortho|\bmap\b|რუკა|გარემო|garemo|surround|схема\s*располож)/i },
  { kind: 'UNIT_PLAN', label: 'unit plan', confidence: 0.85, weight: 66, re: /(apartment.?plan|unit.?plan|flat.?plan|ბინის\s*გეგმ|ბინ(ა|ის)\s*(№|#)?\s*\d{1,4}|планировк\w*\s*квартир|квартир\w*\s*№?\s*\d)/i },
  { kind: 'FLOOR_PLAN', label: 'floor plan', confidence: 0.85, weight: 62, re: /(floor.?plans?|სართულ(ის|ების)?\s*გეგმ|ტიპიური\s*სართ|typical.?floor|поэтажн|план\w*\s*этаж|sartul)/i },
  { kind: 'SECTION', label: 'section', confidence: 0.85, weight: 55, re: /(section|ჭრილ|chril|разрез)/i },
  { kind: 'ELEVATION', label: 'elevation', confidence: 0.85, weight: 68, re: /(elevation|ფასადის\s*(ნახაზ|ხედ)|развертк)/i },
  { kind: 'FACADE', label: 'facade', confidence: 0.8, weight: 70, re: /(fa[cç]ade|ფასად|fasad|фасад)/i },
  { kind: 'STRUCTURAL', label: 'structural', confidence: 0.85, weight: 50, re: /(structur|კონსტრუქ|konstruk|конструк|საძირკვ|ფუნდამენტ|foundation|фундамент|армир|არმატურ|კარკას|ხიმინჯ|\bpiles?\b|seismic|სეისმ|reinforc|გადახურვის\s*ფილ|\bslab)/i },
  { kind: 'ENGINEERING', label: 'engineering', confidence: 0.8, weight: 30, re: /(hvac|ventilat|ვენტილაც|წყალსადენ|კანალიზაც|plumbing|electric|ელექტრო|ელ\.\s?მომარაგ|გათბობ|heating|გაზიფიკ|სანტექნ|ხანძარსაწინ|fire.?(safety|protect)|инженер|engineering|საინჟინრო)/i },
  { kind: 'PHOTO', label: 'photo', confidence: 0.8, weight: 80, re: /(photo|ფოტო|фото|\bfoto|ფოტოფიქსაც|\b(img|dsc|dscn|dji|pxl)[\s-]?\d)/i },
  // Generic "plan" last: a plan of something, most often a floor.
  { kind: 'FLOOR_PLAN', label: 'plan (generic)', confidence: 0.55, weight: 40, re: /(\bplans?\b|გეგმ|gegm|план)/i },
];

const CONSTRUCTION_CONTEXT = /(მშენებლობ|მიმდინარე\s*სამუშ|construction|progress|monitor|მონიტორინგ|ექსპლუატაციაში|commission|სტადია|stage|кадр\s*строит|строительств)/i;

export interface ClassifyInput {
  fileName?: string | null;
  description?: string | null;
  /** Case title / type / motion name — context only, never decisive alone. */
  context?: string | null;
  extension?: string | null;
}

/** Strip the extension and turn separators into spaces so \b works on names. */
export function normalizeName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isPaperwork(text: string): boolean {
  return PAPERWORK.test(text);
}

/** Metadata-only classification (before any download). null = paperwork. */
export function classifyVisualMeta(input: ClassifyInput): (VisualClassification & { weight: number; matched: boolean }) | null {
  const name = normalizeName(input.fileName);
  const text = `${name} ${input.description ?? ''}`.trim();
  if (text && isPaperwork(text)) return null;
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    let kind = r.kind;
    let basis = `name:${r.label}`;
    if (kind === 'PHOTO' && input.context && CONSTRUCTION_CONTEXT.test(`${text} ${input.context}`)) {
      kind = 'CONSTRUCTION_PHOTO';
      basis += '+construction-context';
    }
    return { kind, category: CATEGORY_OF_KIND[kind], confidence: r.confidence, basis, weight: r.weight, matched: true };
  }
  return { kind: 'OTHER', category: 'BUILDING', confidence: 0.35, basis: 'unlabelled', weight: 20, matched: false };
}

/** Kind of a drawing page from its own text layer (title block, labels). */
export function classifyPageText(text: string | null | undefined): VisualClassification | null {
  const t = String(text ?? '').slice(0, 4000);
  if (!t.trim()) return null;
  for (const r of RULES) {
    if (r.kind === 'RENDER' || r.kind === 'PHOTO') continue; // a vector page is a drawing
    if (r.re.test(t)) return { kind: r.kind, category: CATEGORY_OF_KIND[r.kind], confidence: Math.min(0.85, r.confidence), basis: `page-text:${r.label}` };
  }
  return null;
}

// ─────────────────────────── image properties (EXIF) ───────────────────────────

export interface ExifHints {
  make: string | null;
  model: string | null;
  software: string | null;
  dateTime: string | null;
}

const RENDER_SOFTWARE = /(lumion|v-?ray|corona|enscape|twinmotion|3ds\s*max|sketchup|blender|cinema\s*4d|d5\s*render|archicad|revit|unreal|keyshot|chaos)/i;

/** Make / Model / Software / DateTime from a JPEG's EXIF IFD0. Never throws. */
export function readExif(bytes: Uint8Array): ExifHints | null {
  try {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
    let i = 2;
    while (i + 4 < bytes.length && i < 65536 * 2) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) + bytes[i + 3];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
        const t = i + 10; // TIFF header
        const le = bytes[t] === 0x49;
        const u16 = (o: number) => (le ? bytes[t + o] + (bytes[t + o + 1] << 8) : (bytes[t + o] << 8) + bytes[t + o + 1]);
        const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
        const ifd = u32(4);
        const n = u16(ifd);
        const out: ExifHints = { make: null, model: null, software: null, dateTime: null };
        for (let k = 0; k < Math.min(n, 64); k++) {
          const e = ifd + 2 + k * 12;
          const tag = u16(e);
          const type = u16(e + 2);
          const count = u32(e + 4);
          if (type !== 2 || count < 2 || count > 200) continue;
          const off = count <= 4 ? e + 8 : u32(e + 8);
          let s = '';
          for (let c = 0; c < count - 1 && t + off + c < bytes.length; c++) s += String.fromCharCode(bytes[t + off + c]);
          s = s.replace(/\0+$/, '').trim() || '';
          if (!s) continue;
          if (tag === 0x010f) out.make = s;
          else if (tag === 0x0110) out.model = s;
          else if (tag === 0x0131) out.software = s;
          else if (tag === 0x0132) out.dateTime = s;
        }
        return out;
      }
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Refine a metadata classification with the picture's own properties.
 * Name evidence of a render is never overridden into a photo.
 */
export function refineWithImage(
  meta: VisualClassification,
  img: { exif: ExifHints | null; extraction: 'NATIVE_IMAGE' | 'PDF_EMBEDDED_IMAGE' | 'PDF_PAGE_RENDER'; pageText?: string | null; context?: string | null },
): VisualClassification {
  if (img.extraction === 'PDF_PAGE_RENDER') {
    const page = classifyPageText(img.pageText);
    // The page's own title block is more specific than the file name for
    // multi-sheet drawing sets; a generic file-level guess yields to it.
    if (page && (meta.kind === 'OTHER' || meta.confidence <= page.confidence || meta.basis.includes('generic'))) return page;
    if (meta.kind === 'OTHER') return { kind: 'OTHER', category: 'ARCHITECTURE', confidence: 0.3, basis: 'drawing-page:unlabelled' };
    if (PICTURE_KINDS.has(meta.kind)) return { ...meta, confidence: Math.min(meta.confidence, 0.5), basis: `${meta.basis}+page-render` };
    return meta;
  }
  const exif = img.exif;
  if (meta.kind === 'RENDER') return meta;
  if (exif?.software && RENDER_SOFTWARE.test(exif.software) && !exif.make) {
    return { kind: 'RENDER', category: 'BUILDING', confidence: 0.8, basis: 'exif:render-software' };
  }
  if (exif?.make && (meta.kind === 'OTHER' || meta.kind === 'PHOTO' || meta.kind === 'CONSTRUCTION_PHOTO' || meta.kind === 'LOCATION_DIAGRAM')) {
    const construction = meta.kind === 'CONSTRUCTION_PHOTO' || (!!img.context && CONSTRUCTION_CONTEXT.test(img.context));
    const kind: VisualAssetKind = construction ? 'CONSTRUCTION_PHOTO' : 'PHOTO';
    return { kind, category: CATEGORY_OF_KIND[kind], confidence: 0.85, basis: `exif:camera${meta.kind === 'OTHER' ? '' : `+${meta.basis}`}` };
  }
  return meta;
}

// ─────────────────────────── identity hints ───────────────────────────

export interface IdentityHints {
  /** Building / block ids named by the file, the drawing or the case codes ('01', '03', 'A'). */
  blocks: string[];
  /** Apartment / unit numbers named ('503'). */
  unitLabels: string[];
  /** Floor numbers named ('5'). */
  floorLabels: string[];
  /** The drawing says it is a typical floor. */
  typicalFloor: boolean;
  /** The TAS case's own cadastral codes (provenance for parcel matching). */
  caseCadastralCodes: string[];
  /** Where the block came from. */
  blockBasis: 'LABEL' | 'CASE_CADASTRAL' | null;
}

const pad2 = (s: string): string => (/^\d$/.test(s) ? `0${s}` : s.toUpperCase());

/** Block / building labels in Georgian, Latin and Russian spellings. */
export function detectBlocks(text: string): string[] {
  const out = new Set<string>();
  const t = String(text ?? '');
  const res = [
    /(?:block|bl\.|ბლოკ(?:ი|ის)?|კორპუს(?:ი|ის)?|korpus|корпус|building|bldg|შენობა|შენობის|ბლ\.)\s*(?:№|#|n|no\.?)?\s*-?\s*(\d{1,2}|[A-Da-d])(?![\dA-Za-z.])/gi,
    /მე-?\s*(\d{1,2})\s*(?:კორპუს|ბლოკ|შენობ)/gi,
    /(\d{1,2})\s*(?:-?ე|-?th|-?st|-?nd|-?rd)?\s*(?:კორპუს|ბლოკ|блок|корпус)/gi,
  ];
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const v = m[1];
      if (/^\d+$/.test(v) && (Number(v) === 0 || Number(v) > 40)) continue;
      out.add(pad2(v));
    }
  }
  return [...out];
}

export function detectUnitLabels(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:ბინა|ბინის|apartment|apt\.?|flat|квартира|unit)\s*(?:№|#|n|no\.?)?\s*(\d{1,4})(?![\d.])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? '')))) out.add(String(Number(m[1])));
  return [...out];
}

export function detectFloorLabels(text: string): { floors: string[]; typical: boolean } {
  const t = String(text ?? '');
  const out = new Set<string>();
  const res = [
    /(?:სართული|floor|этаж)\s*(?:№|#)?\s*(\d{1,2})(?![\d.])/gi,
    /(?<![\d.])(\d{1,2})\s*(?:-?ე|-?th|-?st|-?nd|-?rd)?\s*(?:სართულ(?!იან)|floor(?!s)|этаж(?!н))/gi,
    /მე-?\s*(\d{1,2})\s*სართულ(?!იან)/gi,
  ];
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) out.add(String(Number(m[1])));
  }
  return { floors: [...out], typical: /(ტიპიურ|typical|типов)/i.test(t) };
}

/** Building segment of each cadastral code that names one (≥ 6 segments). */
export function cadastralBuildings(codes: string[], parcel?: string | null): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    const seg = String(c).split('.');
    if (seg.length < 6) continue;
    if (parcel && !c.startsWith(`${parcel}.`)) continue;
    out.add(pad2(seg[5]));
  }
  return [...out];
}

export function identityHints(input: { fileName?: string | null; description?: string | null; caseText?: string | null; pageText?: string | null; caseCadastralCodes?: string[]; parcel?: string | null }): IdentityHints {
  // Labels on the file or the drawing itself describe THIS asset; the case
  // title may describe several buildings, so it only contributes when the
  // asset says nothing.
  const own = `${normalizeName(input.fileName)} ${input.description ?? ''} ${input.pageText ?? ''}`;
  let blocks = detectBlocks(own);
  let blockBasis: IdentityHints['blockBasis'] = blocks.length ? 'LABEL' : null;
  const codes = (input.caseCadastralCodes ?? []).map(String);
  if (!blocks.length) {
    const fromCodes = cadastralBuildings(codes, input.parcel);
    if (fromCodes.length) {
      blocks = fromCodes;
      blockBasis = 'CASE_CADASTRAL';
    }
  }
  const floor = detectFloorLabels(own);
  return {
    blocks,
    unitLabels: detectUnitLabels(own),
    floorLabels: floor.floors,
    typicalFloor: floor.typical,
    caseCadastralCodes: codes.slice(0, 12),
    blockBasis,
  };
}

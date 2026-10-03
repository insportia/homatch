// META ADS — CREATIVE TEXT LAYER. Regression for the production defect: a
// Creative Intelligence generation whose image came back with malformed Georgian
// ("Oინ Views") because the image model was asked to draw the ad copy.
//
// The rule under test: the image model draws the VISUAL ONLY; every customer-
// facing word is typeset by HOMATCH from structured copy, with the pinned font
// files, by ONE layout engine shared by the live preview and the PNG export.
// These tests use the real fonts and real HarfBuzz shaping (no mocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  ASPECTS, BROWSER_FAMILY, CANVAS, ENGINE_FILES, EXPORT_FAMILY, FONT_FILES, LAYOUT_ASPECTS, LAYOUT_IDS, MIN_CONTRAST, THEMES,
  bidiLevels, breakUnits, composeCreative, contrastRatio, createHarfbuzzMeasurer, layoutGeometry, lineRuns, mixedScriptWords,
  normalizeCopyText, normalizeSpec, renderCreativeSvg, scrimAlphaFor, textDirection, typesetText,
} from '../creativeLayout.ts';
import {
  ANALYSIS_VERSION, NO_TEXT_RULE, SOURCE_RULE, analysisSystemPrompt, defaultComposeSpec, generationPrompt, parseOverlayIntent, safeVisualBrief, validateAnalysis, variationLayouts,
} from '../creativeAi.ts';

const ROOT = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const bytes = (p) => readFileSync(new URL(p, ROOT));
const require = createRequire(new URL('package.json', ROOT));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const faces = Object.fromEntries(Object.entries(FONT_FILES).map(([k, v]) => [k, new Uint8Array(bytes(`public/creative-engine/${v.file}`))]));
const hbjs = require('harfbuzzjs/hbjs.js');
const { instance } = await WebAssembly.instantiate(bytes(`public/creative-engine/${ENGINE_FILES.harfbuzz.file}`));
const M = createHarfbuzzMeasurer(hbjs(instance), faces);

const COPY = {
  ka: { headline: 'იპოვე შენი ახალი სახლი ვაკეში', subheadline: '2-ოთახიანი ბინა პანორამული ხედით, 78 მ²', offer: '95 000 $-დან', cta: 'მოგვწერეთ დეტალებისთვის', brand: 'HOMATCH' },
  en: { headline: 'Find your new home in Vake', subheadline: 'Two-bedroom apartment with a panoramic view, 78 m²', offer: 'From $95,000', cta: 'Message us', brand: 'HOMATCH' },
  ru: { headline: 'Найдите свой новый дом в Ваке', subheadline: '2-комнатная квартира с панорамным видом, 78 м²', offer: 'от 95 000 $', cta: 'Напишите нам' },
  ar: { headline: 'ابحث عن منزلك الجديد في تبليسي', subheadline: 'شقة من 3 غرف بإطلالة بانورامية، 78 م²', offer: 'ابتداءً من 95,000 $', cta: 'راسلنا الآن', brand: 'HOMATCH' },
};
const SCRIPT = { ka: /[Ⴀ-ჿ]/, ar: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/, en: /[A-Za-z]/ };
const FONT_FOR = { ka: 'georgian', ar: 'arabic', ru: 'sans', en: 'sans' };
const STATS = { brightest: [250, 246, 236], darkest: [8, 8, 10] };

/** Every invariant a composition must hold, whatever the language, layout or format. */
function assertSound(c, label) {
  assert.ok(c.ok, `${label}: ${JSON.stringify(c.checks)}`);
  const { w, h } = c.canvas;
  const safeTop = c.spec.aspect === '9:16' ? 250 : 0;
  const safeBottom = c.spec.aspect === '9:16' ? h - 250 : h;
  for (const b of c.blocks) {
    // Exactly the customer's characters, no word lost, split, transliterated or re-spelled.
    assert.equal(b.lines.map((l) => l.text).join(' '), c.copy[b.field], `${label}: ${b.field} typeset verbatim`);
    for (const l of b.lines) {
      const glyphs = l.runs.map((r) => r.text).join('');
      assert.equal(Array.from(glyphs).filter((ch) => /\S/.test(ch)).sort().join(''), Array.from(l.text).filter((ch) => /\S/.test(ch)).map((ch) => ({ '(': ')', ')': '(' }[ch] ?? ch)).sort().join(''), `${label}: ${b.field} runs carry exactly the line's characters`);
      for (const r of l.runs) {
        assert.ok(r.x >= c.textRegion.x - 2 && r.x + r.width <= c.textRegion.x + c.textRegion.w + 2, `${label}: ${b.field} run inside the text area`);
        assert.ok(r.x >= 0 && r.x + r.width <= w, `${label}: inside the canvas`);
      }
      assert.ok(l.top >= c.textRegion.y - 2 && l.top + l.height <= c.textRegion.y + c.textRegion.h + 2, `${label}: ${b.field} line inside the text area vertically`);
      assert.ok(l.top >= safeTop - 2 && l.top + l.height <= safeBottom + 2, `${label}: ${b.field} out of the Stories UI zones`);
    }
    const floor = { headline: 40, subheadline: 26, offer: 28, cta: 24, brand: 22, badge: 22 }[b.field];
    assert.ok(b.size >= floor, `${label}: ${b.field} is never microscopic (${b.size}px)`);
  }
  for (let i = 0; i < c.blocks.length; i++) for (let j = i + 1; j < c.blocks.length; j++) {
    const a = c.blocks[i].box, b = c.blocks[j].box;
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${label}: ${c.blocks[i].field} and ${c.blocks[j].field} never touch`);
  }
}

/* ── The production defect ─────────────────────────────────────────── */

// The concept production generated from, verbatim (analysis 3693319b): Georgian, and it ASKED for text in the image.
const PROD_CONCEPT = {
  title: 'ორი ხედვა', cta: 'მოგვწერეთ დეტალებისთვის', safeArea: 'BOTTOM',
  angle: 'ორი რენდერის დაპირისპირება აჩვენებს როგორც სივრცის რეალურ განლაგებას, ისე მის მოწყობილ ვიზუალურ შესაძლებლობას.',
  visual: 'გამოიყენეთ თბილი, მოწყობილი რენდერი მთავარ აქცენტად, ხოლო მეორე გეგმა დატოვეთ შედარებისთვის; შეინარჩუნეთ ნეიტრალური ღია ფონი და მუქი, მკაფიო ტექსტი.',
  composition: 'მოაშორეთ რედაქტორის ინტერფეისი, გაზარდეთ ორივე გეგმა და განათავსეთ ისინი გვერდიგვერდ; ქვედა შავ ან ნეიტრალურ ზონაში დაამატეთ მოკლე სათაური და მშვიდი მოწოდება.',
};

test('PRODUCTION DEFECT: the image prompt for the real Georgian concept carries no Georgian, no copy and an explicit no-text rule', () => {
  const a = validateAnalysis({ subject: 'სურათზე ნაჩვენებია საცხოვრებლის ორი სამგანზომილებიანი გეგმარება', strengths: [], issues: [], concepts: [PROD_CONCEPT, { ...PROD_CONCEPT, title: 'გეგმა დეტალებში' }] });
  for (const [i, layout] of variationLayouts(a.concepts[0], 3).entries()) {
    const p = generationPrompt({ analysis: a, concept: a.concepts[0], ctx: { propertyType: 'apartment', headline: 'იპოვე ...' }, variation: i, layout });
    assert.doesNotMatch(p, /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/, 'not one Georgian character reaches the image model');
    assert.doesNotMatch(p, /[^\u0000-ɏ‐-‧\s]/, 'the prompt is plain Latin-script English');
    assert.ok(p.includes(NO_TEXT_RULE), 'the no-text rule is always there');
    assert.match(p, /in any language or alphabet \(Latin, Georgian, Cyrillic, Arabic, Hebrew/);
    assert.match(p, /screenshot of an app or editor interface/, 'interface text in a source photo is removed, not redrawn');
    assert.doesNotMatch(p, /headline|სათაური|call to action|Customer's request/i, 'the ad copy is never something to draw');
  }
});

test('the visual brief the image model gets is English and picture-only; anything asking for lettering is dropped', () => {
  assert.equal(safeVisualBrief('Warm golden light, wide framing. Add a short headline in the lower zone.'), 'Warm golden light, wide framing.');
  assert.equal(safeVisualBrief('ქვედა ზონაში დაამატეთ მოკლე სათაური'), null, 'non-Latin brief → none (a generic picture-only brief is used)');
  assert.equal(safeVisualBrief('Put the logo and a CTA button top right.'), null);
  assert.equal(safeVisualBrief('Soft morning light; calm, airy framing with the window as the hero.'), 'Soft morning light; calm, airy framing with the window as the hero.');
  const v2 = validateAnalysis({ subject: 'A bright living room', strengths: [], issues: [], concepts: [
    { title: 'Calm', angle: 'Quiet', visual: 'Warm', composition: 'Wide', cta: 'Write', safeArea: 'BOTTOM', layout: 'OVERLAY_BOTTOM', visualBrief: 'Golden-hour light across the floor.', copy: { headline: 'იპოვე შენი სახლი', headlineShort: 'შენი სახლი', subheadline: 'ვაკე, 78 მ²', cta: 'მოგვწერეთ' } },
    { title: 'City', angle: 'Close', visual: 'Day', composition: 'Tight', cta: 'Call', safeArea: 'TOP' },
  ] });
  assert.ok(ANALYSIS_VERSION >= 3, 'cached older analyses (copy mixed into the picture direction; no source rule) are not reused');
  assert.equal(v2.concepts[0].layout, 'OVERLAY_BOTTOM');
  assert.equal(v2.concepts[0].copy.headline, 'იპოვე შენი სახლი', 'the copy is structured data for the text layer');
  assert.equal(v2.concepts[1].layout, 'EDITORIAL_TOP', 'a v1-style concept maps its safe area onto a layout');
  const p = generationPrompt({ analysis: v2, concept: v2.concepts[0], ctx: {}, variation: 0 });
  assert.match(p, /Golden-hour light across the floor/);
  assert.match(p, /Keep the lower \d+% of the frame visually calm/, 'the overlay layout reserves its calm area in the visual');
  assert.doesNotMatch(p, /იპოვე/);
});

test('the customer’s own instruction is quoted as a look preference, never as words to draw', () => {
  const a = validateAnalysis({ subject: 'A building', concepts: [{ ...PROD_CONCEPT }, { ...PROD_CONCEPT }] });
  const p = generationPrompt({ analysis: a, concept: a.concepts[0], ctx: {}, instruction: 'more premium', variation: 0 });
  assert.match(p, /preference for the look of the picture \(a description only — never write it into the image\): "more premium"/);
});

test('the default text layer comes from the concept’s structured copy and the layout the visual was made for', () => {
  const concept = { id: 'c1', title: 'T', angle: 'a', visual: 'v', composition: 'c', cta: 'Write', safeArea: 'BOTTOM', layout: 'OVERLAY_BOTTOM', copy: { headline: 'იპოვე შენი სახლი', headlineShort: 'შენი სახლი', subheadline: 'ვაკე', cta: 'მოგვწერეთ' } };
  const s = defaultComposeSpec({ concept, headline: 'ignored', layout: 'EDITORIAL_TOP', width: 1024, height: 1536 });
  assert.deepEqual([s.layout, s.aspect, s.copy.headline, s.copy.cta, s.shortHeadline], ['EDITORIAL_TOP', '4:5', 'იპოვე შენი სახლი', 'მოგვწერეთ', 'შენი სახლი']);
  assert.equal(defaultComposeSpec({ concept: null, headline: 'Vake', width: 1024, height: 1024 }).aspect, '1:1');
  assert.deepEqual(variationLayouts({ layout: 'SPLIT_START', safeArea: 'LEFT' }, 3), ['SPLIT_START', 'OVERLAY_BOTTOM', 'EDITORIAL_BOTTOM'], 'variations differ by composition, not by spelling attempts');
});

/* ── Languages ─────────────────────────────────────────────────────── */

for (const lang of ['ka', 'en', 'ru', 'ar']) {
  test(`${lang.toUpperCase()}: every layout × format typesets the exact copy, in the right font, inside its safe area, legibly`, () => {
    for (const layout of LAYOUT_IDS) for (const aspect of LAYOUT_ASPECTS[layout]) for (const theme of ['INK', 'PAPER']) {
      const c = composeCreative({ layout, aspect, theme, copy: COPY[lang] }, M, STATS);
      const label = `${lang} ${layout} ${aspect} ${theme}`;
      assertSound(c, label);
      assert.equal(c.dir, lang === 'ar' ? 'rtl' : 'ltr', `${label}: direction`);
      for (const b of c.blocks) for (const l of b.lines) for (const r of l.runs) {
        if (SCRIPT[lang].test(r.text) && lang !== 'en') assert.equal(r.font, FONT_FOR[lang], `${label}: ${lang} glyphs come from the ${FONT_FOR[lang]} face, never a fallback`);
        if (/[A-Za-z]/.test(r.text)) assert.equal(r.font, 'sans', `${label}: Latin letters come from Noto Sans`);
      }
      for (const b of c.blocks) {
        const bg = b.field === 'cta' ? THEMES[theme].ctaFill : null;
        if (bg) assert.ok(contrastRatio(b.color, bg) >= MIN_CONTRAST, `${label}: CTA readable`);
      }
    }
  });
}

test('ARABIC RTL: start alignment is the right edge, and numbers / Latin read correctly inside Arabic', () => {
  const c = composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect: '4:5', theme: 'INK', copy: COPY.ar }, M, STATS);
  const right = c.textRegion.x + c.textRegion.w;
  for (const b of c.blocks.filter((x) => x.field !== 'cta' && x.field !== 'badge')) {
    for (const l of b.lines) assert.ok(Math.abs(l.x + l.width - right) < 1, `${b.field}: right-aligned`);
  }
  assert.ok(Math.abs(c.blocks.find((b) => b.field === 'cta').pill.rect.x + c.blocks.find((b) => b.field === 'cta').pill.rect.w - right) < 1, 'the CTA sits at the start (right) edge');
  // "شقة من 3 غرف": the first Arabic words are rightmost, the number is its own LTR island between them.
  const runs = lineRuns('شقة من 3 غرف', 'rtl', M).filter((r) => r.text.trim());
  assert.deepEqual(runs.map((r) => [r.text, r.level]), [['شقة من', 1], ['3', 2], ['غرف', 1]]);
  const placed = composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect: '4:5', theme: 'INK', copy: { headline: 'شقة من 3 غرف' } }, M).blocks[0].lines[0].runs.filter((r) => r.text.trim());
  assert.deepEqual(placed.map((r) => r.text), ['غرف', '3', 'شقة من'], 'visual order, left to right');
  assert.deepEqual(bidiLevels(Array.from('اتصل بـ HOMATCH الآن'), 'rtl').filter((_, i) => i >= 8 && i < 15), [2, 2, 2, 2, 2, 2, 2], 'a Latin brand is an LTR island');
  assert.equal(textDirection('ابحث'), 'rtl');
  assert.equal(textDirection('3 ოთახი'), 'ltr');
  assert.equal(textDirection('שלום'), 'rtl', 'Hebrew too');
});

test('GEORGIAN multiline: a long headline wraps on whole words into balanced lines at a readable size', () => {
  const headline = 'იპოვე შენი ახალი სახლი ვაკეში — პანორამული ხედით და მზიანი აივნით';
  const c = composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect: '4:5', theme: 'INK', copy: { headline, cta: 'მოგვწერეთ' } }, M);
  assertSound(c, 'ka long');
  const h = c.blocks.find((b) => b.field === 'headline');
  assert.ok(h.lines.length >= 2, 'wrapped');
  const words = new Set(headline.split(' '));
  for (const l of h.lines) for (const w of l.text.split(' ')) assert.ok(words.has(w), `"${w}" is a whole word of the headline`);
  const widths = h.lines.map((l) => l.width);
  assert.ok(Math.min(...widths) / Math.max(...widths) > 0.5, 'balanced: no orphaned last word');
  assert.equal(typesetText(c).headline, headline);
});

test('short headline: large type; long copy: the approved shorter headline first, then a roomier layout — never clipped', () => {
  const short = composeCreative({ layout: 'OVERLAY_BOTTOM', aspect: '1:1', theme: 'INK', copy: { headline: 'ვაკე' } }, M);
  assert.equal(short.blocks[0].size, 84, 'a short headline keeps its full size');
  const long = 'Spacious three-bedroom family apartment with a panoramic terrace and underground parking in Vake';
  const copy = { headline: long.slice(0, 90), subheadline: 'Two bathrooms, a sunny kitchen, storage room and concierge service in a quiet green street', offer: 'From $195,000 with flexible payment', cta: 'Book a viewing', brand: 'HOMATCH', badge: 'New project' };
  const withShort = composeCreative({ layout: 'SPLIT_START', aspect: '1:1', theme: 'PAPER', copy, shortHeadline: 'Family flat in Vake' }, M);
  assert.ok(withShort.ok, JSON.stringify(withShort.checks));
  assert.ok(withShort.checks.some((x) => x.code === 'SHORT_HEADLINE_USED' || x.code === 'LAYOUT_CHANGED'), 'the change is said, not silent');
  assertSound(withShort, 'long copy');
  const impossible = composeCreative({ layout: 'SPLIT_START', aspect: '1:1', theme: 'INK', copy: { headline: 'Ა'.repeat(60) } }, M);
  assert.equal(impossible.ok, false);
  assert.ok(impossible.checks.some((x) => x.code === 'TEXT_TOO_LONG' && x.field === 'headline' && x.blocking), 'a word that cannot fit blocks confirmation instead of being hidden');
  assert.equal(composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect: '1:1', theme: 'INK', copy: { headline: '' } }, M).checks[0].code, 'HEADLINE_REQUIRED');
});

test('formats: 1:1, 4:5 and 9:16 canvases; 9:16 keeps text out of Meta’s Stories UI zones', () => {
  assert.deepEqual(ASPECTS, ['1:1', '4:5', '9:16']);
  assert.deepEqual([CANVAS['1:1'], CANVAS['4:5'], CANVAS['9:16']].map((c) => `${c.w}x${c.h}`), ['1080x1080', '1080x1350', '1080x1920']);
  for (const layout of LAYOUT_IDS.filter((l) => LAYOUT_ASPECTS[l].includes('9:16'))) {
    const g = layoutGeometry(layout, '9:16', 'ltr');
    assert.ok(g.text.y >= 250 && g.text.y + g.text.h <= 1920 - 250, `${layout}: text area inside the Stories safe zone`);
  }
  assert.ok(!LAYOUT_ASPECTS.SPLIT_START.includes('9:16'), 'a side panel is never squeezed into a story');
  assert.equal(normalizeSpec({ layout: 'SPLIT_START', aspect: '9:16' }).aspect, '4:5');
});

test('legibility: overlay scrims are as strong as the brightest pixel under the text requires; panels meet 4.5:1', () => {
  for (const th of Object.values(THEMES)) {
    assert.ok(contrastRatio(th.text, th.bg) >= MIN_CONTRAST && contrastRatio(th.muted, th.bg) >= MIN_CONTRAST && contrastRatio(th.accent, th.bg) >= MIN_CONTRAST && contrastRatio(th.ctaText, th.ctaFill) >= MIN_CONTRAST);
  }
  const white = scrimAlphaFor('#FFFFFF', '#060A12', { brightest: [255, 255, 255], darkest: [0, 0, 0] });
  const dim = scrimAlphaFor('#FFFFFF', '#060A12', { brightest: [60, 60, 70], darkest: [0, 0, 0] });
  assert.ok(white > dim, 'a bright sky gets a stronger scrim than a dark floor');
  const c = composeCreative({ layout: 'OVERLAY_BOTTOM', aspect: '4:5', theme: 'INK', copy: COPY.ka }, M, { brightest: [255, 255, 255], darkest: [0, 0, 0] });
  assertSound(c, 'overlay on a white area');
  assert.ok(c.scrim.alpha >= white);
});

test('copy hygiene: invisible bidi/control characters never reach the image; mixed-alphabet words are flagged (the "Oინ" defect)', () => {
  assert.equal(normalizeCopyText('‫იპოვე‏  შენი\u0007 სახლი '), 'იპოვე შენი სახლი');
  assert.deepEqual(mixedScriptWords('Oინ Views'), ['Oინ']);
  assert.deepEqual(mixedScriptWords('HOMATCH-ში 2-ოთახიანი'), [], 'a hyphenated suffix is not a mixed word');
  const c = composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect: '1:1', theme: 'INK', copy: { headline: 'Oინ Views' } }, M);
  assert.ok(c.checks.some((x) => x.code === 'MIXED_SCRIPT_WORD' && !x.blocking));
  assert.deepEqual(breakUnits('78 მ² და 95 000 $ ან $ 120'), ['78 მ²', 'და', '95 000 $', 'ან', '$ 120'], 'a number never leaves its unit or currency');
});

/* ── One engine: preview = export ──────────────────────────────────── */

test('preview and export are the SAME composition: the SVGs differ only in font family names and the visual href', () => {
  const c = composeCreative({ layout: 'OVERLAY_BOTTOM', aspect: '4:5', theme: 'INK', copy: COPY.ka }, M, STATS);
  const preview = renderCreativeSvg(c, { visualHref: 'https://signed.example/v.png?token=1', families: BROWSER_FAMILY });
  const exported = renderCreativeSvg(c, { visualHref: 'data:image/png;base64,AAAA', families: EXPORT_FAMILY });
  const norm = (s, fam, href) => Object.entries(fam).reduce((acc, [k, v]) => acc.split(`font-family="${v}"`).join(`font-family="@${k}"`), s).split(href.replace(/&/g, '&amp;')).join('@href');
  assert.equal(norm(preview, BROWSER_FAMILY, 'https://signed.example/v.png?token=1'), norm(exported, EXPORT_FAMILY, 'data:image/png;base64,AAAA'));
  for (const b of c.blocks) for (const l of b.lines) for (const r of l.runs) if (r.text.trim()) assert.ok(preview.includes(`>${r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`), `"${r.text}" is real text in the preview SVG`);
  for (const w of COPY.ka.headline.split(' ')) assert.ok(preview.includes(w), `"${w}" — a whole Georgian word, as Unicode text`);
  assert.doesNotMatch(preview, /<path/, 'text is text, never outlines');
});

test('export: the server rasteriser draws the composition deterministically at the format’s exact size', async () => {
  const { initWasm, Resvg } = await import(new URL('node_modules/@resvg/resvg-wasm/index.mjs', ROOT).href);
  await initWasm(bytes(`public/creative-engine/${ENGINE_FILES.resvg.file}`)).catch(() => undefined);
  const fontBuffers = Object.values(faces);
  // A plain mid-grey visual: everything that is not grey or the panel in the text area is a glyph.
  const visual = `data:image/png;base64,${Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><rect width="64" height="96" fill="#7f7f7f"/></svg>').render().asPng()).toString('base64')}`;
  for (const aspect of ASPECTS) {
    const c = composeCreative({ layout: 'EDITORIAL_BOTTOM', aspect, theme: 'INK', copy: COPY.ka }, M);
    const svg = renderCreativeSvg(c, { visualHref: visual, families: EXPORT_FAMILY });
    const render = () => new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Noto Sans' } }).render();
    const a = render(), b = render();
    assert.equal(`${a.width}x${a.height}`, `${CANVAS[aspect].w}x${CANVAS[aspect].h}`);
    assert.equal(sha(a.asPng()), sha(b.asPng()), `${aspect}: the export is deterministic`);
    // The headline's line boxes contain drawn (light) pixels on the dark panel: the Georgian really is there.
    const h = c.blocks.find((x) => x.field === 'headline').lines[0];
    let lit = 0;
    const px = a.pixels; // the getter copies the whole bitmap: read it once
    for (let y = Math.round(h.top); y < h.top + h.height; y++) for (let x = Math.round(h.x); x < h.x + h.width; x++) if (px[(y * a.width + x) * 4] > 200) lit++;
    assert.ok(lit > 500, `${aspect}: headline glyphs rendered (${lit} lit px)`);
  }
});

/* ── Pinned assets, one engine, no model on edits ──────────────────── */

test('engine assets: every file the server and the preview load is pinned by SHA-256 and matches the installed engine', () => {
  for (const f of [...Object.values(FONT_FILES), ...Object.values(ENGINE_FILES)]) assert.equal(sha(bytes(`public/creative-engine/${f.file}`)), f.sha256, f.file);
  assert.equal(sha(bytes('node_modules/@resvg/resvg-wasm/index_bg.wasm')), ENGINE_FILES.resvg.sha256, 'the export rasteriser is the installed resvg');
  assert.equal(sha(bytes('node_modules/harfbuzzjs/hb.wasm')), ENGINE_FILES.harfbuzz.sha256, 'the shaper is the installed HarfBuzz');
  const pkg = JSON.parse(read('package.json'));
  const composer = read('supabase/functions/meta-ads-api/composer.ts');
  assert.ok(composer.includes(`npm:@resvg/resvg-wasm@${pkg.devDependencies['@resvg/resvg-wasm']}`), 'the edge renderer version = the tested one');
  assert.ok(composer.includes(`npm:harfbuzzjs@${pkg.devDependencies.harfbuzzjs}/hbjs.js`), 'the edge shaper version = the tested one');
  assert.match(composer, /ASSET_INTEGRITY/, 'a font that does not match its hash is refused');
  const fonts = read('src/components/metaAds/builder/creativeFonts.ts');
  assert.match(fonts, /BROWSER_FAMILY\[font\]/, 'the preview registers the same files under private names');
});

test('text-only and layout edits never call the image model and never charge', () => {
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  const composer = read('supabase/functions/meta-ads-api/composer.ts');
  assert.doesNotMatch(composer, /openai|images\/edits|beginExecution|settleExecution|wallet/i, 'the composer has no model and no money');
  for (const name of ['creative_ai_compose', 'creative_ai_compose_save', 'creative_ai_use']) {
    const start = srv.indexOf(`case '${name}'`);
    const body = srv.slice(start, srv.indexOf("case '", start + 10) > 0 ? srv.indexOf("case '", start + 10) : srv.indexOf('default:', start));
    assert.ok(start > 0, name);
    assert.doesNotMatch(body, /images\/edits|runGeneration|beginExecution|settleExecution|textInVisual/, `${name}: zero image-model calls, nothing charged`);
  }
  assert.match(srv, /if \(!composed\.composition\.ok\) return \{ error: 'COMPOSITION_INVALID'/, 'an illegible composition is never exported');
  // What Meta receives is the composed PNG; the clean visual is kept for later edits.
  assert.match(srv, /visualPath: src\.visualPath/);
  const ui = read('src/components/metaAds/builder/CreativeComposer.tsx');
  assert.doesNotMatch(ui, /aiGenerate|aiQuote/, 'the composer UI cannot start a generation');
  assert.match(ui, /disabled=\{!canSubmit\}/, 'nothing is created before every preview passes its checks');
  assert.match(ui, /composedKey !== editKey/, 'nothing is created from a preview of an older edit');
  assert.match(ui, /dir="auto"/, 'copy fields type RTL text naturally');
  assert.match(ui, /\[&_svg\]:w-full/, 'the preview scales to a phone width');
});

test('generation stays idempotent: one job per confirmed click; each variation is made for a layout and checked for lettering', () => {
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.match(srv, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(srv, /eq\('idempotency_key', key\)/);
  assert.match(srv, /replay: true/);
  assert.match(srv, /const layouts = variationLayouts\(concept, variations, args\.overlay\?\.placement \?\? null\)/);
  assert.match(srv, /layout: layouts\[i % layouts\.length\]/);
  assert.match(srv, /const flags = await Promise\.all\(good\.map\(\(g\) => textInVisual\(sb, jobId, g\.bytes\)\)\)/);
  assert.match(srv, /operation_type: 'meta_ads_creative_text_check'/, 'the check is a HOMATCH cost, never the customer’s');
  const panel = read('src/components/metaAds/builder/CreativeAiPanel.tsx');
  assert.match(panel, /keyRef\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(panel, /if \(needEdit\.length\) setComposeFor\(needEdit\); else onOpenChange\(false\);/, 'only a creative that cannot be finished as shown opens the editor');
  assert.match(panel, /Number\(\(an\.analysis as \{ version\?: number \} \| null\)\?\.version \?\? 0\) >= ANALYSIS_VERSION/, 'an older cached analysis is analysed again (free), never reused');
});


/* ── Closure: the source is the subject; text requests go to the text layer ── */

test('SOURCE PRESERVATION: every image prompt says the upload IS the advertised subject — a floor plan stays a floor plan', () => {
  const a = validateAnalysis({ subject: 'Two 3D floor plans of an apartment', strengths: [], issues: [], concepts: [{ ...PROD_CONCEPT }, { ...PROD_CONCEPT }] });
  const p = generationPrompt({ analysis: a, concept: a.concepts[0], ctx: {}, variation: 0 });
  assert.ok(p.includes(SOURCE_RULE));
  assert.match(p, /authoritative marketing subject/);
  assert.match(p, /floor plan[^.]*keep it that kind of image/);
  assert.match(p, /Do NOT redesign it, furnish it, reconstruct it as a different apartment or 3D interior/);
  assert.match(p, /Do not crop away or remove important parts of the source/);
  assert.doesNotMatch(p, /Premium real-estate advertising photograph/, 'no generic interior brief that invites a redesign');
  assert.ok(p.indexOf(SOURCE_RULE) < p.indexOf('Visual direction'), 'the source rule comes before any styling');
  assert.match(analysisSystemPrompt('Georgian'), /not interior design, architecture or floor-plan redesign/);
});

test('NATURAL-LANGUAGE TEXT REQUESTS become text-layer intent, never image-prompt text', () => {
  const cases = [
    ['ფოტოზე ეწეროს ფასი $160,000', { text: 'ფასი $160,000', field: 'offer', placement: null }],
    ['ზემოთ დაწერე იყიდება', { text: 'იყიდება', field: 'headline', placement: 'top' }],
    ['მინდა ეწეროს პარკინგი საჩუქრად', { text: 'პარკინგი საჩუქრად', field: 'headline', placement: null }],
    ['headline იყოს ახალი ბინა ვაკეში', { text: 'ახალი ბინა ვაკეში', field: 'headline', placement: null }],
    ['ფოტოზე ზემოთ ეწეროს ახალი ბინა ვაკეში', { text: 'ახალი ბინა ვაკეში', field: 'headline', placement: 'top' }],
    ['ღილაკზე ეწეროს მოგვწერეთ', { text: 'მოგვწერეთ', field: 'cta', placement: null }],
    ['Make it brighter. Write "New flats in Vake" at the top', { text: 'New flats in Vake', field: 'headline', placement: 'top' }],
    ['напиши сверху: Новая квартира', { text: 'Новая квартира', field: 'headline', placement: 'top' }],
  ];
  for (const [input, want] of cases) assert.deepEqual(parseOverlayIntent(input).overlay, want, input);
  assert.equal(parseOverlayIntent('Make it more premium').overlay, null, 'a look request is not a text request');
  assert.equal(parseOverlayIntent('უფრო ნათელი გახადე. ქვემოთ ეწეროს "ფასი შეთავაზებით"').visual, 'უფრო ნათელი გახადე.', 'only the look reaches the image model');
  // The dedicated field always wins, in the customer's exact characters.
  assert.deepEqual(parseOverlayIntent('ზემოთ', 'პარკინგით, ფასი მხოლოდ შეთავაზებით').overlay, { text: 'პარკინგით, ფასი მხოლოდ შეთავაზებით', field: 'headline', placement: 'top' });
  // Placement chooses every variation's layout; the wording lands in the text layer verbatim.
  assert.deepEqual(variationLayouts({ layout: 'OVERLAY_BOTTOM', safeArea: 'BOTTOM' }, 3, 'top'), ['EDITORIAL_TOP', 'EDITORIAL_TOP', 'EDITORIAL_TOP']);
  const spec = defaultComposeSpec({ concept: null, headline: 'x', width: 1024, height: 1536, overlay: { text: 'ფასი $160,000', field: 'offer', placement: 'top' } });
  assert.deepEqual([spec.layout, spec.copy.offer], ['EDITORIAL_TOP', 'ფასი $160,000']);
  const c = composeCreative(spec, M);
  assertSound(c, 'overlay intent');
  assert.equal(typesetText(c).offer, 'ფასი $160,000', 'exactly the requested characters');
  // Server: the wording is stored for the text layer; the image prompt only ever gets the remainder.
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.match(srv, /const intent = parseOverlayIntent\(body\.instruction, body\.overlayText\);\s*const ins = sanitizeInstruction\(intent\.visual\);/);
  assert.match(srv, /overlay: intent\.overlay/);
  const prompt = generationPrompt({ analysis: { subject: 'A flat' }, concept: { id: 'c1', title: 't', angle: 'a', visual: 'v', composition: 'c', cta: 'x', safeArea: 'TOP' }, ctx: {}, instruction: parseOverlayIntent('უფრო ნათელი. ზემოთ ეწეროს ახალი ბინა').visual, variation: 0 });
  assert.doesNotMatch(prompt, /ახალი ბინა/, 'the requested words never reach the image model');
});

test('closure UI: plain purpose, five steps, the original apart, View/Choose, the text field, no clipped actions', () => {
  const panel = read('src/components/metaAds/builder/CreativeAiPanel.tsx');
  for (const k of ['mm_cx_title', 'mm_cx_lead1', 'mm_cx_info_title', 'mm_cy_instruction', 'mm_cy_instruction_help', 'mm_cx_choose_title', 'mm_cx_original_sub', 'mm_cx_generate_cta', 'mm_cy_use', 'mm_cy_edit']) assert.ok(panel.includes(k), k);
  assert.match(panel, /const STEPS = \['instruction', 'generate', 'choose', 'final'\]/, 'text & layout is not a step');
  assert.doesNotMatch(panel, /data-mm-ai-overlay=""/, 'one instruction field');
  assert.match(panel, /<FinishedPreview source=\{\{ jobId: job\.id, index: im\.index \}\}/, 'the cards are the finished creatives');
  assert.match(panel, /const r = await aiUse\(job\.id, \[\{ index: i, role: picked\[i\] \?\? \('SECONDARY' as Role\) \}\]\);/, 'Use creates what the card shows — no required editor');
  assert.match(panel, /data-mm-ai-original="" data-selected/, 'the original is selectable and framed apart');
  assert.match(panel, /aiComposeSave\(creative\.id, specs\[k\]\)/, 'the original is composed into a NEW creative, never rewritten');
  const tr = read('src/i18n/translations.ts');
  for (const ka of ['HOMATCH AI კრეატივებისთვის', 'გააუმჯობესე არსებული ფოტო ან კრეატივი რეკლამისთვის.', 'აირჩიე საუკეთესო ვარიანტი', 'შენი ატვირთული ფოტო', 'ტექსტის იდეები', 'აირჩიე რა ეწეროს კრეატივზე და როგორ განთავსდეს ტექსტი.', '{{n}} ვარიანტის შექმნა · {{credits}} კრედიტი', 'ტექსტისა და განლაგების შეცვლა', 'მზა კრეატივი']) assert.ok(tr.includes(ka), ka);
  const copy = read('src/components/metaAds/builder/AiCopyPanel.tsx');
  assert.match(copy, /grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,10\.5rem\),1fr\)\)\]/, 'action columns as wide as the label needs');
  assert.match(copy, /h-auto min-h-11 justify-start gap-1\.5 whitespace-normal/, 'labels wrap instead of clipping');
  assert.doesNotMatch(copy, /grid grid-cols-2 gap-2/);
});

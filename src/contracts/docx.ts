// CONTRACT INTELLIGENCE — a real .docx, built in the browser.
//
// A Word document is a zip of a few XML parts. Building the minimum by hand
// keeps the export free (no server, no paid conversion) and exact: every
// paragraph is the contract's own text. The "with changes" variant uses
// Word's tracked-change markup (w:del / w:ins), so the counterparty sees
// precisely what was proposed and can accept or reject it in Word itself.

import { strToU8, zipSync } from 'fflate';
import type { Change } from './revisions';

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // XML 1.0 forbids most control characters; extracted PDFs sometimes carry them.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/**
 * The inside of a run for text that may hold line breaks. Each newline becomes
 * a real <w:br/>: inside a <w:t> a newline is just whitespace to Word, so an
 * edited clause written over several lines would otherwise collapse into one.
 */
export function runText(text: string, tag: 'w:t' | 'w:delText' = 'w:t'): string {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((part) => `<${tag} xml:space="preserve">${esc(part)}</${tag}>`)
    .join('<w:br/>');
}

const run = (text: string, bold = false, italic = false) => {
  const props = bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : '';
  return `<w:r>${props}${runText(text)}</w:r>`;
};

const para = (inner: string) => `<w:p>${inner}</w:p>`;

const STAMP = '2026-01-01T00:00:00Z';
let revId = 1;
const ins = (text: string, author: string) =>
  `<w:ins w:id="${revId++}" w:author="${esc(author)}" w:date="${STAMP}"><w:r>${runText(text)}</w:r></w:ins>`;
const del = (text: string, author: string) =>
  `<w:del w:id="${revId++}" w:author="${esc(author)}" w:date="${STAMP}"><w:r>${runText(text, 'w:delText')}</w:r></w:del>`;

/** Paragraph runs for `text`, with each change shown as a tracked deletion and insertion. */
function trackedParagraphs(original: string, changes: Change[], author: string, addedHeading: string): string[] {
  const inline = changes.filter((c) => c.before !== null) as (Change & { before: string })[];
  const located: { start: number; end: number; change: Change & { before: string } }[] = [];
  for (const c of inline) {
    const at = original.indexOf(c.before);
    if (at >= 0 && !located.some((l) => at < l.end && l.start < at + c.before.length)) located.push({ start: at, end: at + c.before.length, change: c });
  }
  located.sort((a, b) => a.start - b.start);
  // Build one long marked-up string per line, splitting plain text on newlines.
  const out: string[] = [];
  let current = '';
  const pushPlain = (s: string) => {
    const parts = s.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) { out.push(para(current)); current = ''; }
      if (p) current += run(p);
    });
  };
  let cursor = 0;
  for (const l of located) {
    pushPlain(original.slice(cursor, l.start));
    // Both sides keep their own line breaks (as w:br inside the tracked run).
    current += del(l.change.before, author) + ins(l.change.after, author);
    cursor = l.end;
  }
  pushPlain(original.slice(cursor));
  out.push(para(current));
  const added = changes.filter((c) => c.before === null);
  if (added.length) {
    out.push(para(''), para(ins(addedHeading, author)));
    added.forEach((a, i) => out.push(para(ins(`${i + 1}. ${a.after}`, author))));
  }
  return out;
}

function documentXml(bodyParagraphs: string[]): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + bodyParagraphs.join('')
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';
// Sylfaen ships with Windows and covers Georgian; other platforms substitute their own Georgian font.
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Sylfaen" w:hAnsi="Sylfaen" w:cs="Sylfaen" w:eastAsia="Sylfaen"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '</w:styles>';

/** A .docx of `text`: clean, or with every change marked as a tracked change. */
export function buildDocx(opts: {
  title: string;
  text: string;
  /** Notes printed under the title, in italics (e.g. the document was only partly reviewed). */
  notes?: string[];
  tracked?: { original: string; changes: Change[]; author: string; addedHeading: string };
}): Uint8Array {
  revId = 1;
  const heading = para(run(opts.title, true)) + (opts.notes ?? []).filter(Boolean).map((n) => para(run(n, false, true))).join('');
  const body = opts.tracked
    ? trackedParagraphs(opts.tracked.original, opts.tracked.changes, opts.tracked.author, opts.tracked.addedHeading)
    : opts.text.split('\n').map((line) => para(line ? run(line) : ''));
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(documentXml([heading, para(''), ...body])),
  });
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

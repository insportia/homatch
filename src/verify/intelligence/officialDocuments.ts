/*
 * THE OFFICIAL DOCUMENTS LIST — every TAS case and its files, with links a
 * buyer can open on the municipality's own public page.
 *
 * Ordered for reading: the two priority cases (newest first) at the top,
 * then the rest by case date, newest first. Bounded so a project with
 * hundreds of attachments cannot bloat the stored report; what was cut is
 * counted, never silently dropped. Public TAS references only — no hashes,
 * no storage paths, no personal data.
 */

import { readCaseSources, type CaseSource } from './tasCaseSources.ts';
import { tasAttachmentUrl } from './tasCaseSources.ts';

export type OfficialFileKind = 'PDF' | 'IMAGE' | 'DRAWING' | 'ARCHIVE' | 'OTHER';

export interface OfficialDocumentFile {
  fileName: string;
  format: string | null;
  kind: OfficialFileKind;
  outcome: string | null;
  pages: number | null;
  sourceUrl: string | null;
  date: string | null;
}

export interface OfficialDocument {
  caseRef: string | null;
  documentId: string | null;
  caseDate: string | null;
  title: string | null;
  status: string | null;
  priority: 1 | 2 | null;
  publicUrl: string | null;
  files: OfficialDocumentFile[];
  /** Files beyond the per-case bound, counted. */
  filesOmitted?: number;
}

const DRAWING_NAME = /ნახაზ|ჭრილ|გეგმ|ფასად|გენგეგმ|სიტუაციურ|ესკიზ|drawing|plan|section|elevation|facade|layout|site/iu;

export function fileKind(fileName: string | null, format: string | null): OfficialFileKind {
  const ext = (format ?? (fileName && /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]) ?? '').toLowerCase();
  if (/^(dwg|dxf|dwf|rvt|ifc|skp|pln)$/.test(ext)) return 'DRAWING';
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'ARCHIVE';
  if (/^(jpe?g|png|gif|bmp|tiff?|webp|heic)$/.test(ext)) return 'IMAGE';
  if (ext === 'pdf') return fileName && DRAWING_NAME.test(fileName) ? 'DRAWING' : 'PDF';
  return 'OTHER';
}

export function buildOfficialDocuments(reportOrCases: unknown, opts: { maxCases?: number; maxFilesPerCase?: number } = {}): OfficialDocument[] {
  const cases: CaseSource[] = Array.isArray(reportOrCases) ? (reportOrCases as CaseSource[]) : readCaseSources(reportOrCases);
  const maxCases = opts.maxCases ?? 60;
  const maxFiles = opts.maxFilesPerCase ?? 60;
  const docs = cases.map((c): OfficialDocument => {
    const all = c.attachments
      .filter((a) => a.fileName || a.attachedFileId)
      .map((a) => ({
        fileName: a.fileName ?? 'ფაილი',
        format: a.format,
        kind: fileKind(a.fileName, a.format),
        outcome: a.outcome,
        pages: a.pages,
        sourceUrl: tasAttachmentUrl(a.attachedFileId),
        date: a.date,
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return {
      caseRef: c.caseRef, documentId: c.documentId, caseDate: c.date, title: c.title ?? c.docType, status: c.status,
      priority: c.priority, publicUrl: c.publicUrl, files: all.slice(0, maxFiles),
      ...(all.length > maxFiles ? { filesOmitted: all.length - maxFiles } : {}),
    };
  });
  const prio = docs.filter((d) => d.priority).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const rest = docs.filter((d) => !d.priority).sort((a, b) => (b.caseDate ?? '').localeCompare(a.caseDate ?? ''));
  return [...prio, ...rest].slice(0, maxCases);
}

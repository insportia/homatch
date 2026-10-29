import { useSearchParams } from 'react-router-dom';
import { editionFor, type LegalDoc, type LegalEdition } from '@/lib/legal/operator';

/**
 * The edition of a legal document the reader asked for: `?version=2026-10-25`
 * opens that archived edition with the operator it named; no parameter, or a
 * version that never existed, is the current edition. See ARCHIVED_EDITIONS.
 */
export function useLegalEdition(doc: LegalDoc): LegalEdition & { archived: boolean } {
  const [params] = useSearchParams();
  const edition = editionFor(doc, params.get('version'));
  return { ...edition, archived: edition.supersededOn !== null };
}

/*
 * Every address the old matching screens used — bookmarks, notifications, e-mails, dashboard
 * links — now opens the one matching workspace. The legacy paid external discovery screens are
 * hidden (owner, 2026-10-24); their data stays in the database, untouched.
 *
 *   /property/:id/buyers/external, /buyers/opportunity/:key, /buyers/lead/:leadId → External Leads
 *   /property/:id/buyers/internal, /leads, /buyer/:key                           → Internal Matches
 */
import { Navigate, useLocation, useParams } from 'react-router-dom';

export type LegacyTarget = 'internal' | 'external';

export function legacyMatchingPath(propertyId: string, target: LegacyTarget, search = ''): string {
  const q = new URLSearchParams(search);
  const out = new URLSearchParams({ product: target });
  /* Only the workspace's own view survives; old campaign parameters (start, job, tab) do not. */
  if (q.get('view') === 'unlocked' || q.get('filter') === 'UNLOCKED') out.set('view', 'unlocked');
  return `/property/${encodeURIComponent(propertyId)}/matches?${out.toString()}`;
}

export default function LegacyMatchingRedirect({ target }: { target: LegacyTarget }) {
  const { id = '' } = useParams<{ id: string }>();
  const { search } = useLocation();
  return <Navigate to={legacyMatchingPath(id, target, search)} replace />;
}

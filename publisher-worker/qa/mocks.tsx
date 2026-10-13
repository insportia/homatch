import { PUBLISHING_STRINGS } from '../../scripts/publishing-i18n-data.mjs';
const w = () => window as any;
export function useLanguage() {
  const lang = w().fixture?.lang ?? 'en';
  const index = ['en', 'ka', 'ru', 'tr', 'ar', 'he'].indexOf(lang);
  return {
    lang,
    isRTL: ['ar', 'he'].includes(lang),
    t: (key: string, vars: Record<string, string | number> = {}) => {
      if (key === 'brand_name') return 'HOMATCH';
      let value =
        (PUBLISHING_STRINGS as Record<string, string[]>)[key]?.[index] ?? key;
      for (const [k, v] of Object.entries(vars))
        value = value.replaceAll(`{{${k}}}`, String(v));
      return value;
    },
  };
}
export function useAuth() {
  return { homatchUser: { id: 'fixture-owner', is_admin: true }, session: {} };
}
export async function listPortfolio() {
  return w().fixture.properties;
}
export const supabase = {
  functions: {
    invoke: async (_name: string, { body }: { body: any }) => {
      const fixture = w().fixture;
      w().requests ??= [];
      w().requests.push(body);
      if (fixture.unavailable)
        return { data: null, error: { message: 'fixture unavailable' } };
      if (body.action === 'snapshot')
        return { data: structuredClone(fixture.snapshot), error: null };
      if (body.action === 'save_selection')
        fixture.snapshot.selections = [
          { property_id: body.propertyId, portal_ids: body.portals },
        ];
      if (body.action === 'enqueue') {
        fixture.snapshot.jobs = body.portals.map((id: string) => ({
          id: `fixture-job-${id}`,
          portal_id: id,
          property_id: body.propertyId,
          operation: body.operation,
          state: 'running',
          phase: 'uploading',
          created_at: '2026-10-13T09:00:00Z',
          updated_at: '2026-10-13T09:00:00Z',
          submission_started: false,
        }));
      }
      if (body.action === 'cancel') {
        fixture.snapshot.jobs = fixture.snapshot.jobs.map((j: any) =>
          j.id === body.jobId ? { ...j, state: 'cancelled' } : j,
        );
      }
      return {
        data: { saved: true, changed: true, jobs: fixture.snapshot.jobs },
        error: null,
      };
    },
  },
};

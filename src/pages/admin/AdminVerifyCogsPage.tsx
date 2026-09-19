/*
 * Admin-only. What Verify costs Homatch, read from the existing metering.
 *
 * The panel does the work; this is the route it hangs on, kept separate for
 * the same reason AdminVoiceAiPage keeps TalkCostPanel separate — the cost
 * view is a component that could sit in a tab elsewhere later without being
 * rewritten.
 */
import AdminLayout from '@/components/layouts/AdminLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifyCostPanel } from '@/components/admin/VerifyCostPanel';

export default function AdminVerifyCogsPage() {
  const { t } = useLanguage();
  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">{t('vcogs_title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('vcogs_subtitle')}</p>
        </div>
        <VerifyCostPanel />
      </div>
    </AdminLayout>
  );
}

// What the server says about a Verify REPORT when the page could not read one:
// still being prepared, failed for good, or present but not loaded here.
// A narrow RLS read of the customer's own row; never the payload.
import { supabase } from '@/db/supabase';
import { reportDeliveryState } from '@/verify/reportDelivery';
import type { VerifyReportDeliveryView } from '@/components/verify/VerifyReportDelivery';

export async function readReportDeliveryView(jobId: string): Promise<VerifyReportDeliveryView> {
  try {
    const { data, error } = await supabase
      .from('research_jobs')
      .select('status,cancelled_at,synthesis_state,synthesis_attempts,completed_at')
      .eq('id', jobId)
      .maybeSingle();
    if (error || !data) return 'PREPARING';
    const d = reportDeliveryState(data as Record<string, any>);
    if (d === 'FAILED') return 'FAILED';
    // READY on the row but the read above failed: the report exists, loading it did not.
    if (d === 'DELIVERED') return 'LOAD_FAILED';
    return 'PREPARING';
  } catch {
    return 'PREPARING';
  }
}

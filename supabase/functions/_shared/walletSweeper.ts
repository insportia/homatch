// THE RESERVATION SWEEPER — gated, off until the owner turns it on.
//
// wallet_sweep_expired_reservations(p_limit) releases credit holds that outlived their
// expires_at while still RESERVED (a request killed before it could settle or release),
// through the ordinary wallet_release, and marks them EXPIRED. It existed but nothing
// called it, and it requires service_role, so a plain SQL cron cannot.
//
// Why it is safe for jobs that are still running (audit, 2026-10-18):
//   - holds are generous: 60 min (12 h for Verify); the longest real one lasted 31 min,
//     and none has ever closed after its expiry;
//   - the Find Buyers driver already plans around expiry (it stops a paused campaign 8
//     minutes before, and refuses to finish against a hold that is no longer RESERVED);
//   - a settle that arrives after a sweep gets wallet_settle's duplicate answer (the
//     release), so a late finish charges nothing; never twice. Both lock the row.
//
// It moves money, so it runs only while admin_settings.wallet_reservation_sweeper_enabled
// is 'true'. Default (absent): off — deploying this changes nothing.

// deno-lint-ignore no-explicit-any
type Sb = any;

export const SWEEPER_SETTING = 'wallet_reservation_sweeper_enabled';
/** At most this many holds per tick; a backlog drains over a few ticks. */
export const SWEEP_LIMIT = 50;

export async function sweepExpiredReservations(sb: Sb): Promise<{ enabled: boolean; released: number | null }> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', SWEEPER_SETTING).maybeSingle();
  const raw = data?.value;
  const enabled = raw === true || raw === 'true' || (typeof raw === 'string' && raw.replace(/"/g, '') === 'true');
  if (!enabled) return { enabled: false, released: null };
  const { data: released, error } = await sb.rpc('wallet_sweep_expired_reservations', { p_limit: SWEEP_LIMIT });
  if (error) throw new Error(`wallet_sweep_expired_reservations: ${error.message}`);
  return { enabled: true, released: Number(released ?? 0) };
}

/** A provider retry must reuse the paid turn, never purchase another answer. */
export async function claimPropertyTurn(db: any, input: { reservationId: string; userId: string; conversationId: string; searchId: string; propertyKey: string }) {
  const { data: reservation, error } = await db.from('usage_reservations')
    .select('id,status,job_ref,metadata').eq('id', input.reservationId).eq('user_id', input.userId).maybeSingle();
  if (error) throw error;
  if (!reservation || reservation.job_ref !== input.conversationId
    || reservation.metadata?.searchId !== input.searchId || reservation.metadata?.propertyKey !== input.propertyKey) return 'SCOPE_MISMATCH';
  if (reservation.status === 'SETTLED') return 'SETTLED';
  if (reservation.status !== 'RESERVED') return 'FAILED';
  if (reservation.metadata?.property_ai_started_at) return 'PENDING';
  // Conditional UPDATE is atomic: concurrent replays cannot both start providers.
  const { data: claimed, error: claimError } = await db.from('usage_reservations')
    .update({ metadata: { ...reservation.metadata, property_ai_started_at: new Date().toISOString() } })
    .eq('id', input.reservationId).eq('user_id', input.userId).eq('status', 'RESERVED')
    .is('metadata->property_ai_started_at', null).select('id').maybeSingle();
  if (claimError) throw claimError;
  return claimed ? 'STARTED' : 'PENDING';
}

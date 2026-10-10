/** Only explicit access evidence closes access. Clearance must be deliberate
 * and newer than the recorded failure; a parser error is not an access denial.
 */
export function myHomeRestricted(health: any, blocked: any): boolean {
  if (health?.accessRestricted === true) return true;
  if (!blocked) return false;
  const cleared = Date.parse(health?.accessClearedAt ?? '');
  const failed = Date.parse(blocked.created_at ?? '');
  if (Number.isFinite(cleared) && Number.isFinite(failed) && cleared > failed) return false;
  return Array.isArray(blocked.errors) && blocked.errors.some((error: any) =>
    error?.code === 'ACCESS_DENIED' || error?.code === 'ACCESS_RESTRICTED');
}

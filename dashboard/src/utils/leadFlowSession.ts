/**
 * Resolve the concrete session that owns a lead-flow mutation.
 *
 * The "all" selection is only a read scope. Existing flows must be updated in
 * their owning session; new flows keep the existing behaviour of using the
 * first available session.
 */
export function resolveLeadFlowSessionId(
  selectedSessionId: string,
  owningSessionId: string | null,
  firstSessionId?: string,
): string {
  if (owningSessionId) return owningSessionId;
  return selectedSessionId === 'all' ? firstSessionId || 'all' : selectedSessionId;
}

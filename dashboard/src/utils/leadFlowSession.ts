/** Resolve the selected account; All Sessions is read-only for new flows. */
export function resolveLeadFlowSessionId(
  selectedSessionId: string,
  owningSessionId: string | null,
  _firstSessionId?: string,
): string {
  if (owningSessionId && owningSessionId !== selectedSessionId)
    throw new Error('Select the account that owns this flow');
  if (!selectedSessionId || ['all', '*'].includes(selectedSessionId))
    throw new Error('Select a specific WhatsApp account before creating a lead flow');
  return selectedSessionId;
}

/** Aggregate only sessions returned by the authorized sessions endpoint. */
export async function loadLeadFlowScope<T>(
  selectedSessionId: string,
  sessionIds: readonly string[],
  load: (sessionId: string) => Promise<T[]>,
): Promise<T[]> {
  if (!selectedSessionId || ['all', '*'].includes(selectedSessionId) || !sessionIds.includes(selectedSessionId))
    return [];
  return load(selectedSessionId);
}

/** Only admins may select the aggregate view; other users stay within returned sessions. */
export function resolveSessionSelection(
  _role: string | null | undefined,
  selected: string,
  sessionIds: readonly string[],
): string {
  return sessionIds.includes(selected) && !['all', '*'].includes(selected) ? selected : '';
}

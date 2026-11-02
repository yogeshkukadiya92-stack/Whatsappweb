/** Resolve the selected account; All Sessions is read-only for new flows. */
export function resolveLeadFlowSessionId(
  selectedSessionId: string,
  owningSessionId: string | null,
  _firstSessionId?: string,
): string {
  if (owningSessionId) return owningSessionId;
  if (!selectedSessionId || selectedSessionId === 'all')
    throw new Error('Select a specific WhatsApp account before creating a lead flow');
  return selectedSessionId;
}

/** Aggregate only sessions returned by the authorized sessions endpoint. */
export async function loadLeadFlowScope<T>(
  selectedSessionId: string,
  sessionIds: readonly string[],
  load: (sessionId: string) => Promise<T[]>,
): Promise<T[]> {
  const targets = selectedSessionId === 'all' ? sessionIds : selectedSessionId ? [selectedSessionId] : [];
  return (await Promise.all(targets.map(id => load(id)))).flat();
}

/** Only admins may select the aggregate view; other users stay within returned sessions. */
export function resolveSessionSelection(
  role: string | null | undefined,
  selected: string,
  sessionIds: readonly string[],
): string {
  if (selected === 'all' && role === 'admin') return selected;
  if (selected !== 'all' && sessionIds.includes(selected)) return selected;
  return role === 'admin' && sessionIds.length ? 'all' : sessionIds[0] || '';
}

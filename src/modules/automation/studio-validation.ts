import { StudioDefinition, StudioStep } from './entities/studio-workflow.entity';
export interface StudioRoute {
  label: string;
  value: string;
  operator: string;
  expected: string;
  target: string;
}
export const STUDIO_OPERATORS = ['equals', 'not_equals', 'contains', 'not_empty', 'greater'];
const reserved = ['message', 'chatId', 'now', 'webhook', 'index', 'error', '__proto__', 'constructor', 'prototype'];
export function validStudioName(value: string): boolean {
  return /^[a-zA-Z][\w]*$/.test(value || '') && !reserved.includes(value);
}
export function parseStudioRoutes(step: StudioStep): StudioRoute[] {
  const parsed: unknown = JSON.parse(step.config.routes || '[]');
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) throw new Error('Add 1–8 router paths.');
  return parsed.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid router path.');
    const route = raw as Record<string, unknown>;
    if (
      ['label', 'value', 'operator', 'expected', 'target'].some(key => typeof route[key] !== 'string') ||
      !STUDIO_OPERATORS.includes(route.operator as string)
    )
      throw new Error('Configure every router condition and target.');
    return route as unknown as StudioRoute;
  });
}
export function validateStudioDefinition(d: StudioDefinition): void {
  if (!d.steps.length || d.steps.length > 20 || new Set(d.steps.map(s => s.id)).size !== d.steps.length)
    throw new Error('Use 1–20 uniquely identified steps.');
  const target = (id: string, index: number) => {
    if (id === 'end') return d.steps.length;
    const next = d.steps.findIndex(s => s.id === id);
    if (next <= index) throw new Error('Routes must point to a later step or End.');
    return next;
  };
  const ranges: { start: number; end: number }[] = [];
  d.steps.forEach((step, i) => {
    const c = step.config;
    if (Object.values(c).some(v => typeof v !== 'string' || v.length > 8000))
      throw new Error('Step configuration must contain text under 8000 characters.');
    if (c.next) target(c.next, i);
    if (c.onError && !['stop', 'continue', 'route'].includes(c.onError))
      throw new Error('Choose a valid error policy.');
    if (c.onError === 'route') target(c.errorTarget, i);
    if (step.type === 'variable' && (!validStudioName(c.name) || c.value === undefined))
      throw new Error('Choose a valid variable name and value.');
    if (step.type === 'filter' && (!c.value || !STUDIO_OPERATORS.includes(c.operator)))
      throw new Error('Configure the filter.');
    if (step.type === 'reply' && !c.text?.trim()) throw new Error('Configure the WhatsApp reply.');
    if (
      step.type === 'mcp' &&
      (!/^[\w-]{1,64}$/.test(c.connectionId || '') ||
        !c.tool?.trim() ||
        !c.arguments?.trim() ||
        !validStudioName(c.output))
    )
      throw new Error('Configure MCP connection, approved tool, JSON arguments and output.');
    if (
      step.type === 'website' &&
      (!c.url?.startsWith('https://') ||
        !validStudioName(c.output) ||
        !['auto', 'main', 'article', 'body'].includes(c.mode || 'auto') ||
        !/^\d+$/.test(c.maxChars || '20000') ||
        Number(c.maxChars || 20000) < 500 ||
        Number(c.maxChars || 20000) > 24000)
    )
      throw new Error('Configure HTTPS website, output name, region and text limit (500–24000).');
    if (step.type === 'ai') {
      if (
        !['summarize', 'answer', 'extract', 'translate'].includes(c.task) ||
        !c.input?.trim() ||
        !validStudioName(c.output) ||
        (c.instructions || '').length > 4000 ||
        /{{|}}/.test(c.instructions || '') ||
        !['auto', 'Gujarati', 'Hindi', 'English'].includes(c.language || 'auto')
      )
        throw new Error(
          'Configure AI task, input, output and language. Instructions must be static text under 4000 characters.',
        );
      if (c.task === 'answer' && !c.question?.trim()) throw new Error('Configure the question for the AI answer task.');
      if (c.task === 'extract') {
        const fields = (c.fields || '')
          .split(',')
          .map(field => field.trim())
          .filter(Boolean);
        if (
          !fields.length ||
          fields.length > 20 ||
          new Set(fields).size !== fields.length ||
          fields.some(field => !validStudioName(field))
        )
          throw new Error('Configure 1–20 unique AI extraction field names.');
      }
    }
    if (
      step.type === 'http' &&
      ((c.connectionId
        ? !/^[\w-]{1,64}$/.test(c.connectionId) || !c.path?.trim() || c.method !== 'GET'
        : !c.url?.startsWith('https://')) ||
        !['GET', 'POST'].includes(c.method) ||
        !validStudioName(c.output))
    )
      throw new Error('Use an HTTPS API URL, GET/POST and a valid output variable.');
    if (c.retries && (!/^\d+$/.test(c.retries) || Number(c.retries) > 3 || step.type !== 'http'))
      throw new Error('Only API requests support up to 3 retries.');
    if (
      c.backoffSeconds &&
      (!/^\d+$/.test(c.backoffSeconds) || Number(c.backoffSeconds) < 1 || Number(c.backoffSeconds) > 60)
    )
      throw new Error('Retry delay must be 1–60 seconds.');
    if (step.type === 'delay' && (!/^\d+$/.test(c.seconds) || Number(c.seconds) < 1 || Number(c.seconds) > 604800))
      throw new Error('Delay must be 1 second to 7 days.');
    if (step.type === 'router') {
      for (const route of parseStudioRoutes(step)) target(route.target, i);
      target(c.fallback || 'end', i);
    }
    if (step.type === 'iterator') {
      const end = target(c.end, i);
      if (end >= d.steps.length || d.steps[end].type !== 'aggregator' || !c.array || !validStudioName(c.alias))
        throw new Error('Iterator needs an array, item variable and a later aggregator.');
      ranges.push({ start: i, end });
    }
    if (step.type === 'aggregator' && (!validStudioName(c.output) || c.value === undefined))
      throw new Error('Configure aggregator output and item value.');
    if (step.type === 'google_calendar') {
      if (!c.summary?.trim() || !validStudioName(c.output))
        throw new Error('Configure Google Calendar event summary and a valid output variable.');
      if (c.action === 'create_event' && !c.startTime?.trim())
        throw new Error('Configure Google Calendar event start time.');
      if (
        c.durationMinutes &&
        (!/^\d+$/.test(c.durationMinutes) || Number(c.durationMinutes) < 5 || Number(c.durationMinutes) > 1440)
      )
        throw new Error('Meeting duration must be 5 to 1440 minutes.');
    }
  });
  if (d.steps.filter(s => s.type === 'http').length > 3) throw new Error('Maximum 3 API steps per workflow.');
  if (d.steps.filter(s => s.type === 'mcp').length > 3) throw new Error('Maximum 3 MCP steps per workflow.');
  if (d.steps.filter(s => s.type === 'website').length > 3 || d.steps.filter(s => s.type === 'ai').length > 3)
    throw new Error('Maximum 3 website and 3 AI steps per workflow.');
  if (d.steps.filter(s => s.type === 'google_calendar').length > 3)
    throw new Error('Maximum 3 Google Calendar steps per workflow.');
  for (const range of ranges) {
    if (
      ranges.some(
        other => other !== range && other.start < range.start && other.end >= range.start && other.end <= range.end,
      )
    )
      throw new Error('Iterator ranges must be nested or separate, with distinct aggregators.');
    for (let i = range.start + 1; i < range.end; i++) {
      const step = d.steps[i];
      const c = step.config;
      const targets = [
        c.next,
        c.onError === 'route' ? c.errorTarget : undefined,
        ...(step.type === 'router' ? [...parseStudioRoutes(step).map(r => r.target), c.fallback || 'end'] : []),
      ].filter(Boolean) as string[];
      if (targets.some(id => target(id, i) > range.end))
        throw new Error('Steps inside an iterator must continue within its body or to its aggregator.');
    }
    for (let i = 0; i < range.start; i++) {
      const step = d.steps[i];
      const c = step.config;
      const targets = [
        c.next,
        c.onError === 'route' ? c.errorTarget : undefined,
        ...(step.type === 'router' ? [...parseStudioRoutes(step).map(r => r.target), c.fallback || 'end'] : []),
      ].filter(Boolean) as string[];
      if (
        targets.some(id => {
          const at = target(id, i);
          return at > range.start && at <= range.end;
        })
      )
        throw new Error('Enter an iterator through its starting step, not its body.');
    }
  }
  for (const [i, s] of d.steps.entries())
    if (s.type === 'aggregator' && !ranges.some(r => r.end === i))
      throw new Error('Each aggregator must finish an iterator.');
  const trigger = d.trigger;
  if (trigger && trigger.type !== 'whatsapp') {
    if (!/^\d+@(c\.us|g\.us|lid)$/.test(trigger.chatId || ''))
      throw new Error('Choose a valid destination WhatsApp chat ID.');
    if (
      trigger.type === 'schedule' &&
      (!Number.isInteger(trigger.intervalMinutes) ||
        trigger.intervalMinutes! < 1 ||
        trigger.intervalMinutes! > 43200 ||
        (trigger.startAt && !Number.isFinite(Date.parse(trigger.startAt))))
    )
      throw new Error('Set a schedule interval from 1–43200 minutes and a valid start date.');
  }
  if (d.audience && !['all', 'direct', 'groups', 'specific_numbers', 'specific_groups'].includes(d.audience)) {
    throw new Error('Choose a valid reply audience.');
  }
  if (d.targetChats !== undefined) {
    if (!Array.isArray(d.targetChats) || d.targetChats.length > 50 || d.targetChats.some(t => typeof t !== 'string' || t.length > 200)) {
      throw new Error('Configure up to 50 target chats with valid identifiers.');
    }
  }
}

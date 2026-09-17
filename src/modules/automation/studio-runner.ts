import { withSafeFetch, redactSsrfError } from '../../common/security/ssrf-guard';
import { fetchStudioWebsite } from './studio-content';
import type { StudioAiRequest } from './studio-ai.service';
export type StudioAiGenerate = (request: StudioAiRequest) => Promise<unknown>;
import { StudioDefinition, StudioRunState, StudioTrace } from './entities/studio-workflow.entity';
import { parseStudioRoutes } from './studio-validation';

export function resolveStudioValue(path: string, values: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(values, path)) return values[path];
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      values,
    );
}
export function renderStudioText(text: string, values: Record<string, unknown>): string {
  if (text == null || typeof text !== 'string') return '';
  return text.replace(/{{\s*([\w.]+)\s*}}/g, (_match, path: string) => {
    const value = resolveStudioValue(path, values);
    if (value === undefined) throw new Error(`Variable "${path}" is not available. Check the mapping.`);
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    throw new Error(`Variable "${path}" has an unsupported value.`);
  });
}
export function matchesStudioTrigger(d: StudioDefinition, message: string, chatId: string): boolean {
  if (d.trigger && d.trigger.type !== 'whatsapp') return false;
  const group = chatId.endsWith('@g.us');
  if ((d.audience === 'groups' && !group) || (d.audience === 'direct' && group)) return false;
  if (d.audience === 'specific_groups') {
    if (!group) return false;
    const targets = (d.targetChats || []).map(t => t.trim().toLowerCase()).filter(Boolean);
    if (targets.length === 0) return false;
    const chatLower = chatId.toLowerCase();
    const chatDigits = chatLower.replace(/[^0-9]/g, '');
    const matched = targets.some(target => {
      if (chatLower === target) return true;
      const targetDigits = target.replace(/[^0-9]/g, '');
      if (targetDigits && (chatDigits === targetDigits || chatDigits.startsWith(targetDigits))) return true;
      return chatLower.includes(target);
    });
    if (!matched) return false;
  }
  if (d.audience === 'specific_numbers') {
    if (group) return false;
    const targets = (d.targetChats || []).map(t => t.trim().toLowerCase()).filter(Boolean);
    if (targets.length === 0) return false;
    const chatLower = chatId.toLowerCase();
    const chatDigits = chatLower.replace(/[^0-9]/g, '');
    const matched = targets.some(target => {
      if (chatLower === target) return true;
      const targetDigits = target.replace(/[^0-9]/g, '');
      if (targetDigits && (chatDigits === targetDigits || chatDigits.endsWith(targetDigits) || targetDigits.endsWith(chatDigits))) return true;
      return chatLower.includes(target);
    });
    if (!matched) return false;
  }
  const activeKeywords = (d.keywords || []).map(w => w.trim()).filter(Boolean);
  return (
    activeKeywords.length === 0 ||
    activeKeywords.some(word => message.toLowerCase().includes(word.toLowerCase()))
  );
}
export function createStudioState(message: string, chatId: string, webhook?: unknown): StudioRunState {
  return {
    cursor: 0,
    values: { message, chatId, now: new Date().toISOString(), ...(webhook === undefined ? {} : { webhook }) },
    trace: [],
    replies: [],
    loops: [],
    attempts: {},
    operations: 0,
  };
}
export function studioCondition(
  value: string,
  operator: string,
  expected: string,
  values: Record<string, unknown>,
): boolean {
  const actual = renderStudioText(value || '', values);
  const compare = renderStudioText(expected || '', values);
  return operator === 'equals'
    ? actual === compare
    : operator === 'not_equals'
      ? actual !== compare
      : operator === 'not_empty'
        ? !!actual.trim()
        : operator === 'greater'
          ? Number(actual) > Number(compare)
          : actual.toLowerCase().includes(compare.toLowerCase());
}
function safeError(error: unknown): string {
  const message = redactSsrfError(error);
  return error instanceof Error && !/https?:\/\//.test(message)
    ? message.slice(0, 200)
    : 'Step failed. Check the connection and mapping.';
}
async function fetchStudioApi(url: string, method: string, body?: string): Promise<unknown> {
  if (new URL(url).protocol !== 'https:') throw new Error('API requests require an HTTPS URL.');
  return withSafeFetch<unknown>(
    url,
    {
      method,
      body,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(10000),
    },
    async res => {
      if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
      const reader = res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader)
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 262144) throw new Error('API response exceeds 256 KB.');
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    },
  );
}
export type StudioAdvance = { status: 'running' | 'waiting' | 'success' | 'stopped' | 'failed'; waitMs?: number };
/** One checkpointable operation. No wall-clock sleep: durable worker persists waiting state. */
export async function advanceStudioState(
  d: StudioDefinition,
  state: StudioRunState,
  options: {
    send?: (text: string) => Promise<unknown>;
    beforeSend?: () => Promise<void>;
    test?: boolean;
    ai?: StudioAiGenerate;
    connection?: (id: string, path: string) => Promise<unknown>;
    mcp?: (id: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
  } = {},
): Promise<StudioAdvance> {
  const step = d.steps[state.cursor];
  if (!step) return { status: 'success' };
  const started = Date.now();
  const c = step.config;
  const append = (status: StudioTrace['status'], output: string) =>
    state.trace.push({ stepId: step.id, label: step.label, status, output, durationMs: Date.now() - started });
  const target = (id?: string) =>
    !id ? state.cursor + 1 : id === 'end' ? d.steps.length : d.steps.findIndex(s => s.id === id);
  if (state.sending) {
    state.sending = false;
    append('failed', 'Previous external action was interrupted. Delivery is uncertain; automatic replay stopped.');
    return { status: 'failed' };
  }
  if (++state.operations > 500 || JSON.stringify(state.values).length > 524288) {
    append('failed', 'Workflow exceeded its operation or data limit.');
    return { status: 'failed' };
  }
  if (
    (step.type === 'ai' && (state.aiCalls || 0) >= 10) ||
    (step.type === 'mcp' && (state.mcpCalls || 0) >= 10) ||
    (step.type === 'website' && (state.websiteCalls || 0) >= 10)
  ) {
    append('failed', 'Maximum 10 calls per AI, website or MCP category per run.');
    return { status: 'failed' };
  }
  try {
    let output = '';
    let next = target(c.next);
    if (step.type === 'variable') {
      state.values[c.name] = renderStudioText(c.value, state.values);
      output = `Variable ${c.name} set`;
    } else if (step.type === 'filter') {
      if (!studioCondition(c.value, c.operator, c.expected, state.values)) {
        append('stopped', 'Condition did not match; workflow stopped');
        return { status: 'stopped' };
      }
      output = 'Condition passed';
    } else if (step.type === 'router') {
      const route = parseStudioRoutes(step).find(r => studioCondition(r.value, r.operator, r.expected, state.values));
      next = target(route?.target || c.fallback || 'end');
      output = route ? `Path: ${route.label}` : 'Fallback path';
    } else if (step.type === 'delay') {
      state.cursor = next;
      append(
        options.test ? 'success' : 'waiting',
        options.test ? `Delay of ${c.seconds}s simulated in test mode` : `Waiting ${c.seconds}s`,
      );
      return {
        status: options.test ? (next >= d.steps.length ? 'success' : 'running') : 'waiting',
        waitMs: Number(c.seconds) * 1000,
      };
    } else if (step.type === 'iterator') {
      const items: unknown = JSON.parse(renderStudioText(c.array, state.values));
      if (!Array.isArray(items) || items.length > 100)
        throw new Error('Iterator requires an array of at most 100 items.');
      const end = d.steps.findIndex(s => s.id === c.end);
      if (end <= state.cursor || d.steps[end].type !== 'aggregator') throw new Error('Iterator aggregator is missing.');
      if (!items.length) {
        state.values[d.steps[end].config.output] = d.steps[end].config.format === 'json' ? [] : '';
        const after = d.steps[end].config.next;
        next = !after ? end + 1 : after === 'end' ? d.steps.length : d.steps.findIndex(s => s.id === after);
      } else {
        state.loops.push({
          start: state.cursor + 1,
          end,
          items: items as unknown[],
          index: 0,
          results: [],
          alias: c.alias,
          ...(state.values[c.alias] === undefined ? {} : { previousItem: state.values[c.alias] }),
        });
        state.values[c.alias] = items[0] as unknown;
        state.values.index = 0;
        next = state.cursor + 1;
      }
      output = `Iterating ${items.length} items`;
    } else if (step.type === 'aggregator') {
      const loop = state.loops[state.loops.length - 1];
      if (!loop || loop.end !== state.cursor) throw new Error('Aggregator was reached without its iterator.');
      loop.results.push(renderStudioText(c.value, state.values));
      if (++loop.index < loop.items.length) {
        state.values[loop.alias] = loop.items[loop.index];
        state.values.index = loop.index;
        next = loop.start;
      } else {
        state.values[c.output] =
          c.format === 'json'
            ? loop.results
            : loop.results.join(c.separator === '\\n' || c.separator === undefined ? '\n' : c.separator);
        state.loops.pop();
        if (loop.previousItem === undefined) delete state.values[loop.alias];
        else state.values[loop.alias] = loop.previousItem;
        const parent = state.loops[state.loops.length - 1];
        if (parent) state.values.index = parent.index;
        else delete state.values.index;
      }
      output = `Collected ${loop.results.length}/${loop.items.length} items`;
    } else if (step.type === 'website') {
      state.websiteCalls = (state.websiteCalls || 0) + 1;
      const website = await fetchStudioWebsite(
        renderStudioText(c.url, state.values),
        c.mode || 'auto',
        Number(c.maxChars || 20000),
      );
      state.values[c.output] = website;
      output = `Website text saved as ${c.output} · ${website.text.length} characters${website.truncated ? ' · truncated' : ''}`;
    } else if (step.type === 'ai') {
      state.aiCalls = (state.aiCalls || 0) + 1;
      if (!options.ai) throw new Error('AI service is unavailable. Configure session AI credentials first.');
      const request: StudioAiRequest = {
        task: c.task,
        instructions: c.instructions || '',
        input: renderStudioText(c.input, state.values),
        question: renderStudioText(c.question || '', state.values),
        language:
          c.language === 'auto' || !c.language ? 'the customer language (Gujarati, Hindi or English)' : c.language,
        fields: c.fields || '',
      };
      // Persist the external-action marker before a paid provider call. Recovery must not replay it blindly.
      if (options.beforeSend) {
        state.sending = true;
        await options.beforeSend();
      }
      state.values[c.output] = await options.ai(request);
      state.sending = false;
      output = `AI ${c.task} result saved as ${c.output}`;
    } else if (step.type === 'mcp') {
      state.mcpCalls = (state.mcpCalls || 0) + 1;
      if (!options.mcp) throw new Error('MCP service is unavailable.');
      let args: unknown;
      try {
        args = JSON.parse(c.arguments) as unknown;
      } catch {
        throw new Error('MCP arguments must be valid JSON.');
      }
      if (!args || typeof args !== 'object' || Array.isArray(args))
        throw new Error('MCP arguments must be a JSON object.');
      const interpolate = (value: unknown, depth = 0): unknown => {
        if (depth > 32) throw new Error('MCP arguments are too deeply nested.');
        if (typeof value === 'string') return renderStudioText(value, state.values);
        if (Array.isArray(value)) return (value as unknown[]).map(item => interpolate(item, depth + 1));
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolate(item, depth + 1)]),
          );
        return value;
      };
      args = interpolate(args);
      if (Buffer.byteLength(JSON.stringify(args)) > 16000) throw new Error('MCP arguments exceed 16 KB.');
      if (options.beforeSend) {
        state.sending = true;
        await options.beforeSend();
      }
      state.values[c.output] = await options.mcp(c.connectionId, c.tool, args as Record<string, unknown>);
      state.sending = false;
      output = `MCP result saved as ${c.output}`;
    } else if (step.type === 'http') {
      if (c.connectionId && (!options.connection || c.method !== 'GET'))
        throw new Error('Connected API supports read-only GET requests.');
      state.values[c.output || 'api'] = c.connectionId
        ? await options.connection!(c.connectionId, renderStudioText(c.path, state.values))
        : await fetchStudioApi(
            renderStudioText(c.url, state.values),
            c.method || 'GET',
            c.method === 'POST' ? renderStudioText(c.body || '{}', state.values) : undefined,
          );
      delete state.attempts[step.id];
      output = `Response saved as ${c.output || 'api'}`;
    } else if (step.type === 'reply') {
      const reply = renderStudioText(c.text, state.values);
      if (!reply.trim() || reply.length > 8000 || state.replies.length >= 100)
        throw new Error('Replies are limited to 100 messages of 1–8000 characters.');
      if (options.send) {
        state.sending = true;
        await options.beforeSend?.();
        await options.send(reply);
        state.sending = false;
      }
      state.replies.push(options.send ? 'sent' : reply);
      output = options.send ? 'WhatsApp reply sent' : reply;
    }
    if (JSON.stringify(state.values).length > 524288) {
      append('failed', 'Workflow data exceeds 512 KB.');
      return { status: 'failed' };
    }
    if (next < 0 || (next === state.cursor && step.type !== 'aggregator')) throw new Error('Invalid next step.');
    state.cursor = next;
    append('success', output);
    return { status: next >= d.steps.length ? 'success' : 'running' };
  } catch (error) {
    const message = safeError(error);
    state.sending = false;
    const attempts = state.attempts[step.id] || 0;
    if (step.type === 'http' && attempts < Number(c.retries || 0)) {
      state.attempts[step.id] = attempts + 1;
      append('retrying', `${message} · retry ${attempts + 1}/${c.retries}`);
      return { status: 'waiting', waitMs: Math.min(60000, Number(c.backoffSeconds || 2) * 1000 * 2 ** attempts) };
    }
    state.values.error = message;
    if (c.onError === 'continue' || c.onError === 'route') {
      append('continued', message);
      const next = target(c.onError === 'route' ? c.errorTarget : c.next);
      if (next <= state.cursor || next > d.steps.length) {
        append('failed', 'Invalid error target');
        return { status: 'failed' };
      }
      state.cursor = next;
      return { status: next >= d.steps.length ? 'success' : 'running' };
    }
    append('failed', message);
    return { status: 'failed' };
  }
}
export async function runStudioDefinition(
  d: StudioDefinition,
  message: string,
  chatId: string,
  send?: (text: string) => Promise<unknown>,
  webhook?: unknown,
  ai?: StudioAiGenerate,
  connection?: (id: string, path: string) => Promise<unknown>,
  mcp?: (id: string, tool: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const state = createStudioState(message, chatId, webhook);
  const started = Date.now();
  let result: StudioAdvance;
  do {
    result = await advanceStudioState(d, state, { send, test: true, ai, connection, mcp });
  } while (result.status === 'running' || result.status === 'waiting');
  return { status: result.status, trace: state.trace, replies: state.replies, durationMs: Date.now() - started };
}

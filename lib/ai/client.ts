import OpenAI from 'openai';
import type { ResponseOutputItem } from 'openai/resources/responses/responses';
import { createHash } from 'node:crypto';
import { traceable } from 'langsmith/traceable';
import { wrapOpenAI } from 'langsmith/wrappers/openai';
import { readSemanticRole } from './context.ts';
import { evaluatePaths } from '../evals/paths.ts';
import { recordPathEvaluation, type LivePathEvaluation } from '../evals/feedback.ts';
import { readSpecificityJudgment } from '../evals/judge.ts';
import { configuredModel, modelCachePolicy } from './model-policy.ts';

interface RequestBase {
  model: string;
  key: string;
  instructions: string;
  input: string;
  promptVersion: string;
  source?: 'application' | 'evaluation';
}
export type AIRequest = RequestBase & (
  | { operation: 'explain-file' | 'explain-folder'; allowedPaths: readonly string[] }
  | { operation: 'classify-file' | 'judge-specificity' }
);
export interface AICache {
  read: (key: string) => Promise<string | null>;
  write: (key: string, body: string) => Promise<string | void>;
}
export interface AIConnection {
  credential: () => Promise<string>;
  transport?: typeof fetch;
}
export interface AIResult { body: string; cached: boolean; tracing: boolean; evaluation?: LivePathEvaluation }

export function tracingConfigured(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY) && process.env.LANGSMITH_TRACING !== 'false';
}

export interface ResponsesReasoning { type: 'reasoning'; id: string; summary: { type: 'summary_text'; text: string }[]; encrypted_content?: string | null }
export type ResponsesInput =
  | ResponsesReasoning
  | { type: 'message'; role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'function_output'; callId: string; output: string };
export interface ResponsesTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ResponsesRoundRequest { model: string; instructions: string; input: ResponsesInput[]; tools?: ResponsesTool[]; toolChoice?: 'required' | 'auto' }
export type ResponsesRoundEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: string }
  | { type: 'reasoning'; item: ResponsesReasoning }
  | { type: 'completed' };
export type ResponsesRoundTransport = (request: ResponsesRoundRequest, signal?: AbortSignal) => AsyncIterable<ResponsesRoundEvent>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unexpected input field.');
}
function text(value: unknown, max = 1_000_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text field.');
  return value;
}
export function readResponsesRoundRequest(value: unknown): ResponsesRoundRequest {
  const request = object(value);
  if (Object.keys(request).some(key => !['model', 'instructions', 'input', 'tools', 'toolChoice'].includes(key))) throw new Error('Unexpected round field.');
  const model = configuredModel(text(request.model, 200));
  if (!model) throw new Error('Invalid model.');
  if (!Array.isArray(request.input) || request.input.length > 2000) throw new Error('Invalid round input.');
  const input: ResponsesInput[] = request.input.map((raw: unknown) => {
    const item = object(raw);
    onlyKeys(item, item.type === 'message' ? ['type','role','content'] : item.type === 'function_call' ? ['type','callId','name','arguments'] : item.type === 'function_output' ? ['type','callId','output'] : ['type','id','summary','encrypted_content']);
    if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) return { type: 'message', role: item.role, content: text(item.content) };
    if (item.type === 'function_call') return { type: 'function_call', callId: text(item.callId, 200), name: text(item.name, 200), arguments: text(item.arguments) };
    if (item.type === 'function_output') return { type: 'function_output', callId: text(item.callId, 200), output: text(item.output) };
    if (item.type === 'reasoning' && Array.isArray(item.summary)) {
      const encrypted = item.encrypted_content;
      if (encrypted !== undefined && encrypted !== null && typeof encrypted !== 'string') throw new Error('Invalid encrypted reasoning.');
      return { type: 'reasoning', id: text(item.id, 200), summary: item.summary.map((raw: unknown) => {
        const part = object(raw);
        if (part.type !== 'summary_text') throw new Error('Invalid reasoning summary.');
        return { type: 'summary_text', text: text(part.text) };
      }), encrypted_content: encrypted };
    }
    throw new Error('Invalid round input type.');
  });
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 6)) throw new Error('Invalid tools.');
  const tools = request.tools === undefined ? undefined : (request.tools as unknown[]).map(raw => {
    const tool = object(raw);
    onlyKeys(tool, ['name','description','parameters']);
    return { name: text(tool.name, 200), description: text(tool.description, 10000), parameters: object(tool.parameters) };
  });
  const toolChoice = request.toolChoice;
  if (toolChoice !== undefined && toolChoice !== 'auto' && toolChoice !== 'required') throw new Error('Invalid tool choice.');
  const result: ResponsesRoundRequest = { model, instructions: text(request.instructions, 100000), input, ...(tools ? { tools } : {}), ...(toolChoice ? { toolChoice } : {}) };
  if (JSON.stringify(result).length > 4_000_000) throw new Error('Round input is too large.');
  return result;
}

export async function* streamResponsesRound(request: ResponsesRoundRequest, connection: AIConnection, signal?: AbortSignal, cache?: AICache): AsyncGenerator<ResponsesRoundEvent> {
  const policy = modelCachePolicy(request.model);
  const key = createHash('sha256').update(JSON.stringify({ version: 2, revision: policy.identity, request })).digest('hex');
  const run = traceable(async function* ({ request }: { request: ResponsesRoundRequest }): AsyncGenerator<ResponsesRoundEvent> {
    signal?.throwIfAborted();
    const cached = cache ? await cache.read(key) : null;
    if (cached !== null) {
      const events: unknown = JSON.parse(cached);
      if (!Array.isArray(events) || events.length === 0 || events[events.length - 1]?.type !== 'completed') throw new Error('Invalid cached Responses round.');
      for (const event of events) yield readResponsesRoundEvent(event);
      return;
    }
    const events: ResponsesRoundEvent[] = [];
    for await (const event of responsesRound(request, connection, signal)) { events.push(event); yield event; }
    if (cache) await cache.write(key, JSON.stringify(events));
  }, { name: 'agent-responses-round', tracingEnabled: tracingConfigured(), metadata: { model: request.model, modelRevision: policy.revision, cacheKey: key } });
  yield* run({ request });
}

export function readResponsesRoundEvent(value: unknown): ResponsesRoundEvent {
  const event = object(value);
  if (event.type === 'completed') return { type: 'completed' };
  if (event.type === 'text_delta') return { type: 'text_delta', text: text(event.text) };
  if (event.type === 'tool_call') return { type: 'tool_call', callId: text(event.callId, 200), name: text(event.name, 200), arguments: text(event.arguments) };
  if (event.type === 'reasoning') {
    const request = readResponsesRoundRequest({ model: 'validated', instructions: '', input: [event.item] });
    const item = request.input[0];
    if (item.type === 'reasoning') return { type: 'reasoning', item };
  }
  throw new Error('Invalid round event.');
}

async function* responsesRound(request: ResponsesRoundRequest, connection: AIConnection, signal?: AbortSignal): AsyncGenerator<ResponsesRoundEvent> {
  if (!configuredModel(request.model)) throw new Error('Configure a model from the connected account catalog.');
  signal?.throwIfAborted();
  const client = wrapOpenAI(new OpenAI({
    apiKey: await connection.credential(), baseURL: 'https://api.openai.com/v1',
    maxRetries: 0, timeout: 60_000, fetch: connection.transport,
  }), { tracingEnabled: tracingConfigured() });
  const stream = await client.responses.create({
    model: request.model, instructions: request.instructions,
    input: request.input.map(item => item.type === 'reasoning' ? item : item.type === 'message' ? { role: item.role, content: item.content } :
      item.type === 'function_call' ? { type: 'function_call', call_id: item.callId, name: item.name, arguments: item.arguments } :
        { type: 'function_call_output', call_id: item.callId, output: item.output }),
    ...(request.tools?.length ? { tools: request.tools.map(tool => ({ type: 'function' as const, ...tool, strict: false })) } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
    ...(request.tools?.length ? { include: ['reasoning.encrypted_content' as const] } : {}),
    store: false, stream: true,
  }, { signal });
  let completed = false;
  const items = new Map<number, ResponsesRoundEvent>();
  const calls = new Map<string, { index: number; callId: string; name: string }>();
  const finalItems = new Set<number>();
  function collect(item: ResponseOutputItem, index: number): void {
    if (item.type === 'reasoning') items.set(index, { type: 'reasoning', item: { type: 'reasoning', id: item.id, summary: item.summary, encrypted_content: item.encrypted_content } });
    if (item.type === 'function_call') {
      if (!item.call_id || !item.name) throw new Error('Invalid function call identity.');
      items.set(index, { type: 'tool_call', callId: item.call_id, name: item.name, arguments: item.arguments });
    }
  }
  try {
    for await (const event of stream) {
      signal?.throwIfAborted();
      if (event.type === 'response.output_text.delta') yield { type: 'text_delta', text: event.delta };
      if (event.type === 'response.output_item.added' && event.item.type === 'function_call' && event.item.id) {
        calls.set(event.item.id, { index: event.output_index, callId: event.item.call_id, name: event.item.name });
      }
      if (event.type === 'response.function_call_arguments.done') {
        const call = calls.get(event.item_id);
        if (call && !finalItems.has(call.index)) items.set(call.index, { type: 'tool_call', callId: call.callId, name: call.name, arguments: event.arguments });
      }
      if (event.type === 'response.output_item.done') {
        collect(event.item, event.output_index);
        finalItems.add(event.output_index);
      }
      if (event.type === 'response.completed') {
        // SIWC can complete with output:[] even though item.done carried real
        // tool calls. Preserve those final items; regular Responses snapshots
        // supply a canonical fallback, deduplicated by call/reasoning identity.
        for (const [index, item] of (event.response.output ?? []).entries()) collect(item, index);
        if (request.toolChoice === 'required' && ![...items.values()].some(item => item.type === 'tool_call')) throw new Error('The answer requires a graph lookup for this question.');
        const emitted = new Set<string>();
        for (const [, item] of [...items].sort(([left], [right]) => left - right)) {
          const id = item.type === 'tool_call' ? `call:${item.callId}` : item.type === 'reasoning' ? `reasoning:${item.item.id}` : '';
          if (!id || emitted.has(id)) continue;
          emitted.add(id);
          yield item;
        }
        completed = true;
        yield { type: 'completed' };
      }
      if (event.type === 'response.failed') throw new Error(`AI request failed (${event.response.error?.code ?? 'unknown'}).`);
      if (event.type === 'response.incomplete') throw new Error('AI response was incomplete.');
      if (event.type === 'error') throw new Error(`AI stream failed (${event.code ?? 'unknown'}).`);
    }
    if (!completed) throw new Error('AI stream ended without a completed response.');
  } finally { stream.controller.abort(); }
}

export async function runAI(request: AIRequest, cache: AICache, connection: AIConnection): Promise<AIResult> {
  const policy = modelCachePolicy(request.model);
  const tracing = tracingConfigured();
  const run = traceable(async ({ request }: { request: AIRequest }): Promise<AIResult> => {
    const validate = (body: string) => request.operation === 'classify-file' ? readSemanticRole(body) :
      request.operation === 'judge-specificity' ? JSON.stringify(readSpecificityJudgment(body)) : body;
    const finish = async (body: string, cached: boolean): Promise<AIResult> => {
      body = validate(body);
      const evaluation = request.operation === 'explain-file' || request.operation === 'explain-folder'
        ? await recordPathEvaluation(evaluatePaths(body, request.allowedPaths), tracing) : undefined;
      return { body, cached, tracing, ...(evaluation ? { evaluation } : {}) };
    };
    const cached = await cache.read(request.key);
    if (cached !== null) return finish(cached, true);
    let body = '';
    for await (const event of responsesRound({ model: request.model, instructions: request.instructions,
      input: [{ type: 'message', role: 'user', content: request.input }] }, connection)) {
      if (event.type === 'text_delta') body += event.text;
      if (event.type === 'tool_call') throw new Error('Unexpected tool call in a text request.');
    }
    if (!body.trim()) throw new Error('AI response was empty.');
    body = validate(body);
    const canonical = await cache.write(request.key, body);
    return finish(canonical ?? body, false);
  }, { name: request.operation, tracingEnabled: tracing, metadata: {
    model: request.model, modelRevision: policy.revision, cacheExpiresAt: policy.expiresAt, cacheKey: request.key, promptVersion: request.promptVersion,
    source: request.source ?? 'application', evidenceVersion: 1,
  } });
  return run({ request });
}

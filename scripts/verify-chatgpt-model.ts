import assert from 'node:assert/strict';
import { CartographChatModel } from '../cartograph-agent/chatgpt-model.ts';
import { HumanMessage, SystemMessage, ToolMessage } from '../cartograph-agent/node_modules/@langchain/core/messages.js';
import { streamResponsesRound, readResponsesRoundRequest, type ResponsesRoundRequest, type ResponsesRoundEvent } from '../lib/ai/client.ts';
import { modelCachePolicy, configuredModel } from '../lib/ai/model-policy.ts';

process.env.LANGSMITH_TRACING = 'false';
assert.equal(configuredModel('gpt-5.6-sol'), 'gpt-5.6-sol');
assert.equal(configuredModel('bad model'), null);
assert.equal(modelCachePolicy('gpt-5.6-sol', 1).expiresAt, 86_400_000);
assert.notEqual(modelCachePolicy('gpt-5.6-sol', 1).identity, modelCachePolicy('gpt-5.6-sol', 86_400_000).identity);
assert.equal(modelCachePolicy('model-2026-09-01', 1).identity, modelCachePolicy('model-2026-09-01', 86_400_000).identity);
assert.throws(() => readResponsesRoundRequest({ model: 'gpt-5.6-sol', instructions: '', input: [], secret: 'no' }));
let calls = 0;
let credentials = 0;
const payloads: Record<string, unknown>[] = [];
const transport: typeof fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.openai.com/v1/responses');
  const payload: Record<string, unknown> = JSON.parse(String(init?.body));
  payloads.push(payload);
  assert.equal(payload.store, false);
  assert.equal(payload.stream, true);
  calls++;
  const output = calls === 1 ? [
    { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque-reasoning' },
    { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'summary', arguments: '{}' },
  ] : [];
  const events: Record<string, unknown>[] = calls === 1 ? [] : [{ type: 'response.output_text.delta', delta: 'Repository facts.' }];
  events.push({ type: 'response.completed', response: { id: 'response1', output, status: 'completed', model: 'gpt-5.6-sol' } });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
};
const connection = { credential: async () => { credentials++; return 'synthetic-secret'; }, transport };
const values = new Map<string, string>();
const cache = { read: async (key: string) => values.get(key) ?? null, write: async (key: string, body: string) => { values.set(key, body); } };
const round = (request: ResponsesRoundRequest, signal?: AbortSignal) => streamResponsesRound(readResponsesRoundRequest(request), connection, signal, cache);
const model = new CartographChatModel({ model: 'gpt-5.6-sol', round });
const bound = model.bindTools([{ type: 'function', function: { name: 'summary', description: 'Facts', parameters: { type: 'object', properties: {} } } }]);
const original = [new SystemMessage('Use graph facts.'), new HumanMessage('Explain')];
const first = await bound.invoke(original);
assert.equal(first.tool_calls?.[0].id, 'call1');
assert.equal(first.tool_calls?.[0].name, 'summary');
assert.deepEqual(first.tool_calls?.[0].args, {});
assert.equal(calls, 1);
const hit = await bound.invoke(original);
assert.equal(hit.tool_calls?.[0].id, 'call1');
assert.equal(calls, 1);
assert.equal(credentials, 1);
const chunks = [];
for await (const chunk of await bound.stream([...original, first, new ToolMessage({ content: 'real facts', tool_call_id: 'call1' })])) chunks.push(chunk);
assert.equal(chunks.map(chunk => chunk.content).join(''), 'Repository facts.');
assert.equal(calls, 2);
assert.equal(payloads[0].tool_choice, 'required');
assert.equal(payloads[1].tool_choice, 'auto');
assert.deepEqual(payloads[1].input, [
  { role: 'user', content: 'Explain' },
  { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque-reasoning' },
  { type: 'function_call', call_id: 'call1', name: 'summary', arguments: '{}' },
  { type: 'function_call_output', call_id: 'call1', output: 'real facts' },
]);
assert.deepEqual(payloads[0].tools, [{ type: 'function', name: 'summary', description: 'Facts', parameters: { type: 'object', properties: {} }, strict: false }]);
assert.ok(!JSON.stringify(model.toJSON()).includes('synthetic-secret'));
assert.ok(!JSON.stringify(model.toJSON()).includes('round'));
await assert.rejects(bound.invoke([new ToolMessage({ content: 'bad', tool_call_id: 'missing' })]), /original function call/);
const malformed = new CartographChatModel({ model: 'gpt-5.6-sol', round: async function* () { yield { type: 'tool_call', name: 'summary', callId: 'bad', arguments: '[]' }; yield { type: 'completed' }; } });
await assert.rejects(malformed.invoke(original), /arguments must be an object/);
const incomplete = new CartographChatModel({ model: 'gpt-5.6-sol', round: async function* (): AsyncGenerator<ResponsesRoundEvent> { yield { type: 'text_delta', text: 'partial' }; } });
await assert.rejects(incomplete.invoke(original), /without completion/);
const controller = new AbortController(); controller.abort();
await assert.rejects(bound.invoke(original, { signal: controller.signal }));
assert.equal(calls, 2);
const traceEndpoint = 'https://synthetic-round-traces.invalid';
const traceBodies: unknown[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(`${traceEndpoint}/`)) throw new Error('Non-synthetic trace request denied.');
  if (init?.body) traceBodies.push(JSON.parse(await new Response(init.body).text()));
  return Response.json({});
};
process.env.LANGSMITH_TRACING = 'true';
process.env.LANGSMITH_API_KEY = 'synthetic-tracing-key';
const { Client } = await import('langsmith');
const { RunTree } = await import('langsmith/run_trees');
const { withRunTree } = await import('langsmith/traceable');
const traceClient = new Client({ apiUrl: traceEndpoint, apiKey: 'synthetic-tracing-key', fetchImplementation: globalThis.fetch, autoBatchTracing: false, callerOptions: { maxRetries: 0 } });
const traceRequest: ResponsesRoundRequest = { model: 'gpt-5.6-sol', instructions: 'Only facts', input: [{ type: 'message', role: 'user', content: 'trace round' }] };
try {
  for (let iteration = 0; iteration < 2; iteration++) {
    const tree = new RunTree({ name: 'synthetic-round-root', client: traceClient, tracingEnabled: true });
    await tree.postRun();
    await withRunTree(tree, async () => { for await (const event of streamResponsesRound(traceRequest, connection, undefined, cache)) assert.ok(event.type); });
    await tree.end(); await tree.patchRun(); await traceClient.awaitPendingTraceBatches();
  }
  const serialized = JSON.stringify(traceBodies);
  assert.ok(serialized.includes('agent-responses-round'));
  assert.ok(serialized.includes('trace round'));
  assert.ok(!serialized.includes('synthetic-secret'));
  assert.ok(!serialized.includes('synthetic-tracing-key'));
  assert.equal(calls, 3);
  assert.equal(credentials, 3);
} finally { globalThis.fetch = originalFetch; process.env.LANGSMITH_TRACING = 'false'; }
console.log('Actual wrapped SDK supports catalog aliases, cached traced tool rounds, reasoning/call replay, streamed text, cancellation, validation, and credential-free traces/model serialization.');

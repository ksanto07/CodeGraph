import assert from 'node:assert/strict';
import { streamResponsesRound, type ResponsesRoundEvent } from '../lib/ai/client.ts';
process.env.LANGSMITH_TRACING = 'false';
const names = ['search_files', 'files_by_role', 'routes', 'analysis_summary'];
const reasoning = { type: 'reasoning', id: 'reasoning1', summary: [], encrypted_content: 'synthetic-encrypted' };
const calls = names.map((name, index) => ({ type: 'function_call', id: `item${index}`, call_id: `call${index}`, name, arguments: '{}' }));
const request = { model: 'gpt-5.6-sol', instructions: 'Facts', input: [{ type: 'message' as const, role: 'user' as const, content: 'Question' }],
  tools: names.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } })), toolChoice: 'required' as const };
async function invoke(events: Record<string, unknown>[]) {
  let writes = 0;
  const result: ResponsesRoundEvent[] = [];
  const connection = { credential: async () => 'synthetic-credential', transport: (async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload: Record<string, unknown> = JSON.parse(String(init?.body));
    assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
    assert.equal(payload.tool_choice, 'required');
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }) satisfies typeof fetch };
  const cache = { read: async () => null, write: async () => { writes++; } };
  for await (const event of streamResponsesRound(request, connection, undefined, cache)) result.push(event);
  assert.equal(writes, 1);
  return result;
}
// Real SIWC diagnostic captured this sequence: reasoning item.done, four
// function argument/item.done pairs, then completed with an empty output array.
const doneEvents: Record<string, unknown>[] = [
  { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: null } },
  { type: 'response.output_item.done', output_index: 0, item: reasoning },
  ...calls.flatMap((item, index) => [
    { type: 'response.output_item.added', output_index: index + 1, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: index + 1, item_id: item.id, delta: '{}' },
    { type: 'response.function_call_arguments.done', output_index: index + 1, item_id: item.id, arguments: '{}' },
    { type: 'response.output_item.done', output_index: index + 1, item },
  ]),
];
const empty = await invoke([...doneEvents, { type: 'response.completed', response: { output: [] } }]);
assert.deepEqual(empty.filter(event => event.type === 'tool_call').map(event => event.name), names);
assert.equal(empty.filter(event => event.type === 'reasoning').length, 1);
assert.equal(empty.at(-1)?.type, 'completed');
const repeated = await invoke([...doneEvents, { type: 'response.completed', response: { output: [reasoning, ...calls] } }]);
assert.deepEqual(repeated, empty);
const snapshot = await invoke([{ type: 'response.completed', response: { output: [reasoning, ...calls] } }]);
assert.deepEqual(snapshot, empty);
const argumentFallback = await invoke([
  { type: 'response.output_item.added', output_index: 0, item: { ...calls[0], arguments: '' } },
  { type: 'response.function_call_arguments.done', output_index: 0, item_id: calls[0].id, arguments: '{}' },
  { type: 'response.completed', response: { output: [] } },
]);
assert.deepEqual(argumentFallback, [{ type: 'tool_call', callId: 'call0', name: 'search_files', arguments: '{}' }, { type: 'completed' }]);
console.log('Captured SIWC item.done/empty-completed shape retains all real calls and reasoning; snapshots deduplicate and arguments.done needs original identity.');

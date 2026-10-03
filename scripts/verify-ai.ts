import assert from 'node:assert/strict';
import { explanationContext, explanationKey, readSemanticRole } from '../lib/ai/context.ts';
import { runAI, type AIRequest } from '../lib/ai/client.ts';
import type { FileNode } from '../lib/parser/types.ts';
import { explanationProse, repositoryPathParts } from '../lib/ai/prose.ts';

process.env.LANGSMITH_TRACING = 'false';
const file = (id: string): FileNode => ({ id, folder: 'src', sha256: id, lines: 1, moduleKind: 'module', fanIn: 0, fanOut: 0, annotations: {} });
const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map(file);
const edges = [{ from: 'src/a.ts', to: 'src/b.ts', kind: 'import' as const }, { from: 'src/c.ts', to: 'src/a.ts', kind: 'require' as const }];
const context = explanationContext(files, edges, { kind: 'file', id: 'src/a.ts' });
assert.deepEqual(context.incoming.map(file => file.id), ['src/c.ts']);
assert.deepEqual(context.outgoing.map(file => file.id), ['src/b.ts']);
assert.equal(explanationKey(context, 'model-2026-09-01', 'v1'), explanationKey(explanationContext([...files].reverse(), [...edges].reverse(), context.target), 'model-2026-09-01', 'v1'));
assert.notEqual(explanationKey(context, 'model-2026-09-01', 'v1'), explanationKey({ ...context, outgoing: [file('src/changed.ts')] }, 'model-2026-09-01', 'v1'));
assert.equal(readSemanticRole('util'), 'util');
assert.throws(() => readSemanticRole('controller'));
const request: AIRequest = { operation: 'explain-file', model: 'model-2026-09-01', key: 'context', instructions: 'Explain the facts.', input: JSON.stringify(context) };
const values = new Map<string, string>();
const cache = { read: async (key: string) => values.get(key) ?? null, write: async (key: string, body: string) => { values.set(key, body); } };
let requests = 0;
let credentials = 0;
const connection = {
  credential: async () => { credentials++; return 'synthetic-test-credential'; },
  transport: async (url: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.store, false);
    assert.equal(payload.stream, true);
    assert(Array.isArray(payload.input));
    const events = [{ type: 'response.output_text.delta', delta: 'Grounded explanation.' }, { type: 'response.completed', response: { id: 'test', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  },
};
assert.equal((await runAI(request, cache, connection)).cached, false);
assert.equal((await runAI(request, cache, connection)).cached, true);
assert.equal(requests, 1);
assert.equal(credentials, 1);
const winner = await runAI({ ...request, key: 'race' }, {
  read: async () => null,
  write: async () => 'Previously committed explanation.',
}, connection);
assert.equal(winner.body, 'Previously committed explanation.');
const interrupted = { ...connection, transport: async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) };
await assert.rejects(runAI({ ...request, key: 'interrupted' }, cache, interrupted), /without a completed response/);
assert(!values.has('interrupted'));
await assert.rejects(runAI({ ...request, key: 'structural-role', operation: 'classify-file' }, cache, connection), /unsupported semantic role/);
assert(!values.has('structural-role'));
assert.equal(explanationContext(files, edges, { kind: 'folder', id: 'src' }).members.length, 3);
const prose = explanationProse('### Context\n\nThe **service** uses `src/a.ts`.\n- Calls src/b.ts\n- [unknown](https://example.com)');
assert.equal(prose[0].kind, 'paragraph');
assert.equal(prose[2].kind, 'list');
assert(!JSON.stringify(prose).includes('###'));
assert.deepEqual(repositoryPathParts('src/a.ts. src/a.ts.bak unknown.ts', ['src/a.ts']), [{ text: 'src/a.ts', path: 'src/a.ts' }, { text: '. src/a.ts.bak unknown.ts' }]);
console.log('AI context includes every real neighbor; cache hits skip inference; interrupted streams never cache.');

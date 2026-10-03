import assert from 'node:assert/strict';
import { ChatProjection, nativeRunLocation, readServerEvents } from '../lib/agent/stream.ts';
import { readLimitedJSON } from '../lib/agent/http.ts';

const frames = [
  { event: 'metadata', data: { secret: 'private-context', thread_id: 'private-thread' } },
  { event: 'messages/complete', data: [{ type: 'human', content: 'question' }] },
  { event: 'messages/partial', data: [{ type: 'ai', id: 'lookup', content: '', tool_calls: [{ id: 'call-1', name: 'analysis_summary' }] }] },
  { event: 'messages/complete', data: [{ type: 'ai', id: 'lookup', content: '', tool_calls: [{ id: 'call-1', name: 'analysis_summary' }] }] },
  { event: 'custom', data: { type: 'tool', name: 'analysis_summary', status: 'running' } },
  { event: 'custom', data: { type: 'tool', name: 'analysis_summary', status: 'done' } },
  { event: 'messages/partial', data: [{ type: 'ai', id: 'answer', content: 'Graph ' }] },
  { event: 'messages/partial', data: [{ type: 'ai', id: 'answer', content: 'Graph facts ✓' }] },
  { event: 'messages/complete', data: [{ type: 'ai', id: 'answer', content: 'Graph facts ✓' }] },
];
const bytes = new TextEncoder().encode(frames.map(frame => `event: ${frame.event}\r\ndata: ${JSON.stringify(frame.data)}\r\n\r\n`).join(''));
const source = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
const projection = new ChatProjection();
const projected = [];
for await (const event of readServerEvents(source)) projected.push(...projection.accept(event));
assert.equal(projected.filter(event => event.type === 'text').map(event => event.text).join(''), 'Graph facts ✓');
assert.equal(projection.evidence, true);
const thread = '00000000-0000-4000-8000-000000000001';
const run = '00000000-0000-4000-8000-000000000002';
const location = `/threads/${thread}/runs/${run}`;
const completion = { run_id: run, thread_id: thread, status: 'success' };
assert.deepEqual(nativeRunLocation(location, 'http://127.0.0.1:2024', thread), { url: `http://127.0.0.1:2024${location}`, run });
assert.deepEqual(projection.complete(completion, run, thread), { type: 'done' });
for (const status of ['pending', 'running', 'error', 'interrupted', undefined]) {
  assert.throws(() => projection.complete({ ...completion, status }, run, thread), /did not finish/);
}
assert.throws(() => projection.complete({ ...completion, thread_id: run }, run, thread), /did not finish/);
assert.throws(() => projection.complete({ ...completion, run_id: thread }, run, thread), /did not finish/);
for (const header of [null, `http://foreign.invalid${location}`, `//foreign.invalid${location}`, `${location}?secret=hidden`,
  `${location}#hidden`, `/threads/${run}/runs/${run}`, `/threads/${thread}/runs/not-a-run`, `/other/..${location}`]) {
  assert.throws(() => nativeRunLocation(header, 'http://127.0.0.1:2024', thread));
}
const incomplete = new ChatProjection();
const partialFrames = frames.filter(frame => frame.event === 'custom' || frame.event === 'messages/partial');
const partialSource = new Response(partialFrames.map(frame => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join('')).body!;
const partialEvents = [];
for await (const event of readServerEvents(partialSource)) partialEvents.push(...incomplete.accept(event));
assert.equal(incomplete.evidence, true);
assert.throws(() => incomplete.complete(undefined, run, thread), /did not finish/);
assert.throws(() => incomplete.complete({ ...completion, status: 'interrupted' }, run, thread), /did not finish/);
assert(!partialEvents.some(event => event.type === 'done'));
assert.equal(projected.filter(event => event.type === 'tool').length, 2);
assert.ok(!JSON.stringify(projected).includes('private'));
assert.equal(new ChatProjection().evidence, false);
assert.throws(() => new ChatProjection().accept({ event: 'error', data: { message: 'private provider error' } }), /could not finish/);
const abort = new AbortController();
let cancelled = false;
const stalled = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
const pending = readServerEvents(stalled, abort.signal).next();
abort.abort();
await assert.rejects(pending, /abort/i);
assert.equal(cancelled, true);
const lateAbort = new AbortController();
const closing = new ReadableStream<Uint8Array>({ pull(controller) { lateAbort.abort(); controller.close(); } });
await assert.rejects(readServerEvents(closing, lateAbort.signal).next(), /abort/i);
await assert.rejects((async () => {
  for await (const event of readServerEvents(new Response('event: error\ndata: {"message":"private"}\n\n').body!)) projection.accept(event);
})(), /could not finish/);
await assert.rejects(readLimitedJSON(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'oversize' }) }), 4), /too large/);
console.log('Native cumulative SSE preserves Unicode and graph evidence; only scoped successful run status permits done, while premature EOF, error, abort and foreign run locations fail closed.');

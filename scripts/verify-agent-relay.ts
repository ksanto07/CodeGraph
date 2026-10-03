import assert from 'node:assert/strict';
import { ChatProjection, readServerEvents } from '../lib/agent/stream.ts';
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
assert.equal(projected.filter(event => event.type === 'tool').length, 2);
assert.ok(!JSON.stringify(projected).includes('private'));
assert.equal(new ChatProjection().evidence, false);
assert.throws(() => new ChatProjection().accept({ event: 'error', data: { message: 'private provider error' } }), /could not finish/);
await assert.rejects(readLimitedJSON(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'oversize' }) }), 4), /too large/);
console.log('Native cumulative SSE projects exact text and visible lookups, strips private events, handles byte splits, and bounds question bodies.');

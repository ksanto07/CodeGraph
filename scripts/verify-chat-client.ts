import assert from 'node:assert/strict';
import { readChatEvents, readChatEvent } from '../lib/agent/chat-client.ts';

const encoder = new TextEncoder();
const bytes = encoder.encode([
  JSON.stringify({ type: 'thread', thread: 'test-thread' }),
  JSON.stringify({ type: 'tool', name: 'neighbors', status: 'running' }),
  JSON.stringify({ type: 'tool', name: 'neighbors', status: 'done' }),
  JSON.stringify({ type: 'text', text: 'Unicode 源/src.ts\nnext line' }),
  JSON.stringify({ type: 'done' }),
].join('\r\n'));
const body = new ReadableStream<Uint8Array>({ start(controller) {
  for (let offset = 0; offset < bytes.length; offset += 1) controller.enqueue(bytes.slice(offset, offset + 1));
  controller.close();
} });
const events = [];
for await (const event of readChatEvents(body)) events.push(event);
assert.deepEqual(events.map(event => event.type), ['thread', 'tool', 'tool', 'text', 'done']);
assert.deepEqual(events[3], { type: 'text', text: 'Unicode 源/src.ts\nnext line' });
assert.throws(() => readChatEvent({ type: 'tool', name: 'read_file', status: 'done' }), /Invalid/);
assert.throws(() => readChatEvent({ type: 'text', text: 7 }), /Invalid/);
let cancelled = false;
const early = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('{"type":"done"}\n')); }, cancel() { cancelled = true; } });
for await (const event of readChatEvents(early)) { assert.equal(event.type, 'done'); break; }
assert.equal(cancelled, true);
const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('x'.repeat(2_000_001))); controller.close(); } });
await assert.rejects(async () => { for await (const event of readChatEvents(oversized)) assert.ok(event); }, /too large/);
const interrupted = new AbortController(); interrupted.abort();
await assert.rejects(async () => { for await (const event of readChatEvents(new ReadableStream(), interrupted.signal)) assert.ok(event); });
console.log('Conversation frames preserve split UTF-8, CRLF and final frames; reject unknown tools and oversized data; release readers on stop.');

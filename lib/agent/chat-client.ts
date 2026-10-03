import type { ChatEvent } from './stream.ts';

const names = new Set(['analysis_summary', 'search_files', 'files_by_role', 'neighbors', 'walk', 'routes']);
export function readChatEvent(value: unknown): ChatEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid conversation event.');
  if (value.type === 'thread' && 'thread' in value && typeof value.thread === 'string' && value.thread.length <= 200) return { type: 'thread', thread: value.thread };
  if (value.type === 'text' && 'text' in value && typeof value.text === 'string') return { type: 'text', text: value.text };
  if (value.type === 'tool' && 'name' in value && typeof value.name === 'string' && names.has(value.name) && 'status' in value && (value.status === 'running' || value.status === 'done')) return { type: 'tool', name: value.name, status: value.status };
  if (value.type === 'done') return { type: 'done' };
  if (value.type === 'error' && 'message' in value && typeof value.message === 'string') return { type: 'error', message: value.message };
  throw new Error('Invalid conversation event.');
}

export async function* readChatEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      if (pending.length > 2_000_000) throw new Error('The conversation event is too large.');
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary).trim();
        pending = pending.slice(boundary + 1);
        if (line) yield readChatEvent(JSON.parse(line));
      }
      if (next.done) break;
    }
    if (pending.trim()) yield readChatEvent(JSON.parse(pending));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

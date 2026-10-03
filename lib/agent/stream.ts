export interface ServerEvent { event: string; data: unknown }

export async function* readServerEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  function parse(frame: string): ServerEvent | null {
    let event = 'message';
    const lines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) return null;
    return { event, data: JSON.parse(lines.join('\n')) };
  }
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      pending = pending.replaceAll('\r\n', '\n');
      if (pending.length > 2_000_000) throw new Error('The agent stream frame is too large.');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const event = parse(frame);
        if (event) yield event;
      }
      if (next.done) break;
    }
    if (pending.trim()) throw new Error('The agent stream ended with an incomplete event.');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export type ChatEvent =
  | { type: 'thread'; thread: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' }
  | { type: 'done' }
  | { type: 'error'; message: string };
const toolNames = new Set(['analysis_summary', 'search_files', 'files_by_role', 'neighbors', 'walk', 'routes']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class ChatProjection {
  #text = new Map<string, string>();
  #lookups = 0;
  #answered = false;

  get evidence(): boolean { return this.#lookups > 0 && this.#answered; }

  accept(event: ServerEvent): ChatEvent[] {
    if (event.event === 'error') throw new Error('The agent could not finish its answer.');
    if (event.event === 'custom' && record(event.data) && event.data.type === 'tool' &&
      typeof event.data.name === 'string' && toolNames.has(event.data.name) &&
      (event.data.status === 'running' || event.data.status === 'done')) {
      if (event.data.status === 'done') this.#lookups++;
      return [{ type: 'tool', name: event.data.name, status: event.data.status }];
    }
    if (!['messages', 'messages/partial', 'messages/complete'].includes(event.event)) return [];
    const messages = Array.isArray(event.data) ? event.data : [event.data];
    const result: ChatEvent[] = [];
    for (const value of messages) {
      if (!record(value) || !(value.type === 'ai' || value.role === 'assistant')) continue;
      const id = typeof value.id === 'string' ? value.id : 'answer';
      const text = typeof value.content === 'string' ? value.content : Array.isArray(value.content)
        ? value.content.flatMap(block => record(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('') : '';
      if (!text) continue;
      const previous = this.#text.get(id) ?? '';
      const delta = event.event === 'messages' ? text : text.startsWith(previous) ? text.slice(previous.length) : '';
      this.#text.set(id, event.event === 'messages' ? previous + text : text);
      if (delta) { this.#answered = true; result.push({ type: 'text', text: delta }); }
    }
    return result;
  }
}

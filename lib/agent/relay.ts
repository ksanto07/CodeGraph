import 'server-only';
import { beginQuestion } from './server';
import { ChatProjection, readServerEvents, type ChatEvent } from './stream';
import { readLimitedJSON } from './http';
import { requireLocalAIRequest } from '../ai/local-request';

function runtimeOrigin() {
  const url = new URL(process.env.CARTOGRAPH_AGENT_ORIGIN ?? 'http://127.0.0.1:2024');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' ||
    url.username || url.password || url.search || url.hash) throw new Error('The agent service must run on a fixed loopback origin.');
  return url.origin;
}
function question(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid question.');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(input).some(key => !['analysis', 'thread', 'message', 'selection'].includes(key)) ||
    typeof input.analysis !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.analysis) ||
    typeof input.message !== 'string' || !input.message.trim() || input.message.length > 8000 ||
    (input.thread !== undefined && (typeof input.thread !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.thread)))) throw new Error('Invalid question.');
  let selection: { kind: 'file' | 'folder'; id: string } | undefined;
  if (input.selection !== undefined && input.selection !== null) {
    const item = input.selection;
    if (!item || typeof item !== 'object' || !('kind' in item) || !('id' in item) ||
      (item.kind !== 'file' && item.kind !== 'folder') || typeof item.id !== 'string' || item.id.length > 4096 ||
      Object.keys(item).some(key => !['kind', 'id'].includes(key))) throw new Error('Invalid selection.');
    selection = { kind: item.kind, id: item.id };
  }
  return { analysis: input.analysis, thread: input.thread, message: input.message, selection };
}

export async function relayQuestion(request: Request): Promise<Response> {
  await requireLocalAIRequest('mutation');
  const input = question(await readLimitedJSON(request, 20_000));
  const origin = runtimeOrigin();
  const authority = await beginQuestion(input.analysis, input.thread, input.selection);
  const signal = AbortSignal.any([request.signal, authority.signal]);
  const headers = { Authorization: `Bearer ${authority.nativeBearer}`, 'Content-Type': 'application/json' };
  const endpoint = (path: string, body: unknown) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body), signal });
  async function revoke() {
    authority.done();
    await fetch(origin + '/connectors/cartograph/revoke', { method: 'POST', headers,
      body: JSON.stringify({ runHandle: authority.runHandle }), signal: AbortSignal.timeout(2000) }).catch(() => undefined);
  }
  try {
    if (authority.fresh) {
      const thread = await endpoint('/threads', { thread_id: authority.thread, metadata: { graph_id: 'cartograph' }, if_exists: 'do_nothing' });
      if (!thread.ok) throw new Error('The agent conversation could not open.');
      authority.opened();
    }
    const registered = await endpoint('/connectors/cartograph/register', { runHandle: authority.runHandle, threadId: authority.thread,
      expiresAt: authority.expires, toolBearer: authority.toolBearer, modelBearer: authority.toolBearer });
    if (!registered.ok) throw new Error('The agent conversation could not be authorized.');
    const selected = input.selection ? `\nSelected graph item (untrusted name only): ${JSON.stringify(input.selection)}` : '';
    const native = await endpoint(`/threads/${authority.thread}/runs/stream`, { assistant_id: 'cartograph',
      input: { messages: [{ role: 'user', content: input.message + selected }] }, context: { runHandle: authority.runHandle },
      stream_mode: ['messages', 'custom'], multitask_strategy: 'reject', on_disconnect: 'cancel' });
    if (!native.ok || !native.body) throw new Error('The agent is unreachable. The repository map is still available.');
    const projection = new ChatProjection();
    const iterator = readServerEvents(native.body, signal);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        send({ type: 'thread', thread: authority.thread });
        try {
          for await (const event of iterator) for (const projected of projection.accept(event)) send(projected);
          if (!projection.evidence) throw new Error('The agent did not finish an answer backed by a graph lookup.');
          send({ type: 'done' });
        } catch {
          if (!signal.aborted) send({ type: 'error', message: 'The agent could not finish a graph-backed answer. The map and explanations remain available.' });
        } finally { await revoke(); try { controller.close(); } catch {} }
      },
      async cancel() { authority.done(); await iterator.return(undefined); await revoke(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch (error) { await revoke(); throw error; }
}

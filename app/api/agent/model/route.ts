import { questionModelConnection, requireBrokerHost } from '@/lib/agent/server';
import { bearer, readLimitedJSON } from '@/lib/agent/http';
import { readResponsesRoundRequest, streamResponsesRound } from '@/lib/ai/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const tools = new Set(['analysis_summary', 'search_files', 'files_by_role', 'neighbors', 'walk', 'routes']);

export async function POST(request: Request) {
  try {
    requireBrokerHost(request);
    const token = bearer(request);
    const input = readResponsesRoundRequest(await readLimitedJSON(request, 1_000_000));
    const authority = await questionModelConnection(token);
    if (input.model !== authority.model || input.tools?.some(tool => !tools.has(tool.name))) throw new Error('Unsupported agent model or capability.');
    const signal = AbortSignal.any([request.signal, authority.signal]);
    const events = streamResponsesRound(input, authority.connection, signal, {
      read: async key => authority.cache.get(key) ?? null,
      write: async (key, body) => {
        if (body.length > 1_000_000 || authority.cache.size >= 32) return body;
        const canonical = authority.cache.get(key) ?? body;
        authority.cache.set(key, canonical);
        return canonical;
      },
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await events.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(JSON.stringify(next.value) + '\n'));
        } catch { controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: 'The model round could not complete.' }) + '\n')); controller.close(); }
      },
      async cancel() { await events.return(undefined); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'This model round could not be authorized or completed.' }, { status: 403 }); }
}

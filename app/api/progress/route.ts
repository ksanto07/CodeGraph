import { auth } from '@clerk/nextjs/server';
import { createSupabaseClient } from '@/lib/supabase';
import { readProgress } from '@/lib/pipeline/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const workspace = await auth();
  if (!workspace.userId || !workspace.orgId) return new Response('Sign in to a workspace.', { status: 401 });
  const analysisId = new URL(request.url).searchParams.get('analysis');
  if (analysisId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(analysisId)) {
    return new Response('Invalid analysis.', { status: 400 });
  }
  const client = await createSupabaseClient();
  if (analysisId) {
    const { data, error } = await client.from('analyses').select('id').eq('id', analysisId).eq('is_seed', false).maybeSingle();
    if (error) return new Response('Could not authorize progress.', { status: 503 });
    if (!data) return new Response('Analysis not found.', { status: 404 });
  }
  const channel = client.channel(analysisId ? `analysis:${analysisId}` : `organization:${workspace.orgId}`, { config: { private: true } });
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function stop(closeStream = true) {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    request.signal.removeEventListener('abort', abort);
    void client.removeChannel(channel).catch(() => client.realtime.disconnect());
    if (closeStream) controller.close();
  }
  function abort() { stop(); }
  function send(event: string, value: unknown) {
    if (!stopped) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
  }
  function fail() {
    send('error', { message: 'Live progress is disconnected. Reload to reconnect.' });
    stop();
  }
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      controller = output;
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) { stop(); return; }
      controller.enqueue(encoder.encode('retry: 1000\n\n'));
      heartbeat = setInterval(() => { if (!stopped) controller.enqueue(encoder.encode(': heartbeat\n\n')); }, 15_000);
      deadline = setTimeout(fail, 15_000);
      channel.on('broadcast', { event: 'progress' }, event => {
        if (stopped) return;
        try {
          const progress = readProgress(event.payload);
          if (analysisId && progress.id !== analysisId) throw new Error('Unexpected analysis.');
          send('progress', progress);
        } catch { fail(); }
      });
      void client.realtime.setAuth().then(() => {
        if (stopped) return;
        channel.subscribe(status => {
          if (stopped) return;
          if (status === 'SUBSCRIBED') { clearTimeout(deadline); send('ready', {}); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') fail();
        });
      }).catch(fail);
    },
    cancel() { stop(false); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store',
    'X-Accel-Buffering': 'no',
  } });
}

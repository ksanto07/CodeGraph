import { relayQuestion } from '@/lib/agent/relay';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await relayQuestion(request); }
  catch { return Response.json({ error: 'The agent is unavailable. Start its local service, then try again. The repository map is still available.' }, { status: 503 }); }
}

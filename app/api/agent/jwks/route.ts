import { agentJWKS, requireBrokerHost } from '@/lib/agent/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { requireBrokerHost(request); return Response.json(await agentJWKS(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return new Response('Agent unavailable.', { status: 403 }); }
}

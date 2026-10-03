import { executeQuestionTool, requireBrokerHost } from '@/lib/agent/server';
import { bearer, readLimitedJSON } from '@/lib/agent/http';
import { readGraphToolInput } from '@/lib/agent/graph-tools';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    requireBrokerHost(request);
    const input = readGraphToolInput(await readLimitedJSON(request));
    return Response.json(await executeQuestionTool(bearer(request), input), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'This graph lookup could not be authorized or completed.' }, { status: 403 }); }
}

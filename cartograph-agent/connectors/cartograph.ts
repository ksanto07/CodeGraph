import { CONNECTOR_BRAND, type Connector } from 'managed-deepagents/runtime';
import { z } from 'zod';
import { registerTransport, revokeTransport } from '../transport.ts';
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Missing registration.');
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 20_000) throw new Error('Registration too large.'); parts.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
const registration = z.object({ runHandle: z.string(), threadId: z.string().uuid(), expiresAt: z.number(), toolBearer: z.string().max(8192), modelBearer: z.string().max(8192) }).strict();
export const connector: Connector = {
  [CONNECTOR_BRAND]: true, kind: 'cartograph-private-transport',
  http({ router }) {
    router.post('/register', async (request, identity) => {
      try {
        if (Number(request.headers.get('content-length') ?? 0) > 20_000) return new Response(null, { status: 413 });
        const body = registration.parse(await boundedJson(request));
        if (identity.claims?.cartograph_thread !== body.threadId) return new Response(null, { status: 403 });
        registerTransport(body.runHandle, { principal: identity.user.id, threadId: body.threadId, expiresAt: body.expiresAt, toolBearer: body.toolBearer, modelBearer: body.modelBearer });
        return Response.json({ registered: true });
      } catch { return Response.json({ error: 'Transport registration rejected.' }, { status: 400 }); }
    });
    router.post('/revoke', async (request, identity) => {
      try { const body = z.object({ runHandle: z.string() }).strict().parse(await boundedJson(request)); revokeTransport(body.runHandle, identity.user.id); return Response.json({ revoked: true }); }
      catch { return new Response(null, { status: 400 }); }
    });
  },
};

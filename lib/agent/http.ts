export async function readLimitedJSON(request: Request, maximum = 100_000): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON input is required.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('The question input is too large.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function bearer(request: Request): string {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ') || value.length > 4096) throw new Error('A scoped question credential is required.');
  return value.slice(7);
}

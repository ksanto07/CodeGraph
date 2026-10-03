import { AsyncLocalStorage } from 'node:async_hooks';
import type { ResponsesRoundEvent, ResponsesRoundTransport } from '../lib/ai/client.ts';

export function appOrigin(): string {
  const value = process.env.CARTOGRAPH_APP_ORIGIN;
  if (!value) throw new Error('CARTOGRAPH_APP_ORIGIN is required.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Configure a fixed local app origin.');
  return url.origin;
}
type Entry = { principal: string; threadId: string; expiresAt: number; toolBearer: string; modelBearer: string };
const entries = new Map<string, Entry>();
const active = new AsyncLocalStorage<Entry>();
function sweep(): void { for (const [key, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(key); }
export function registerTransport(handle: string, entry: Entry): void {
  sweep();
  if (entries.has(handle) || entries.size >= 64) throw new Error('Transport registration unavailable.');
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(handle) || !entry.principal || !entry.threadId || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now() || entry.expiresAt > Date.now() + 300_000 || !entry.toolBearer || entry.toolBearer !== entry.modelBearer) throw new Error('Invalid transport registration.');
  entries.set(handle, Object.freeze({ ...entry }));
}
export function revokeTransport(handle: string, principal: string): void { if (entries.get(handle)?.principal === principal) entries.delete(handle); }
export function resolveTransport(handle: string, principal: string, threadId: string): Entry {
  sweep(); const entry = entries.get(handle);
  if (!entry || entry.principal !== principal || entry.threadId !== threadId) throw new Error('Run transport is unavailable.');
  return entry;
}
export function withTransport<T>(entry: Entry, operation: () => T): T { return active.run(entry, operation); }
export async function callGraphTool(entry: Entry, input: unknown, signal?: AbortSignal): Promise<unknown> {
  if (entry.expiresAt <= Date.now()) throw new Error('Run transport expired.');
  const response = await fetch(`${appOrigin()}/api/agent/tools`, { method: 'POST', headers: { Authorization: `Bearer ${entry.toolBearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (!response.ok) throw new Error('Graph tool request failed.');
  return response.json();
}
function readEvent(value: unknown): ResponsesRoundEvent {
  if (!value || typeof value !== 'object') throw new Error('Invalid model stream.');
  const record = value as Record<string, unknown>;
  if (record.type === 'reasoning') {
    const item = record.item;
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'reasoning' || !('id' in item) || typeof item.id !== 'string' || !('summary' in item) || !Array.isArray(item.summary)) throw new Error('Invalid reasoning stream.');
    const summary = item.summary.map((part: unknown) => {
      if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'summary_text' || !('text' in part) || typeof part.text !== 'string') throw new Error('Invalid reasoning summary.');
      return { type: 'summary_text' as const, text: part.text };
    });
    const encrypted = 'encrypted_content' in item ? item.encrypted_content : undefined;
    if (encrypted !== undefined && encrypted !== null && typeof encrypted !== 'string') throw new Error('Invalid reasoning replay.');
    return { type: 'reasoning', item: { type: 'reasoning', id: item.id, summary, encrypted_content: encrypted } };
  }
  if (record.type === 'completed') return { type: 'completed' };
  if (record.type === 'text_delta' && typeof record.text === 'string') return { type: 'text_delta', text: record.text };
  if (record.type === 'tool_call' && typeof record.callId === 'string' && typeof record.name === 'string' && typeof record.arguments === 'string') return { type: 'tool_call', callId: record.callId, name: record.name, arguments: record.arguments };
  throw new Error('Invalid model stream.');
}
export const modelRound: ResponsesRoundTransport = async function* (request, signal) {
  const entry = active.getStore();
  if (!entry || entry.expiresAt <= Date.now()) throw new Error('Run transport is unavailable.');
  const response = await fetch(`${appOrigin()}/api/agent/model`, { method: 'POST', headers: { Authorization: `Bearer ${entry.modelBearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  if (!response.ok || !response.body) throw new Error('Model gateway request failed.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; let completed = false;
  try {
    while (true) {
      const chunk = await reader.read(); pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 1_048_576) throw new Error('Model stream frame is too large.');
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = readEvent(JSON.parse(line)); if (event.type === 'completed') completed = true; yield event;
      }
      if (chunk.done) break;
    }
    if (pending.trim() || !completed) throw new Error('Model stream ended before completion.');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
};

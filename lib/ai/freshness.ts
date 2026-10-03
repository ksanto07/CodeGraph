import { createHash } from 'node:crypto';
import type { FileNode } from '../parser/types.ts';

interface FreshnessDetails { latestCommit: string | null; changedPaths: string[]; messages: string[] }
export type Freshness = FreshnessDetails & { kind: 'current' | 'stale' | 'unknown' };

const byteLimit = 200 * 1024 * 1024;
const commitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
function encodedPath(path: string): string {
  const segments = path.split('/');
  if (!path || /[\\\x00-\x1f\x7f]/.test(path) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('The repository file path is invalid.');
  }
  return segments.map(encodeURIComponent).join('/');
}

export async function checkFreshness(
  repositorySlug: string, analysedCommit: string, members: readonly FileNode[], transport: typeof fetch = fetch,
): Promise<Freshness> {
  let latestCommit: string | null = null;
  const changedPaths = new Set<string>();
  const messages: string[] = [];
  const signal = AbortSignal.timeout(30_000);
  let bytes = 0;
  let uncertain = false;

  async function bounded<T>(operation: Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let stop: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(new Error('The repository freshness check timed out.'));
      signal.addEventListener('abort', stop, { once: true });
    });
    try { return await Promise.race([operation, aborted]); }
    finally { if (stop) signal.removeEventListener('abort', stop); }
  }
  async function request(url: string): Promise<Response> {
    return bounded(transport(url, { signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/vnd.github+json' } }));
  }
  async function consume(response: Response, update: (chunk: Uint8Array) => void): Promise<void> {
    if (!response.body) throw new Error('GitHub returned no file content.');
    const reader = response.body.getReader();
    try {
      for (;;) {
        const chunk = await bounded(reader.read());
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > byteLimit) throw new Error('The repository freshness check exceeded its 200 MB content budget.');
        update(chunk.value);
      }
    } finally { void reader.cancel().catch(() => undefined); }
  }
  function statusFailure(response: Response): Error {
    void response.body?.cancel().catch(() => undefined);
    return new Error(response.status === 403 || response.status === 429
      ? 'GitHub limited the repository freshness check. Try again later.'
      : `GitHub could not check repository freshness (HTTP ${response.status}).`);
  }
  try {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repositorySlug) || !commitPattern.test(analysedCommit)) {
      throw new Error('The repository identity or analysed commit is invalid.');
    }
    if (members.length > 10_000) throw new Error('The repository freshness check exceeds its 10,000 file limit.');
    const paths = members.map(member => ({ member, encoded: encodedPath(member.id) }));
    if (members.some(member => !/^[a-f0-9]{64}$/i.test(member.sha256))) throw new Error('A stored repository content hash is invalid.');
    const repository = repositorySlug.split('/').map(encodeURIComponent).join('/');
    const head = await request(`https://api.github.com/repos/${repository}/commits/HEAD`);
    if (!head.ok) throw statusFailure(head);
    const chunks: Uint8Array[] = [];
    let metadataBytes = 0;
    await consume(head, chunk => {
      metadataBytes += chunk.byteLength;
      if (metadataBytes > 1024 * 1024) throw new Error('GitHub returned oversized commit metadata.');
      chunks.push(chunk);
    });
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value !== 'object' || value === null || !('sha' in value) || typeof value.sha !== 'string' || !commitPattern.test(value.sha)) {
      throw new Error('GitHub returned an invalid latest commit.');
    }
    latestCommit = value.sha.toLowerCase();
    if (latestCommit !== analysedCommit.toLowerCase()) messages.push('The repository has moved past the analysed commit. Re-analyse to update the map.');
    let next = 0;
    async function worker(): Promise<void> {
      while (next < paths.length && !signal.aborted && bytes <= byteLimit) {
        const { member, encoded } = paths[next++];
        try {
          const response = await request(`https://raw.githubusercontent.com/${repository}/${latestCommit}/${encoded}`);
          if (response.status === 404) {
            void response.body?.cancel().catch(() => undefined);
            changedPaths.add(member.id);
            continue;
          }
          if (!response.ok) throw statusFailure(response);
          const hash = createHash('sha256');
          await consume(response, chunk => { hash.update(chunk); });
          if (hash.digest('hex') !== member.sha256.toLowerCase()) changedPaths.add(member.id);
        } catch (error) {
          uncertain = true;
          const message = error instanceof Error ? error.message : 'GitHub file content could not be checked.';
          if (!messages.includes(message)) messages.push(message);
        }
      }
      if (next < paths.length || signal.aborted || bytes > byteLimit) uncertain = true;
    }
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, () => worker()));
  } catch (error) {
    uncertain = true;
    messages.push(error instanceof Error ? error.message : 'The repository freshness check could not complete.');
  }
  const changed = [...changedPaths].sort();
  if (changed.length) messages.push('Repository file content changed or was deleted. Re-analyse to update the map.');
  const stale = changed.length > 0 || (latestCommit !== null && latestCommit !== analysedCommit.toLowerCase());
  return { kind: stale ? 'stale' : uncertain ? 'unknown' : 'current', latestCommit, changedPaths: changed, messages };
}

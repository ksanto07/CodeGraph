import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { RepositoryAddress } from '../repository-address.ts';

const execute = promisify(execFile);
const archiveLimit = 30 * 1024 * 1024;
const expandedLimit = 200 * 1024 * 1024;
export interface RepositoryArchive { directory: string; commit: string; dispose: () => Promise<void> }

export async function repositoryCommit(address: RepositoryAddress): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${address.slug}/commits/HEAD`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cartograph' },
    signal: AbortSignal.timeout(30_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'This public repository does not exist or has no commits.' : `GitHub could not return the commit (${response.status}).`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('sha' in data) || typeof data.sha !== 'string' || !/^[a-f0-9]{40}$/.test(data.sha)) throw new Error('GitHub returned an invalid commit.');
  return data.sha;
}

export async function fetchRepository(address: RepositoryAddress, pinnedCommit?: string): Promise<RepositoryArchive> {
  if (pinnedCommit !== undefined && !/^[a-f0-9]{40}$/.test(pinnedCommit)) throw new Error('An archive pin must be an immutable commit.');
  const commit = pinnedCommit ?? await repositoryCommit(address);
  const response = await fetch(`https://codeload.github.com/${address.slug}/tar.gz/${commit}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`GitHub could not return the archive (${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > archiveLimit) throw new Error('This repository exceeds the 30 MB archive limit.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const archive = gunzipSync(Buffer.concat(chunks), { maxOutputLength: expandedLimit });
  const workspace = await mkdtemp(path.join(tmpdir(), 'cartograph-'));
  const dispose = () => rm(workspace, { recursive: true, force: true });
  try {
    const archivePath = path.join(workspace, 'repository.tar');
    await writeFile(archivePath, archive);
    const { stdout: listing } = await execute('tar', ['-tf', archivePath], { maxBuffer: 16 * 1024 * 1024 });
    const entries = listing.trim().split('\n');
    const root = entries[0]?.split('/')[0];
    if (!root || entries.length > 50_000 || entries.some(entry => !entry.startsWith(`${root}/`) || entry.includes('\r') || entry.includes('\\') || entry.split('/').some(part => part === '..' || part === '.'))) {
      throw new Error('The repository archive contains unsafe paths or too many entries.');
    }
    const { stdout: kinds } = await execute('tar', ['-tvf', archivePath], { maxBuffer: 16 * 1024 * 1024 });
    if (kinds.trim().split('\n').some(entry => !entry.startsWith('-') && !entry.startsWith('d'))) throw new Error('Archives containing links or special files are not supported.');
    await execute('tar', ['-xf', archivePath, '-C', workspace, '--no-same-owner', '--no-same-permissions']);
    return { directory: path.join(workspace, root), commit, dispose };
  } catch (error) { await dispose(); throw error; }
}

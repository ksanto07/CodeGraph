import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeFramework } from '../adapters/frameworks.ts';
import { runnerConfigAdapter } from '../adapters/entry-points.ts';
import { explanationContext, readSemanticRole, type ExplanationContext, type SemanticRole } from '../ai/context.ts';
import { parseRepository } from '../parser/repository.ts';
import { fetchRepository } from '../pipeline/archive.ts';
import { repositoryAddress } from '../repository-address.ts';

export interface RoleManifestEntry {
  repository: string; commit: string; path: string; sha256: string; role: SemanticRole;
}
export interface HeldOutExample {
  context: ExplanationContext;
  expectedRole: SemanticRole;
  provenance: { repository: string; commit: string; path: string; sha256: string; archiveUrl: string };
}
export interface HeldOutDataset {
  schemaVersion: 1; manifestSha256: string; examples: HeldOutExample[];
  distribution: Record<string, number>;
}

function entriesFrom(value: unknown): RoleManifestEntry[] {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('entries' in value) || !Array.isArray(value.entries) || value.entries.length < 30) {
    throw new Error('The held-out manifest requires at least 30 real files.');
  }
  const entries = value.entries.map((item: unknown): RoleManifestEntry => {
    if (!item || typeof item !== 'object' || !('repository' in item) || typeof item.repository !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(item.repository) ||
      !('commit' in item) || typeof item.commit !== 'string' || !/^[a-f0-9]{40}$/.test(item.commit) ||
      !('sha256' in item) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !('path' in item) || typeof item.path !== 'string' || !item.path || item.path.includes('\\') ||
      path.posix.isAbsolute(item.path) || item.path.split('/').some(part => part === '.' || part === '..' || !part) ||
      !('role' in item) || typeof item.role !== 'string') throw new Error('Invalid held-out manifest entry.');
    return { repository: item.repository, commit: item.commit, path: item.path, sha256: item.sha256, role: readSemanticRole(item.role) };
  });
  if (new Set(entries.map(entry => entry.sha256)).size !== entries.length ||
    new Set(entries.map(entry => `${entry.repository}\0${entry.commit}\0${entry.path}`)).size !== entries.length) {
    throw new Error('Held-out files and source content must be distinct.');
  }
  return entries;
}

export async function prepareHeldOutDataset(manifest: unknown): Promise<HeldOutDataset> {
  const entries = entriesFrom(manifest);
  const examples: HeldOutExample[] = [];
  const groups = new Map<string, RoleManifestEntry[]>();
  for (const entry of entries) {
    const key = `${entry.repository}\0${entry.commit}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const address = repositoryAddress(`https://github.com/${group[0].repository}`);
    const archive = await fetchRepository(address, group[0].commit);
    try {
      const parsed = await parseRepository(archive.directory, runnerConfigAdapter, { sourceFiles: 10_000, imports: 60_000 });
      const { graph } = await analyzeFramework(archive.directory, parsed);
      const files = graph.files.map(file => ({ ...file, annotations: {} }));
      for (const entry of group) {
        const file = graph.files.find(file => file.id === entry.path);
        const rawHash = createHash('sha256').update(await readFile(path.join(archive.directory, entry.path))).digest('hex');
        if (!file || file.sha256 !== entry.sha256 || rawHash !== entry.sha256 || file.annotations.role !== entry.role) {
          throw new Error(`Held-out ground truth changed for ${entry.repository}/${entry.path}.`);
        }
        examples.push({ context: explanationContext(files, graph.edges, { kind: 'file', id: entry.path }),
          expectedRole: entry.role, provenance: { repository: entry.repository, commit: entry.commit,
            path: entry.path, sha256: entry.sha256, archiveUrl: `https://codeload.github.com/${address.slug}/tar.gz/${archive.commit}` } });
      }
    } finally { await archive.dispose(); }
  }
  const distribution: Record<string, number> = {};
  for (const example of examples) distribution[example.expectedRole] = (distribution[example.expectedRole] ?? 0) + 1;
  return { schemaVersion: 1, manifestSha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), examples, distribution };
}

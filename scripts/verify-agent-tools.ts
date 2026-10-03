import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseRepository } from '../lib/parser/repository.ts';
import { analyzeFramework } from '../lib/adapters/frameworks.ts';
import { runnerConfigAdapter } from '../lib/adapters/entry-points.ts';
import { detailIndex } from '../lib/canvas/details.ts';
import { walk } from '../lib/canvas/graph-maths.ts';
import { queryGraphTool, readGraphToolInput } from '../lib/agent/graph-tools.ts';

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'verify-agent-tools-'));
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { express: 'fixture' } }));
    await writeFile(path.join(directory, 'entry.ts'), "import './branch'; import './leaf'; import './unresolved';\n");
    await writeFile(path.join(directory, 'branch.ts'), "import './leaf';\n");
    await writeFile(path.join(directory, 'leaf.ts'), "import './end'; export const leaf = 1;\n");
    await writeFile(path.join(directory, 'end.ts'), "import './branch'; export const end = 1;\n");
    await writeFile(path.join(directory, 'vite.config.ts'), 'export default {};\n');
    const parsed = await parseRepository(directory, runnerConfigAdapter);
    const { graph, metadata } = await analyzeFramework(directory, parsed);
    const index = detailIndex(graph.files, graph.edges);
    const snapshot = JSON.stringify({ graph, metadata });
    const query = (value: unknown) => queryGraphTool(graph, metadata, readGraphToolInput(value));
    const summary = query({ name: 'analysis_summary', args: {} });
    assert.equal(summary.name, 'analysis_summary');
    if (summary.name !== 'analysis_summary') throw new Error('Unexpected summary result.');
    assert.equal(summary.files, 5);
    assert.equal(summary.imports.unresolved, 1);
    assert.equal(summary.skipped, graph.skipped.length);
    const search = query({ name: 'search_files', args: { pathPart: '.ts', limit: 2 } });
    if (search.name !== 'search_files') throw new Error('Unexpected search result.');
    assert.equal(search.files.total, 5); assert.equal(search.files.truncated, 3);
    assert.deepEqual(search.files.items.map(file => file.path), ['branch.ts', 'end.ts']);
    const roles = query({ name: 'files_by_role', args: { role: 'config' } });
    if (roles.name !== 'files_by_role') throw new Error('Unexpected role result.');
    assert.deepEqual(roles.files.items.map(file => file.path), ['vite.config.ts']);
    const neighbors = query({ name: 'neighbors', args: { path: 'entry.ts', direction: 'outgoing', limit: 1 } });
    if (neighbors.name !== 'neighbors') throw new Error('Unexpected neighbors result.');
    assert.equal(neighbors.neighbors.total, 2); assert.equal(neighbors.neighbors.truncated, 1);
    assert.deepEqual(neighbors.neighbors.items.map(file => file.path), index.outgoing.get('entry.ts')!.slice(0, 1).map(row => row.file.id));
    assert.deepEqual(neighbors.neighbors.items[0].kinds, index.outgoing.get('entry.ts')![0].kinds);
    for (const direction of ['incoming', 'outgoing'] as const) {
      const result = query({ name: 'walk', args: { path: 'leaf.ts', direction, depth: 2, limit: 1 } });
      if (result.name !== 'walk') throw new Error('Unexpected walk result.');
      const shared = walk(index, 'leaf.ts', direction, 2);
      const expected = shared.levels.flatMap(level => level.files.map(file => ({ path: file.id, depth: level.depth })));
      assert.equal(result.files.total, expected.length);
      assert.deepEqual(result.files.items.map(file => ({ path: file.path, depth: file.depth })), expected.slice(0, 1));
      assert.equal(result.furtherCount, shared.furtherCount);
    }
    const routes = query({ name: 'routes', args: {} });
    if (routes.name !== 'routes') throw new Error('Unexpected routes result.');
    assert.equal(routes.routes.total, 0, 'Unrecovered routes remain absent.');
    const known = queryGraphTool(graph, { framework: 'express', routes: [
      { file: 'leaf.ts', path: '/b', method: 'POST' }, { file: 'entry.ts', path: '/a', method: 'GET' },
    ] }, readGraphToolInput({ name: 'routes', args: { limit: 1 } }));
    if (known.name !== 'routes') throw new Error('Unexpected route result.');
    assert.deepEqual(known.routes.items, [{ file: 'entry.ts', path: '/a', method: 'GET' }]);
    assert.equal(known.routes.total, 2); assert.equal(known.routes.truncated, 1);
    for (const input of [
      { name: 'analysis_summary', args: { analysis: 'hidden' } },
      { name: 'analysis_summary', args: {}, organization: 'hidden' },
      { name: 'walk', args: { path: 'leaf.ts', direction: 'sideways', depth: 1 } },
      { name: 'walk', args: { path: 'leaf.ts', direction: 'incoming', depth: 6 } },
      { name: 'neighbors', args: { path: './leaf.ts', direction: 'incoming' } },
      { name: 'neighbors', args: { path: '../leaf.ts', direction: 'incoming' } },
      { name: 'search_files', args: { pathPart: '', limit: 1 } },
      { name: 'files_by_role', args: { role: 'imaginary', limit: 101 } },
      { name: 'routes', args: { limit: 0 } },
    ]) assert.throws(() => readGraphToolInput(input));
    assert.throws(() => query({ name: 'neighbors', args: { path: 'missing.ts', direction: 'incoming' } }), /absent/);
    assert.throws(() => query({ name: 'walk', args: { path: 'missing.ts', direction: 'incoming', depth: 1 } }), /origin/);
    assert.equal(JSON.stringify({ graph, metadata }), snapshot, 'Tools preserve the supplied parser facts.');
    console.log('Six graph tools passed shared-neighbor/walk, actual parser coverage, role, route, argument, truncation and immutability checks.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

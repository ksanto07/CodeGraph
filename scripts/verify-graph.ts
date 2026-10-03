import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { detailIndex } from '../lib/canvas/details.ts';
import { insights, walk } from '../lib/canvas/graph-maths.ts';
import { category, foldGraph } from '../lib/canvas/model.ts';
import { nextEntryAdapter, runnerConfigAdapter } from '../lib/adapters/entry-points.ts';
import { readParseResult } from '../lib/parser/result-file.ts';
import { noFrameworkAdapter, type Edge, type FileNode } from '../lib/parser/types.ts';

const file = (id: string, lines = 4): FileNode => ({ id, folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.', lines, sha256: '', moduleKind: 'module', fanIn: 99, fanOut: 99, annotations: {} });
const edge = (from: string, to: string): Edge => ({ from, to, kind: 'import' });
const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'unimported.ts', 'self.ts'].map(id => file(id));
const edges = [edge('a.ts', 'b.ts'), edge('a.ts', 'c.ts'), edge('b.ts', 'c.ts'), edge('c.ts', 'd.ts'), edge('d.ts', 'e.ts'), edge('e.ts', 'b.ts'), edge('self.ts', 'self.ts'), { ...edge('a.ts', 'b.ts'), kind: 're-export' as const }];
const snapshot = JSON.stringify({ files, edges });
const index = detailIndex(files, edges);
assert.deepEqual(walk(index, 'a.ts', 'outgoing').levels.map(level => level.files.map(member => member.id)), [['b.ts', 'c.ts'], ['d.ts']], 'Shortest distances win over longer paths through a shared branch.');
assert.equal(walk(index, 'a.ts', 'outgoing').furtherCount, 1);
assert.deepEqual(walk(index, 'd.ts', 'incoming').levels.map(level => level.files.map(member => member.id)), [['c.ts'], ['a.ts', 'b.ts']]);
assert.equal(walk(index, 'd.ts', 'incoming').furtherCount, 1);
assert.equal(walk(index, 'self.ts', 'incoming').levels.flatMap(level => level.files).length, 0);
assert.equal(walk(index, 'self.ts', 'outgoing').furtherCount, 0);
assert.equal(walk(index, 'a.ts', 'outgoing', 0).furtherCount, 4);
assert.throws(() => walk(index, 'missing', 'incoming'), /origin/);
assert.throws(() => walk(index, 'a.ts', 'incoming', -1), /depth/);
const facts = insights(index);
assert.deepEqual(facts.unimported.map(member => member.id), ['a.ts', 'unimported.ts']);
assert.deepEqual(facts.cycles.map(cycle => cycle.files.map(member => member.id)), [['b.ts', 'c.ts', 'd.ts', 'e.ts'], ['self.ts']]);
function checkWitness(cycle: ReturnType<typeof insights>['cycles'][number], observed: readonly Edge[]) {
  assert.equal(cycle.witness[0].id, cycle.witness.at(-1)!.id, 'Cycle witnesses close at their starting file.');
  const members = new Set(cycle.files.map(member => member.id));
  for (let i = 1; i < cycle.witness.length; i++) {
    assert(members.has(cycle.witness[i].id));
    assert(observed.some(item => item.from === cycle.witness[i - 1].id && item.to === cycle.witness[i].id), 'Every displayed cycle step is an observed directed import.');
  }
}
for (const cycle of facts.cycles) checkWitness(cycle, edges);
assert.deepEqual(insights(detailIndex([...files].reverse(), [...edges].reverse())), facts);
assert.deepEqual(walk(detailIndex([...files].reverse(), [...edges].reverse()), 'a.ts', 'outgoing'), walk(index, 'a.ts', 'outgoing'));
const connected = detailIndex(['a', 'b', 'c', 'd'].map(id => file(id)), [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('c', 'd'), edge('d', 'c')]);
assert.deepEqual(insights(connected).cycles.map(cycle => cycle.files.map(member => member.id)), [['a', 'b'], ['c', 'd']], 'A one-way link must not combine distinct strongly connected groups.');
assert.equal(JSON.stringify({ files, edges }), snapshot, 'Analytics never mutate input facts.');
const largeFiles = Array.from({ length: 20000 }, (_, i) => file(`file-${String(i).padStart(5, '0')}.ts`));
const largeEdges = largeFiles.slice(1).map((member, i) => edge(largeFiles[i].id, member.id));
const large = detailIndex(largeFiles, largeEdges);
assert.equal(walk(large, largeFiles[0].id, 'outgoing').furtherCount, 19997);
assert.equal(insights(large).cycles.length, 0, 'A long graph traverses without recursive call-stack growth.');
largeEdges.push(edge(largeFiles.at(-1)!.id, largeFiles[0].id));
assert.equal(insights(detailIndex(largeFiles, largeEdges)).cycles[0].files.length, 20000, 'A deep cycle also traverses iteratively.');
const hubFiles = [file('hub.ts'), ...Array.from({ length: 25 }, (_, i) => file(`importer-${i}.ts`)), file('limit.ts', 500), file('long.ts', 501)];
const hubEdges = hubFiles.filter(member => member.id.startsWith('importer')).flatMap(member => [edge(member.id, 'hub.ts'), { ...edge(member.id, 'hub.ts'), kind: 'dynamic-import' as const }]);
const hub = insights(detailIndex(hubFiles, hubEdges));
assert.equal(hub.fanInThreshold, 11);
assert.deepEqual(hub.highFanIn.map(member => member.id), ['hub.ts']);
assert.deepEqual(hub.longFiles.map(member => member.id), ['long.ts']);
assert.equal(insights(detailIndex([file('a')], [])).fanInThreshold, 10);

const nextEntries = ['app/page.tsx', 'app/(group)/[slug]/page.tsx', 'src/app/api/route.ts', 'app/layout.tsx', 'src/proxy.ts', 'middleware.ts', 'next.config.ts', 'pages/index.tsx', 'src/pages/api/data.ts'];
for (const id of nextEntries) assert(nextEntryAdapter.annotate(file(id)).entryPoint, `${id} has an explicit entry annotation.`);
for (const id of ['components/page.tsx', 'lib/route.ts', 'config/helper.ts', 'app/_private/page.tsx']) assert.equal(nextEntryAdapter.annotate(file(id)).entryPoint, undefined, `${id} is not a Next entry.`);
const metadataEntries = ['app/sitemap.ts', 'src/app/blog/sitemap.js', 'app/robots.ts', 'src/app/manifest.js', 'app/icon.tsx', 'src/app/blog/apple-icon.ts', 'app/(group)/opengraph-image.tsx', 'app/twitter-image.js'];
for (const id of metadataEntries) assert(nextEntryAdapter.annotate(file(id)).entryPoint, `${id} is framework-reached metadata.`);
for (const id of ['lib/sitemap.ts', 'app/_private/icon.tsx', 'src/app/_drafts/sitemap.ts', 'app/blog/robots.ts', 'app/blog/manifest.ts']) assert.equal(nextEntryAdapter.annotate(file(id)).entryPoint, undefined);
assert.equal(insights(detailIndex(metadataEntries.map(id => ({ ...file(id), annotations: nextEntryAdapter.annotate(file(id)) })), [])).unimported.length, 0);
const runnerEntries = ['src/math.test.ts', 'src/math.spec.tsx', 'src/__tests__/math.ts', 'packages/ui/vitest.config.mts', 'svelte/svelte.config.js'];
for (const id of runnerEntries) assert(runnerConfigAdapter.annotate(file(id)).entryPoint);
assert.deepEqual(noFrameworkAdapter.annotate(file('app/page.tsx')), {}, 'Generic parsing does not infer a framework.');
const entryFiles = [...nextEntries, ...runnerEntries, 'src/ordinary.ts', 'components/page.tsx'].map(id => { const node = file(id); return { ...node, annotations: nextEntryAdapter.annotate(node) }; });
assert.deepEqual(insights(detailIndex(entryFiles, [])).unimported.map(member => member.id), ['components/page.tsx', 'src/ordinary.ts']);
const unrelatedAnnotation = { ...file('ordinary.ts'), annotations: { convention: 'known' } };
assert.equal(insights(detailIndex([unrelatedAnnotation], [])).unimported.length, 1, 'Only the explicit entryPoint annotation excludes zero-incoming files.');

const fixture = await readParseResult(fileURLToPath(new URL('../lib/canvas/fixture.json', import.meta.url)));
const fixtureSnapshot = JSON.stringify(fixture);
const annotatedFiles = fixture.files.map(member => ({ ...member, annotations: runnerConfigAdapter.annotate(member) }));
const real = detailIndex(annotatedFiles, fixture.edges);
const realFacts = insights(real);
assert(realFacts.cycles.length > 0, 'The unchanged checked-in fixture contains a real import cycle.');
for (const cycle of realFacts.cycles) checkWitness(cycle, fixture.edges);
const excluded = annotatedFiles.filter(member => member.annotations.entryPoint && real.incoming.get(member.id)!.length === 0);
assert(excluded.length > 0, 'The fixture includes externally reached entries with zero observed importers.');
assert(excluded.every(member => !realFacts.unimported.some(item => item.id === member.id)));
assert(realFacts.unimported.length > 0, 'Ordinary zero-incoming fixture files remain discoverable.');
const graph = foldGraph(annotatedFiles, fixture.edges);
for (const kind of new Set(annotatedFiles.map(member => category(member).id))) {
  const rail = annotatedFiles.filter(member => category(member).id === kind).length;
  const panels = graph.folders.reduce((sum, folder) => sum + folder.files.filter(member => category(member).id === kind).length, 0);
  assert.equal(panels, rail, 'Full folder membership counts sum to the selected rail category.');
}
assert.deepEqual(insights(detailIndex([...annotatedFiles].reverse(), [...fixture.edges].reverse())), realFacts);
assert.equal(JSON.stringify(fixture), fixtureSnapshot);
console.log('Walk directions, shortest distances, distinct files, exact further counts, iterative SCCs, real directed witnesses, entry adapters, threshold boundaries, category totals, determinism and immutable inputs passed.');
console.log(`${fixture.files.length} unchanged fixture files, ${realFacts.cycles.length} cyclic groups, ${realFacts.unimported.length} unimported files, ${excluded.length} external entries excluded.`);
console.log(`Real cycle ${realFacts.cycles[0].witness.map(member => member.id).join(' -> ')}`);

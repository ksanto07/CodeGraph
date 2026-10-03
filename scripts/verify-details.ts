import assert from 'node:assert/strict';
import { detailIndex, folderKinds } from '../lib/canvas/details.ts';
import { foldGraph } from '../lib/canvas/model.ts';
import { readParseResult } from '../lib/parser/result-file.ts';
import { fileURLToPath } from 'node:url';
import type { Edge, FileNode } from '../lib/parser/types.ts';

const file = (id: string): FileNode => ({ id, folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.', lines: 4, sha256: '', moduleKind: 'module', fanIn: 99, fanOut: 99, annotations: {} });
const files = [file('src/a.ts'), file('src/b.tsx'), file('src/c.ts'), file('src/entry.ts')];
const edges: Edge[] = [
  { from: 'src/a.ts', to: 'src/b.tsx', kind: 'import' },
  { from: 'src/a.ts', to: 'src/b.tsx', kind: 're-export' },
  { from: 'src/a.ts', to: 'src/b.tsx', kind: 'import' },
  { from: 'src/c.ts', to: 'src/b.tsx', kind: 'dynamic-import' },
  { from: 'src/entry.ts', to: 'src/c.ts', kind: 'import' },
];
const original = JSON.stringify({ files, edges });
const index = detailIndex(files, edges);
assert.deepEqual(index.outgoing.get('src/a.ts')!.map(row => ({ id: row.file.id, kinds: row.kinds })), [{ id: 'src/b.tsx', kinds: ['import', 're-export'] }]);
assert.equal(index.incoming.get('src/b.tsx')!.length, 2, 'Several import kinds count as one dependent file.');
assert.deepEqual(index.dependedOn.map(item => item.id), ['src/b.tsx', 'src/c.ts']);
assert.deepEqual(index.entryFiles.map(item => item.id), ['src/a.ts', 'src/entry.ts']);
assert.equal(index.unidentified, 4);
assert.deepEqual(detailIndex([...files].reverse(), [...edges].reverse()), index);
const grouped = folderKinds(foldGraph(files, edges).folders[0]);
assert.deepEqual(grouped.map(group => [group.id, group.files.length]), [['ts', 3], ['tsx', 1]]);
assert.deepEqual(grouped.flatMap(group => group.files.map(item => item.id)).sort(), files.map(item => item.id).sort());
assert.equal(JSON.stringify({ files, edges }), original, 'Detail calculations preserve their inputs.');
const annotated = { ...files[0], annotations: { convention: 'known' } };
assert.equal(detailIndex([annotated, ...files.slice(1)], edges).unidentified, 3);
assert.throws(() => detailIndex(files, [{ from: 'missing.ts', to: 'src/a.ts', kind: 'import' }]), /endpoint/);
const fixture = await readParseResult(fileURLToPath(new URL('../lib/canvas/fixture.json', import.meta.url)));
const snapshot = JSON.stringify(fixture);
const real = detailIndex(fixture.files, fixture.edges);
for (const item of fixture.files) {
  assert.equal(real.incoming.get(item.id)!.length, new Set(fixture.edges.filter(edge => edge.to === item.id).map(edge => edge.from)).size);
  assert.equal(real.outgoing.get(item.id)!.length, new Set(fixture.edges.filter(edge => edge.from === item.id).map(edge => edge.to)).size);
}
assert.equal(real.entryFiles.length, fixture.files.filter(item => !fixture.edges.some(edge => edge.to === item.id)).length);
assert.deepEqual(detailIndex([...fixture.files].reverse(), [...fixture.edges].reverse()), real);
for (const folder of foldGraph(fixture.files, fixture.edges).folders) assert.equal(folderKinds(folder).reduce((total, group) => total + group.files.length, 0), folder.files.length);
assert.equal(JSON.stringify(fixture), snapshot);
console.log('Distinct neighbors, observed import kinds, fan-in ranking, entry files, folder kind counts, determinism and immutable inputs passed.');
console.log(`${real.files.size} real fixture files, ${real.dependedOn.length} depended-on files, ${real.entryFiles.length} entry files, ${real.unidentified} unidentified files.`);

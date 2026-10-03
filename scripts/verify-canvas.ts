import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { readParseResult } from '../lib/parser/result-file.ts';
import { foldAtThreshold, foldGraph, selectionScope, uniqueLabels } from '../lib/canvas/model.ts';
import { endpointHandle, folderTopology, layoutGraph, visibleRows } from '../lib/canvas/layout.ts';

const fixture = await readParseResult(fileURLToPath(new URL('../lib/canvas/fixture.json', import.meta.url)));
const originalFixture = JSON.stringify(fixture);
const graph = foldGraph(fixture.files, fixture.edges);
const originalGraph = JSON.stringify({ folders: graph.folders, edges: graph.edges, owner: [...graph.owner] });
assert.equal(fixture.files.length, 255);
assert.equal(fixture.edges.length, 491);
assert.equal(graph.folders.length, 24);
assert.equal(graph.threshold, 5);
assert(graph.folders.every(folder => folder.files.length > 1));
const members = graph.folders.flatMap(folder => folder.files.map(file => file.id)).sort();
assert.deepEqual(members, fixture.files.map(file => file.id).sort());
assert.equal(new Set(members).size, members.length);
for (let threshold = 2; threshold < graph.threshold; threshold++) assert(foldAtThreshold(fixture.files, threshold).size > 24);
assert(graph.edges.every(edge => graph.owner.has(edge.from) && graph.owner.has(edge.to)));
const permuted = foldGraph([...fixture.files].reverse(), [...fixture.edges].reverse());
assert.deepEqual(permuted, graph);
assert.deepEqual(layoutGraph(permuted, new Set()), layoutGraph(graph, new Set()));
const collapsedNodes = layoutGraph(graph, new Set()).map(node => ({ ...node, data: {} }));
const collapsedBounds = getNodesBounds(collapsedNodes);
const initialViewport = getViewportForBounds(collapsedBounds, 876, 720, 0.05, 1, 0.12);
assert(initialViewport.zoom >= 0.85, 'Initial desktop fit keeps 12px labels readable.');
const opening = graph.folders.find(folder => folder.files.length > visibleRows)!;
const expanded = new Set([opening.id]);
assert.deepEqual(layoutGraph(permuted, expanded), layoutGraph(graph, expanded));
const sizes = layoutGraph(graph, expanded);
for (const opened of [new Set<string>(), expanded, new Set(graph.folders.map(folder => folder.id))]) {
  const positioned = layoutGraph(graph, opened);
  assert.deepEqual(positioned, layoutGraph({ ...graph, folders: [...graph.folders].reverse(), edges: [...graph.edges].reverse() }, opened));
  const topology = folderTopology(graph);
  const componentBounds = new Map(topology.components.map(ids => {
    const members = positioned.filter(node => ids.includes(node.id));
    return [ids[0], { left: Math.min(...members.map(node => node.position.x)), right: Math.max(...members.map(node => node.position.x + node.width)) }];
  }));
  for (const edge of graph.edges) {
    const source = topology.owner.get(graph.owner.get(edge.from)!)!;
    const target = topology.owner.get(graph.owner.get(edge.to)!)!;
    if (source !== target) assert(componentBounds.get(source)!.right < componentBounds.get(target)!.left, `Dependency ${edge.from} to ${edge.to} preserves its component layer.`);
  }
  for (let first = 0; first < positioned.length; first++) {
    for (let second = first + 1; second < positioned.length; second++) {
      const a = positioned[first];
      const b = positioned[second];
      assert(a.position.x + a.width + 28 <= b.position.x || b.position.x + b.width + 28 <= a.position.x ||
        a.position.y + a.height + 28 <= b.position.y || b.position.y + b.height + 28 <= a.position.y,
        `Panels ${a.id} and ${b.id} have space between them.`);
    }
  }
}
const openedBounds = getNodesBounds(sizes.map(node => ({ ...node, data: {} })));
assert(getViewportForBounds(openedBounds, 876, 720, 0.05, initialViewport.zoom, 0.12).zoom <= initialViewport.zoom);
assert(sizes.find(node => node.id === opening.id)!.height > layoutGraph(graph, new Set()).find(node => node.id === opening.id)!.height);
assert.equal(endpointHandle(opening, opening.files[0].id, false, 0), 'folder');
assert.equal(endpointHandle(opening, opening.files[0].id, true, 0), opening.files[0].id);
assert.equal(endpointHandle(opening, opening.files[visibleRows].id, true, 0), 'overflow');
assert.equal(endpointHandle(opening, opening.files[visibleRows].id, true, 1), opening.files[visibleRows].id);
assert.equal(endpointHandle(opening, opening.files[visibleRows].id, true, 0, true), opening.files[visibleRows].id);
const selected = opening.files.find(file => graph.edges.some(edge => edge.from === file.id || edge.to === file.id))!;
const fileScope = selectionScope(graph, { kind: 'file', id: selected.id });
assert(fileScope.files.has(selected.id));
graph.edges.forEach((edge, index) => {
  const expected = edge.from === selected.id || edge.to === selected.id;
  assert.equal(fileScope.edges.has(index), expected);
  if (expected) { assert(fileScope.folders.has(graph.owner.get(edge.from)!)); assert(fileScope.folders.has(graph.owner.get(edge.to)!)); }
});
const folderScope = selectionScope(graph, { kind: 'folder', id: opening.id });
graph.edges.forEach((edge, index) => assert.equal(folderScope.edges.has(index), graph.owner.get(edge.from) === opening.id || graph.owner.get(edge.to) === opening.id));
assert.deepEqual([...uniqueLabels(['a/src', 'b/src', 'a/src/index.ts', 'b/src/index.ts'])], [['a/src', 'a/src'], ['b/src', 'b/src'], ['a/src/index.ts', 'a/src/index.ts'], ['b/src/index.ts', 'b/src/index.ts']]);
const rootFile = { ...fixture.files[0], id: 'root.ts', folder: '.' };
const childFiles = fixture.files.slice(0, 3).map((file, index) => ({ ...file, id: `child/${index}.ts`, folder: 'child' }));
const rootGraph = foldGraph([rootFile, ...childFiles], []);
assert.equal(rootGraph.threshold, 4);
assert.equal(rootGraph.folders.length, 1);
assert.equal(rootGraph.folders[0].id, '.');
assert.equal(foldAtThreshold([rootFile, ...childFiles], 2).get('.')!.length, 1);
assert.equal(JSON.stringify(fixture), originalFixture, "Canvas calculations preserve the parser data.");
assert.equal(JSON.stringify({ folders: graph.folders, edges: graph.edges, owner: [...graph.owner] }), originalGraph, "Layout and selection preserve the derived graph.");
console.log(`${fixture.files.length} files, ${graph.folders.length} nodes, threshold ${graph.threshold}, ${fixture.edges.length} real edges.`);
console.log(`Membership ${Math.min(...graph.folders.map(folder => folder.files.length))}–${Math.max(...graph.folders.map(folder => folder.files.length))} files per node. Every file occurs once. Every edge has existing endpoints.`);
console.log('Fresh threshold folding, deterministic layered islands, component direction, expansion endpoints, hidden rows, and exact selection passed.');
console.log(`Collapsed bounds ${collapsedBounds.width} by ${collapsedBounds.height}. Desktop initial zoom ${initialViewport.zoom.toFixed(3)}. Expanded panels do not overlap.`);

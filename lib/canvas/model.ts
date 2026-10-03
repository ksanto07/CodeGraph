import type { Edge, FileNode } from '../parser/types.ts';

export interface FolderNode { id: string; label: string; files: FileNode[]; fanIn: number; fanOut: number }
export interface FolderGraph { folders: FolderNode[]; owner: Map<string, string>; edges: Edge[]; threshold: number }
export type Selection = { kind: 'folder'; id: string } | { kind: 'file'; id: string } | null;
const parent = (id: string) => id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';
const depth = (id: string) => id === '.' ? 0 : id.split('/').length;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function uniqueLabels(ids: readonly string[]): Map<string, string> {
  return new Map(ids.map(id => {
    const parts = id.split('/');
    for (let size = 1; size <= parts.length; size++) {
      const label = parts.slice(-size).join('/');
      if (ids.every(other => other === id || !(other === label || other.endsWith(`/${label}`)))) return [id, label];
    }
    return [id, id];
  }));
}

export function foldAtThreshold(files: readonly FileNode[], threshold: number): Map<string, FileNode[]> {
  const groups = new Map<string, FileNode[]>();
  for (const file of [...files].sort((a, b) => compare(a.id, b.id))) {
    const folder = file.folder || '.';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(file);
    let ancestor = folder;
    while (ancestor !== '.') {
      ancestor = parent(ancestor);
      if (!groups.has(ancestor)) groups.set(ancestor, []);
    }
  }
  const maximum = Math.max(0, ...[...groups.keys()].map(depth));
  for (let level = maximum; level > 0; level--) {
    const merging = [...groups.entries()].filter(([id, members]) => depth(id) === level && members.length < threshold);
    for (const [id, members] of merging) {
      groups.get(parent(id))!.push(...members);
      groups.delete(id);
    }
  }
  for (const [id, members] of groups) if (!members.length) groups.delete(id);
  for (const members of groups.values()) members.sort((a, b) => compare(a.id, b.id));
  return new Map([...groups].sort(([a], [b]) => compare(a, b)));
}

export function foldGraph(files: readonly FileNode[], edges: readonly Edge[], limit = 24): FolderGraph {
  if (files.length < 2) throw new Error("The canvas needs at least two parsed files to form a folder node.");
  let threshold = 2;
  let groups = foldAtThreshold(files, threshold);
  while (groups.size > limit || [...groups.values()].some(members => members.length < 2)) groups = foldAtThreshold(files, ++threshold);
  const owner = new Map([...groups].flatMap(([id, members]) => members.map(file => [file.id, id] as const)));
  const orderedEdges = [...edges].sort((a, b) => compare(`${a.from}\0${a.to}\0${a.kind}`, `${b.from}\0${b.to}\0${b.kind}`));
  for (const edge of orderedEdges) if (!owner.has(edge.from) || !owner.has(edge.to)) throw new Error('Parser edge has no file endpoint.');
  const labels = uniqueLabels([...groups.keys()]);
  const folders = [...groups].map(([id, members]) => ({
    id, label: labels.get(id)!, files: members,
    fanIn: new Set(orderedEdges.filter(edge => owner.get(edge.to) === id && owner.get(edge.from) !== id).map(edge => edge.from)).size,
    fanOut: new Set(orderedEdges.filter(edge => owner.get(edge.from) === id && owner.get(edge.to) !== id).map(edge => edge.to)).size,
  }));
  return { folders, owner, edges: orderedEdges, threshold };
}

export function selectionScope(graph: FolderGraph, selection: Selection) {
  const edges = new Set<number>();
  const folders = new Set<string>();
  const files = new Set<string>();
  if (selection?.kind === 'folder') { folders.add(selection.id); for (const file of graph.folders.find(folder => folder.id === selection.id)?.files ?? []) files.add(file.id); }
  if (selection?.kind === 'file') { files.add(selection.id); folders.add(graph.owner.get(selection.id)!); }
  graph.edges.forEach((edge, index) => {
    const incident = selection?.kind === 'file' ? edge.from === selection.id || edge.to === selection.id :
      selection?.kind === 'folder' && (graph.owner.get(edge.from) === selection.id || graph.owner.get(edge.to) === selection.id);
    if (incident) { edges.add(index); files.add(edge.from); files.add(edge.to); folders.add(graph.owner.get(edge.from)!); folders.add(graph.owner.get(edge.to)!); }
  });
  return { edges, folders, files };
}

export const categories = [
  { id: 'tsx', name: 'React components', color: '#3f8ab5' },
  { id: 'ts', name: 'TypeScript', color: '#8274bd' },
  { id: 'jsx', name: 'JSX components', color: '#b77b40' },
  { id: 'js', name: 'JavaScript', color: '#8a984b' },
] as const;
export function category(file: FileNode) {
  const extension = file.id.split('.').at(-1);
  return categories.find(item => item.id === extension) ?? { id: 'other', name: 'Other scripts', color: '#76818c' };
}

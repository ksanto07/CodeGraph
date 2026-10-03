import type { Edge, FileNode, ImportKind } from '../parser/types.ts';
import { category, type FolderNode } from './model.ts';

export interface Neighbor { file: FileNode; kinds: ImportKind[] }
export interface DetailIndex {
  files: Map<string, FileNode>;
  incoming: Map<string, Neighbor[]>;
  outgoing: Map<string, Neighbor[]>;
  dependedOn: FileNode[];
  entryFiles: FileNode[];
  unidentified: number;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function detailIndex(files: readonly FileNode[], edges: readonly Edge[]): DetailIndex {
  const ordered = [...files].sort((a, b) => compare(a.id, b.id));
  const byId = new Map(ordered.map(file => [file.id, file]));
  const incoming = new Map(ordered.map(file => [file.id, new Map<string, Set<ImportKind>>()]));
  const outgoing = new Map(ordered.map(file => [file.id, new Map<string, Set<ImportKind>>()]));
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error('Detail edge has no file endpoint.');
    for (const [neighbors, id] of [[outgoing.get(edge.from)!, edge.to], [incoming.get(edge.to)!, edge.from]] as const) {
      if (!neighbors.has(id)) neighbors.set(id, new Set());
      neighbors.get(id)!.add(edge.kind);
    }
  }
  const rows = (index: Map<string, Map<string, Set<ImportKind>>>) => new Map([...index].map(([id, neighbors]) => [id, [...neighbors].sort(([a], [b]) => compare(a, b)).map(([neighbor, kinds]) => ({ file: byId.get(neighbor)!, kinds: [...kinds].sort(compare) }))]));
  return {
    files: byId, incoming: rows(incoming), outgoing: rows(outgoing),
    dependedOn: ordered.filter(file => incoming.get(file.id)!.size > 0).sort((a, b) => incoming.get(b.id)!.size - incoming.get(a.id)!.size || compare(a.id, b.id)),
    entryFiles: ordered.filter(file => incoming.get(file.id)!.size === 0).sort((a, b) => outgoing.get(b.id)!.size - outgoing.get(a.id)!.size || compare(a.id, b.id)),
    unidentified: ordered.filter(file => file.annotations.role === 'generic' || Object.keys(file.annotations).length === 0).length,
  };
}
export function folderKinds(folder: FolderNode) {
  const groups = new Map<string, { name: string; files: FileNode[] }>();
  for (const file of folder.files) {
    const kind = category(file);
    if (!groups.has(kind.id)) groups.set(kind.id, { name: kind.name, files: [] });
    groups.get(kind.id)!.files.push(file);
  }
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([id, group]) => ({ id, name: group.name, files: [...group.files].sort((a, b) => compare(a.id, b.id)) }));
}

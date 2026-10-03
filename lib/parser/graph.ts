import type { Edge, FileNode, ImportCoverage, ParseResult } from './types.ts';

export function projectGraph(files: readonly FileNode[], coverage: readonly ImportCoverage[]): { files: FileNode[]; edges: Edge[] } {
  const edges = new Map<string, Edge>();
  for (const item of coverage) {
    if (item.outcome.kind !== 'resolved') continue;
    const edge = { from: item.source, to: item.outcome.target, kind: item.kind };
    edges.set(JSON.stringify([edge.from, edge.to, edge.kind]), edge);
  }
  const sorted = [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of sorted) {
    const inputs = incoming.get(edge.to) ?? new Set<string>();
    inputs.add(edge.from);
    incoming.set(edge.to, inputs);
    const outputs = outgoing.get(edge.from) ?? new Set<string>();
    outputs.add(edge.to);
    outgoing.set(edge.from, outputs);
  }
  return { edges: sorted, files: files.map(file => ({ ...file, fanIn: incoming.get(file.id)?.size ?? 0, fanOut: outgoing.get(file.id)?.size ?? 0 })) };
}

export function summarize(files: readonly FileNode[], skipped: readonly unknown[], coverage: readonly ImportCoverage[]): ParseResult['summary'] {
  const reExports = coverage.filter(item => item.kind === 're-export');
  return { filesFound: files.length + skipped.length, filesParsed: files.length, filesSkipped: skipped.length, folders: new Set(files.map(file => file.folder)).size, reExportsFound: reExports.length, reExportsResolved: reExports.filter(item => item.outcome.kind === 'resolved').length };
}

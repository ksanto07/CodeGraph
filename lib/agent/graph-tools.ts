import { detailIndex } from '../canvas/details.ts';
import { walk } from '../canvas/graph-maths.ts';
import { category } from '../canvas/model.ts';
import type { FrameworkMetadata, FrameworkRoute } from '../adapters/taxonomy.ts';
import type { FileNode, ImportKind, ParseResult } from '../parser/types.ts';

export const graphToolRoles = ['page', 'api', 'action', 'controller', 'service', 'module', 'entity',
  'component', 'hook', 'config', 'route', 'middleware', 'model', 'repository', 'util', 'generic'] as const;
export type GraphToolRole = typeof graphToolRoles[number];
type Direction = 'incoming' | 'outgoing';
export type GraphToolInput =
  | { name: 'analysis_summary'; args: Record<string, never> }
  | { name: 'search_files'; args: { pathPart: string; limit: number } }
  | { name: 'files_by_role'; args: { role: GraphToolRole; limit: number } }
  | { name: 'neighbors'; args: { path: string; direction: Direction; limit: number } }
  | { name: 'walk'; args: { path: string; direction: Direction; depth: number; limit: number } }
  | { name: 'routes'; args: { limit: number } };
export interface FileFact { path: string; lines: number; incoming: number; outgoing: number; role: string | null; category: string }
interface Bounded<T> { items: T[]; total: number; truncated: number }
export type GraphToolResult =
  | { name: 'analysis_summary'; files: number; edges: number; summary: ParseResult['summary'];
      imports: { resolved: number; unresolved: number; excluded: number; outside: number };
      skipped: number; excludedDirectories: number; configDiagnostics: number; routes: number }
  | { name: 'search_files' | 'files_by_role'; files: Bounded<FileFact> }
  | { name: 'neighbors'; path: string; direction: Direction; neighbors: Bounded<FileFact & { kinds: ImportKind[] }> }
  | { name: 'walk'; path: string; direction: Direction; depth: number;
      files: Bounded<FileFact & { depth: number }>; furtherCount: number }
  | { name: 'routes'; routes: Bounded<FrameworkRoute> };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object.');
  return Object.fromEntries(Object.entries(value));
}
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown graph tool argument.');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid graph tool text.');
  return value;
}
function limit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) throw new Error('Tool limit must be between 1 and 100.');
  return value;
}
function direction(value: unknown): Direction {
  if (value !== 'incoming' && value !== 'outgoing') throw new Error('Unknown graph direction.');
  return value;
}
function exactPath(value: unknown): string {
  const result = text(value, 4096);
  if (result.startsWith('/') || result.includes('\\') || /^[A-Za-z]:/.test(result) ||
    result.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('An exact repository file path is required.');
  return result;
}
export function readGraphToolInput(input: unknown): GraphToolInput {
  const request = object(input);
  fields(request, ['name', 'args']);
  const args = object(request.args);
  switch (request.name) {
    case 'analysis_summary': fields(args, []); return { name: request.name, args: {} };
    case 'search_files':
      fields(args, ['pathPart', 'limit']);
      return { name: request.name, args: { pathPart: text(args.pathPart, 256), limit: limit(args.limit) } };
    case 'files_by_role': {
      fields(args, ['role', 'limit']);
      const role = graphToolRoles.find(role => role === args.role);
      if (!role) throw new Error('Unknown graph file role.');
      return { name: request.name, args: { role, limit: limit(args.limit) } };
    }
    case 'neighbors':
      fields(args, ['path', 'direction', 'limit']);
      return { name: request.name, args: { path: exactPath(args.path), direction: direction(args.direction), limit: limit(args.limit) } };
    case 'walk': {
      fields(args, ['path', 'direction', 'depth', 'limit']);
      if (typeof args.depth !== 'number' || !Number.isInteger(args.depth) || args.depth < 0 || args.depth > 5) throw new Error('Walk depth must be between 0 and 5.');
      return { name: request.name, args: { path: exactPath(args.path), direction: direction(args.direction), depth: args.depth, limit: limit(args.limit) } };
    }
    case 'routes': fields(args, ['limit']); return { name: request.name, args: { limit: limit(args.limit) } };
    default: throw new Error('Unknown graph tool.');
  }
}
function bounded<T>(items: T[], limit: number): Bounded<T> {
  return { items: items.slice(0, limit), total: items.length, truncated: Math.max(0, items.length - limit) };
}

export function queryGraphTool(graph: ParseResult, metadata: FrameworkMetadata, input: GraphToolInput): GraphToolResult {
  const index = detailIndex(graph.files, graph.edges);
  const fact = (file: FileNode): FileFact => ({ path: file.id, lines: file.lines,
    incoming: index.incoming.get(file.id)!.length, outgoing: index.outgoing.get(file.id)!.length,
    role: file.annotations.role ?? null, category: category(file).id });
  switch (input.name) {
    case 'analysis_summary': {
      const imports = { resolved: 0, unresolved: 0, excluded: 0, outside: 0 };
      for (const item of graph.coverage) imports[item.outcome.kind]++;
      return { name: input.name, files: graph.files.length, edges: graph.edges.length, summary: { ...graph.summary }, imports,
        skipped: graph.skipped.length, excludedDirectories: graph.excludedDirectories.length,
        configDiagnostics: graph.configDiagnostics.length, routes: metadata.routes.length };
    }
    case 'search_files':
      return { name: input.name, files: bounded([...index.files.values()].filter(file => file.id.includes(input.args.pathPart)).map(fact), input.args.limit) };
    case 'files_by_role':
      return { name: input.name, files: bounded([...index.files.values()].filter(file =>
        (file.annotations.role ?? 'generic') === input.args.role).map(fact), input.args.limit) };
    case 'neighbors': {
      if (!index.files.has(input.args.path)) throw new Error('The tool origin is absent from the parsed graph.');
      return { name: input.name, path: input.args.path, direction: input.args.direction,
        neighbors: bounded(index[input.args.direction].get(input.args.path)!.map(neighbor =>
          ({ ...fact(neighbor.file), kinds: [...neighbor.kinds] })), input.args.limit) };
    }
    case 'walk': {
      const result = walk(index, input.args.path, input.args.direction, input.args.depth);
      const files = result.levels.flatMap(level => level.files.map(file => ({ ...fact(file), depth: level.depth })));
      return { name: input.name, path: input.args.path, direction: input.args.direction, depth: input.args.depth,
        files: bounded(files, input.args.limit), furtherCount: result.furtherCount };
    }
    case 'routes':
      return { name: input.name, routes: bounded([...metadata.routes].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : a.method < b.method ? -1 : a.method > b.method ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
        .map(route => ({ ...route })), input.args.limit) };
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectGraph, summarize } from './graph.ts';
import type { FileNode, ImportKind, ImportOutcome, ParseResult, UnresolvedReason } from './types.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object in parser result.');
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected a string in parser result.'); return value; }
function integer(value: unknown, minimum = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Expected a nonnegative integer in parser result.'); return value; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Expected an array in parser result.'); return value; }
function relative(value: unknown): string {
  const result = string(value);
  if (!result || /^[A-Za-z]:/.test(result) || result.includes('\\') || path.posix.isAbsolute(result) || result === '..' || result.startsWith('../') || path.posix.normalize(result) !== result) throw new Error('Invalid relative path in parser result.');
  return result;
}
function importKind(value: unknown): ImportKind { if (value !== 'import' && value !== 're-export' && value !== 'dynamic-import') throw new Error('Invalid import kind.'); return value; }
function unresolvedReason(value: unknown): UnresolvedReason { if (value !== 'missing-file' && value !== 'missing-package' && value !== 'non-literal' && value !== 'resolver-error') throw new Error('Invalid unresolved reason.'); return value; }
function outcome(value: unknown): ImportOutcome {
  const item = record(value);
  switch (item.kind) {
    case 'resolved': return { kind: 'resolved', target: relative(item.target) };
    case 'outside': return { kind: 'outside', target: string(item.target), reason: string(item.reason) };
    case 'excluded': return { kind: 'excluded', target: relative(item.target), reason: string(item.reason) };
    case 'unresolved': return { kind: 'unresolved', reason: unresolvedReason(item.reason), detail: string(item.detail) };
    default: throw new Error('Invalid coverage outcome.');
  }
}
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`); }

export function validateParseResult(value: unknown): ParseResult {
  const data = record(value);
  if (data.schemaVersion !== 1) throw new Error('Unsupported parser result schema version.');
  const root = string(data.root);
  if (!path.isAbsolute(root) || root.includes('\\') || path.posix.normalize(root) !== root) throw new Error('Invalid repository root.');
  const files = array(data.files).map((value): FileNode => {
    const item = record(value);
    const moduleKind = item.moduleKind;
    if (moduleKind !== 'module' && moduleKind !== 'script') throw new Error('Invalid module kind.');
    const sha256 = string(item.sha256);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid SHA-256.');
    const id = relative(item.id);
    const folder = relative(item.folder);
    if (folder !== path.posix.dirname(id)) throw new Error('File folder does not match its path.');
    const annotations = Object.fromEntries(Object.entries(record(item.annotations)).map(([key, value]) => [key, string(value)]));
    return { id, folder, sha256, moduleKind, annotations, lines: integer(item.lines), fanIn: integer(item.fanIn), fanOut: integer(item.fanOut) };
  });
  const skipped = array(data.skipped).map(value => { const item = record(value); return { path: relative(item.path), reason: string(item.reason), detail: string(item.detail) }; });
  const excludedDirectories = array(data.excludedDirectories).map(value => { const item = record(value); return { path: relative(item.path), reason: string(item.reason) }; });
  const configDiagnostics = array(data.configDiagnostics).map(value => { const item = record(value); return { path: string(item.path), code: integer(item.code), message: string(item.message) }; });
  const edges = array(data.edges).map(value => { const item = record(value); return { from: relative(item.from), to: relative(item.to), kind: importKind(item.kind) }; });
  const coverage = array(data.coverage).map(value => { const item = record(value); return { source: relative(item.source), kind: importKind(item.kind), specifier: string(item.specifier), line: integer(item.line, 1), column: integer(item.column, 1), outcome: outcome(item.outcome) }; });
  unique([...files.map(file => file.id), ...skipped.map(file => file.path)], 'file path');
  unique(excludedDirectories.map(item => item.path), 'excluded directory');
  unique(edges.map(edge => JSON.stringify([edge.from, edge.to, edge.kind])), 'edge');
  unique(coverage.map(item => JSON.stringify([item.source, item.line, item.column])), 'import occurrence');
  const ids = new Set(files.map(file => file.id));
  for (const directory of excludedDirectories) {
    if (directory.path === '.') throw new Error('Repository root cannot be excluded.');
    if ([...files.map(file => file.id), ...skipped.map(file => file.path)].some(id => id === directory.path || id.startsWith(`${directory.path}/`))) throw new Error('Found file is inside an excluded directory.');
  }
  for (const edge of edges) if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error('Edge endpoint is not a node.');
  for (const item of coverage) {
    const source = files.find(file => file.id === item.source);
    if (!source) throw new Error('Coverage source is not a node.');
    if (item.line > source.lines) throw new Error('Coverage line is outside its source.');
    if (item.outcome.kind === 'resolved' && !ids.has(item.outcome.target)) throw new Error('Resolved coverage target is not a node.');
    if (item.outcome.kind === 'excluded' && ids.has(item.outcome.target)) throw new Error('Excluded coverage target is a node.');
  }
  const expected = projectGraph(files, coverage);
  const edgeKeys = (list: typeof edges) => list.map(edge => JSON.stringify([edge.from, edge.to, edge.kind])).sort();
  if (JSON.stringify(edgeKeys(edges)) !== JSON.stringify(edgeKeys(expected.edges))) throw new Error('Edges do not match resolved coverage.');
  for (const [index, file] of files.entries()) if (file.fanIn !== expected.files[index].fanIn || file.fanOut !== expected.files[index].fanOut) throw new Error('Degrees do not match edges.');
  const summaryData = record(data.summary);
  const summary = { filesFound: integer(summaryData.filesFound), filesParsed: integer(summaryData.filesParsed), filesSkipped: integer(summaryData.filesSkipped), folders: integer(summaryData.folders), reExportsFound: integer(summaryData.reExportsFound), reExportsResolved: integer(summaryData.reExportsResolved) };
  if (JSON.stringify(summary) !== JSON.stringify(summarize(files, skipped, coverage))) throw new Error('Summary does not match parser result.');
  return { schemaVersion: 1, root, files, edges, coverage, skipped, excludedDirectories, configDiagnostics, summary };
}
export async function writeParseResult(filename: string, result: ParseResult): Promise<void> { await writeFile(filename, `${JSON.stringify(validateParseResult(result), null, 2)}\n`); }
export async function readParseResult(filename: string): Promise<ParseResult> { const value: unknown = JSON.parse(await readFile(filename, 'utf8')); return validateParseResult(value); }

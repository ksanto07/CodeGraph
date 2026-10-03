export type ImportKind = 'import' | 're-export' | 'dynamic-import' | 'require';
export type UnresolvedReason = 'missing-file' | 'missing-package' | 'non-literal' | 'resolver-error';
export interface FileNode {
  id: string;
  folder: string;
  lines: number;
  sha256: string;
  moduleKind: 'module' | 'script';
  fanIn: number;
  fanOut: number;
  annotations: Readonly<Record<string, string>>;
  exportNames?: string[];
}
export interface Edge { from: string; to: string; kind: ImportKind }
export type ImportOutcome =
  | { kind: 'resolved'; target: string }
  | { kind: 'outside'; target: string; reason: string }
  | { kind: 'excluded'; target: string; reason: string }
  | { kind: 'unresolved'; reason: UnresolvedReason; detail: string };
export interface ImportCoverage {
  source: string;
  kind: ImportKind;
  specifier: string;
  line: number;
  column: number;
  outcome: ImportOutcome;
}
export interface SkippedFile { path: string; reason: string; detail: string }
export interface ExcludedDirectory { path: string; reason: string }
export interface ConfigDiagnostic { path: string; code: number; message: string }
export interface ParseResult {
  schemaVersion: 1;
  root: string;
  files: FileNode[];
  edges: Edge[];
  coverage: ImportCoverage[];
  skipped: SkippedFile[];
  excludedDirectories: ExcludedDirectory[];
  configDiagnostics: ConfigDiagnostic[];
  summary: {
    filesFound: number;
    filesParsed: number;
    filesSkipped: number;
    folders: number;
    reExportsFound: number;
    reExportsResolved: number;
  };
}
export interface FrameworkAdapter {
  readonly id: string;
  annotate(file: Readonly<FileNode>): Readonly<Record<string, string>>;
}
export const noFrameworkAdapter: FrameworkAdapter = { id: 'none', annotate: () => ({}) };

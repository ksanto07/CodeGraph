import type { ParseResult } from '@/lib/parser/types';

export function CoverageBanner({ graph }: { graph: ParseResult }) {
  const unresolved = graph.coverage.filter(item => item.outcome.kind === 'unresolved');
  const excluded = graph.coverage.filter(item => item.outcome.kind === 'excluded');
  const denominator = graph.coverage.length;
  const percent = denominator ? Math.round((denominator - unresolved.length - excluded.length) / denominator * 100) : 100;
  const incomplete = percent < 95 || graph.skipped.some(file => file.reason !== 'unsupported-extension') || graph.configDiagnostics.length > 0;
  return <details className={`coverage-banner ${incomplete ? 'partial-coverage' : ''}`}>
    <summary>{incomplete ? 'Partial graph' : 'Import coverage'} · {percent}% of {denominator} observed imports accounted for · {graph.summary.filesParsed} source files parsed</summary>
    <p>{unresolved.length} unresolved imports, {excluded.length} imports to excluded files, {graph.skipped.length} skipped files, {graph.configDiagnostics.length} configuration diagnostics. External dependencies are accounted for but are not graph nodes.</p>
    <p>{denominator === 0 ? 'No imports were observed; this does not prove that the repository has no dependencies.' : 'Unresolved imports produce no edges.'}</p>
    {unresolved.slice(0, 5).map(item => <p key={`${item.source}:${item.line}:${item.column}`}><code>{item.source}:{item.line}</code> · {item.specifier} · {item.outcome.kind === 'unresolved' && item.outcome.detail}</p>)}
    {graph.skipped.filter(file => file.reason !== 'unsupported-extension').slice(0, 5).map(file => <p key={file.path}><code>{file.path}</code> · {file.reason} · {file.detail}</p>)}
  </details>;
}

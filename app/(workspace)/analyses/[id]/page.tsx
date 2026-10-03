import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAnalysis } from '@/lib/analysis';
import { GraphCanvas } from '@/components/canvas/graph-canvas';
import { CoverageBanner } from '@/components/canvas/coverage-banner';
import { AnalysisProgress } from '@/components/analysis-progress';
import { rerunAnalysis } from '../actions';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const analysis = await loadAnalysis(id);
  if (!analysis) notFound();
  const { graph, progress } = analysis;
  return <main className="analysis-explorer">
    <header className="analysis-toolbar"><Link href="/">All analyses</Link><code>{analysis.repository}</code>{analysis.commit && <span title={analysis.commit}>Commit {analysis.commit.slice(0, 8)}</span>}<form action={rerunAnalysis.bind(null, id)}><button>Re-analyze</button></form></header>
    {graph ? <><CoverageBanner graph={graph} />{graph.files.length < 2 ? <p className="pipeline-progress">{graph.files.length} source files parsed. At least two are needed for a folder map. The coverage details above explain what was skipped.</p> : <div className="preview-shell"><GraphCanvas files={graph.files} edges={graph.edges} repositoryName={analysis.repository} coverage={{ skipped: graph.skipped.length, unresolved: graph.coverage.filter(item => item.outcome.kind === 'unresolved').length, diagnostics: graph.configDiagnostics.length }} /></div>}</> : <AnalysisProgress key={progress.updatedAt} initial={progress} />}
  </main>;
}

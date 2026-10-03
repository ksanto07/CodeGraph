import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAnalysisAI } from '@/lib/ai/service';
import { GraphCanvas } from '@/components/canvas/graph-canvas';
import { CoverageBanner } from '@/components/canvas/coverage-banner';
import { AnalysisProgress } from '@/components/analysis-progress';
import { AnalysisAIStatus } from '@/components/analysis-ai-status';
import { rerunAnalysis } from '../actions';

export const maxDuration = 660;

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const analysis = await loadAnalysisAI(id);
  if (!analysis) notFound();
  const { graph, progress } = analysis;
  return <main className="analysis-explorer">
    <header className="analysis-toolbar"><Link href="/">All analyses</Link><code>{analysis.repository}</code>{analysis.commit && <span title={analysis.commit}>Commit {analysis.commit.slice(0, 8)}</span>}<form action={rerunAnalysis.bind(null, id)}><button>Re-analyze</button></form></header>
    {graph ? <><AnalysisAIStatus ai={analysis.ai} /><CoverageBanner graph={graph} />{graph.files.length < 2 ? <p className="pipeline-progress">{graph.files.length} source files parsed. At least two are needed for a folder map. The coverage details above explain what was skipped.</p> : <div className="preview-shell"><GraphCanvas key={`${id}:${analysis.attempt}:${analysis.ai.explanationModel}`} analysisId={id} attempt={analysis.attempt} ai={analysis.ai} explanations={analysis.explanations} classifiedCount={Object.keys(analysis.roles).length} metadata={analysis.metadata} files={graph.files} edges={graph.edges} repositoryName={analysis.repository} coverage={{ skipped: graph.skipped.length, unresolved: graph.coverage.filter(item => item.outcome.kind === 'unresolved').length, diagnostics: graph.configDiagnostics.length }} /></div>}</> : <AnalysisProgress key={progress.updatedAt} initial={progress} />}
  </main>;
}

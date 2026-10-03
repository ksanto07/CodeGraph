import { GraphCanvas } from '@/components/canvas/graph-canvas';
import { fixture } from '@/lib/canvas/fixture';

export default function PreviewPage() {
  const unresolved = fixture.coverage.filter(item => item.outcome.kind === 'unresolved').length;
  return <main className="preview-shell">
    <GraphCanvas files={fixture.files} edges={fixture.edges} repositoryName="xyflow/packages" coverage={{ skipped: fixture.skipped.length, unresolved, diagnostics: fixture.configDiagnostics.length }} />
  </main>;
}

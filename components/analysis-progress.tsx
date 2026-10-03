'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnalysisLive } from './analysis-live';
import { stages, staleProgress, type AnalysisProgress as Progress } from '@/lib/pipeline/progress';

export function AnalysisProgress({ initial }: { initial: Progress }) {
  const [progress, setProgress] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const receive = useCallback((event: Progress) => setProgress(previous => Date.parse(event.updatedAt) >= Date.parse(previous.updatedAt) ? event : previous), []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const stale = staleProgress(progress, now);
  return <section className="pipeline-progress" aria-label="Repository analysis progress">
    <AnalysisLive analysisId={initial.id} onProgress={receive} />
    <ol>{stages.map((stage, index) => <li key={stage} aria-current={stage === progress.stage ? 'step' : undefined} data-passed={index < stages.indexOf(progress.stage)}>{stage === 'fetch' ? 'Fetch repository' : stage === 'select' ? 'Select source files' : stage === 'parse' ? 'Parse imports' : 'Store map'}</li>)}</ol>
    <p role="status">{progress.message}</p>
    {progress.state === 'failed' && <p className="pipeline-error">Failed during {progress.stage}. You can retry from this analysis.</p>}
    {stale && <p className="pipeline-error">This run has not advanced for five minutes and may have stopped. Retry to start a new run.</p>}
  </section>;
}

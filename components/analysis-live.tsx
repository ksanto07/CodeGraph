'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readProgress } from '@/lib/pipeline/progress';

export function AnalysisLive({ analysisId, onProgress }: { analysisId?: string; onProgress?: (event: ReturnType<typeof readProgress>) => void }) {
  const { orgId, userId } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    const stream = new EventSource(analysisId ? `/api/progress?analysis=${encodeURIComponent(analysisId)}` : '/api/progress');
    stream.addEventListener('progress', event => {
      try {
        const progress = readProgress(JSON.parse(event.data));
        if (analysisId && progress.id !== analysisId) throw new Error('Progress belongs to a different analysis.');
        onProgress?.(progress);
        if (!analysisId || progress.state === 'completed' || progress.state === 'failed') router.refresh();
      } catch { setError('The progress stream returned invalid data. Reload this page.'); }
    });
    stream.addEventListener('ready', () => { setError(null); router.refresh(); });
    stream.addEventListener('error', () => setError('Live progress is disconnected. Reload to reconnect.'));
    return () => { stream.close(); };
  }, [analysisId, orgId, userId, router, onProgress]);
  return error ? <p role="alert" className="pipeline-error">{error}</p> : null;
}

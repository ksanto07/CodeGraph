'use client';

import { useAuth } from '@clerk/nextjs';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readProgress } from '@/lib/pipeline/progress';

export function AnalysisLive({ analysisId, onProgress }: { analysisId?: string; onProgress?: (event: ReturnType<typeof readProgress>) => void }) {
  const { getToken, orgId } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Missing realtime database configuration.');
    const client = createClient(url, key, { accessToken: () => getToken(), auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const channel = client.channel(analysisId ? `analysis:${analysisId}` : `organization:${orgId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'progress' }, event => {
      try {
        const progress = readProgress(event.payload);
        if (analysisId && progress.id !== analysisId) throw new Error('Progress belongs to a different analysis.');
        onProgress?.(progress);
        if (!analysisId || progress.state === 'completed' || progress.state === 'failed') router.refresh();
      } catch { setError('The progress stream returned invalid data. Reload this page.'); }
    });
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { setError(null); router.refresh(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Live progress is disconnected. Reload to reconnect.');
    });
    return () => { void client.removeChannel(channel); };
  }, [analysisId, orgId, getToken, router, onProgress]);
  return error ? <p role="alert" className="pipeline-error">{error}</p> : null;
}

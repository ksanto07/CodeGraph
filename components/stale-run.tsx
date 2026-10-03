'use client';

import { useEffect, useState } from 'react';
import type { AnalysisState } from '@/lib/analysis-state';

export function StaleRun({ state, updatedAt }: { state: AnalysisState; updatedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return (state === 'queued' || state === 'running') && now - Date.parse(updatedAt) > 5 * 60_000 ? <span className="stale-run">Stale · no progress for five minutes</span> : null;
}

export const stages = ['fetch', 'select', 'parse', 'store'] as const;
export type PipelineStage = typeof stages[number];
export interface AnalysisProgress {
  id: string;
  state: 'queued' | 'running' | 'completed' | 'failed';
  stage: PipelineStage;
  message: string;
  updatedAt: string;
}
export function readProgress(value: unknown): AnalysisProgress {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
    !('state' in value) || (value.state !== 'queued' && value.state !== 'running' && value.state !== 'completed' && value.state !== 'failed') ||
    !('stage' in value) || (value.stage !== 'fetch' && value.stage !== 'select' && value.stage !== 'parse' && value.stage !== 'store') ||
    !('message' in value) || typeof value.message !== 'string' || !('updatedAt' in value) || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new Error('Invalid analysis progress event.');
  }
  return { id: value.id, state: value.state, stage: value.stage, message: value.message, updatedAt: value.updatedAt };
}
export function staleProgress(progress: AnalysisProgress, now = Date.now()): boolean {
  return (progress.state === 'queued' || progress.state === 'running') && now - Date.parse(progress.updatedAt) > 5 * 60_000;
}

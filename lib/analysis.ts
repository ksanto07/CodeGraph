import 'server-only';
import { createSupabaseClient } from './supabase';
import { validateParseResult } from './parser/result-file';
import { readProgress } from './pipeline/progress';

export async function loadAnalysis(id: string) {
  const client = await createSupabaseClient();
  const { data, error } = await client.from('analyses').select('id,state,stage,message,updated_at,commit_sha,project:projects!analyses_project_fk(repository)').eq('id', id).eq('is_seed', false).maybeSingle();
  if (error) throw new Error('Could not load the analysis.', { cause: error });
  if (!data?.project) return null;
  const progress = readProgress({ id: data.id, state: data.state, stage: data.stage, message: data.message, updatedAt: data.updated_at });
  if (data.state !== 'completed') return { repository: data.project.repository, progress, graph: null, commit: null };
  const { data: graph, error: graphError } = await client.rpc('analysis_graph', { analysis_id: id });
  if (graphError) throw new Error('Could not load the repository graph.', { cause: graphError });
  return { repository: data.project.repository, progress, graph: validateParseResult(graph), commit: data.commit_sha };
}

import 'server-only';
import { loadAnalysis } from '../analysis';
import { createSupabaseClient } from '../supabase';
import { requireWorkspace } from '../workspace';
import { pipelineWriteCredential } from '../pipeline/write-credential';
import type { FileNode } from '../parser/types';
import { foldGraph } from '../canvas/model';
import { runAI, tracingConfigured, type AICache, type AIRequest } from './client';
import {
  explanationContext, explanationKey, explanationInstructions, explanationPromptVersion,
  classificationInstructions, classificationPromptVersion, readSemanticRole, semanticRoles,
  type ExplainTarget, type ExplanationContext, type SemanticRole,
} from './context';
import { checkFreshness, type Freshness } from './freshness';
import { accessTokenCredential, getLocalChatGPTStatus, listLocalChatGPTModels, LocalChatGPTError, type LocalChatGPTStatus } from './local-auth';
import { requireLocalAIRequest } from './local-request';

type Analysis = NonNullable<Awaited<ReturnType<typeof loadAnalysis>>>;
type CompletedAnalysis = Analysis & { graph: NonNullable<Analysis['graph']>; commit: string };
export interface CachedExplanation { target: ExplainTarget; key: string; body: string }
export interface AIAvailability { explanationModel: string | null; classificationModel: string | null; tracing: boolean; connectionStatus: LocalChatGPTStatus | null; messages: string[] }
export type AnalysisAIView = Analysis & {
  explanations: CachedExplanation[]; roles: Record<string, SemanticRole>; ai: AIAvailability;
};
export type ExplanationResult =
  | { status: 'ok'; target: ExplainTarget; key: string; model: string; body: string; cached: boolean; tracing: boolean; freshness: Freshness }
  | { status: 'unavailable' | 'error'; message: string };
export interface ClassificationResult { status: 'ok' | 'unavailable' | 'error'; roles: Record<string, SemanticRole>; remaining: number; processed: number; message?: string }
const inflight = new Map<string, Promise<{ body: string; cached: boolean; tracing: boolean }>>();
const generic = (file: FileNode) => file.annotations.role === 'generic' || !file.annotations.role;

function modelPin(name: 'CARTOGRAPH_EXPLANATION_MODEL' | 'CARTOGRAPH_CLASSIFICATION_MODEL'): string | null {
  const value = process.env[name]?.trim();
  return value && /^.+-\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function targetFrom(input: unknown): ExplainTarget {
  if (!input || typeof input !== 'object' || !('kind' in input) || !('id' in input) ||
    (input.kind !== 'file' && input.kind !== 'folder') || typeof input.id !== 'string' || !input.id || input.id.length > 4096) {
    throw new LocalChatGPTError('invalid_target', 'Select a file or folded folder from this analysis.');
  }
  return { kind: input.kind, id: input.id };
}
function completed(analysis: Analysis | null): CompletedAnalysis {
  if (!analysis?.graph || !analysis.commit) throw new LocalChatGPTError('analysis_unavailable', 'The completed repository graph is unavailable.');
  return { ...analysis, graph: analysis.graph, commit: analysis.commit };
}
function requestFor(context: ExplanationContext, model: string, classification = false): AIRequest {
  const operation = classification ? 'classify-file' : context.target.kind === 'file' ? 'explain-file' : 'explain-folder';
  const version = classification ? classificationPromptVersion : explanationPromptVersion;
  return { operation, model, key: explanationKey(context, model, version),
    instructions: classification ? classificationInstructions : explanationInstructions, input: JSON.stringify(context) };
}
function safeFailure(error: unknown): { status: 'unavailable' | 'error'; message: string } {
  if (error instanceof LocalChatGPTError) return { status: 'unavailable', message: error.message };
  return { status: 'error', message: 'The AI request could not complete. Check the local connection and applied cache migration, then try again.' };
}
async function availability(userId: string): Promise<AIAvailability> {
  const explanationModel = modelPin('CARTOGRAPH_EXPLANATION_MODEL');
  const classificationModel = modelPin('CARTOGRAPH_CLASSIFICATION_MODEL');
  const messages: string[] = [];
  if (!explanationModel) messages.push('Configure CARTOGRAPH_EXPLANATION_MODEL with an exact dated model from the connected account catalog.');
  if (!classificationModel) messages.push('Configure CARTOGRAPH_CLASSIFICATION_MODEL with an exact dated model from the connected account catalog.');
  const tracing = tracingConfigured();
  if (!tracing) messages.push('AI tracing is not configured. Calls still work without traces.');
  let connectionStatus: LocalChatGPTStatus | null = null;
  try { await requireLocalAIRequest('read'); connectionStatus = await getLocalChatGPTStatus(userId); }
  catch (error) { messages.push(error instanceof LocalChatGPTError ? error.message : 'The local ChatGPT connection could not be read.'); }
  return { explanationModel, classificationModel, tracing, connectionStatus, messages };
}

export async function loadAnalysisAI(id: string): Promise<AnalysisAIView | null> {
  const { userId } = await requireWorkspace();
  const analysis = await loadAnalysis(id);
  if (!analysis) return null;
  const ai = await availability(userId);
  const explanations: CachedExplanation[] = [];
  const roles: Record<string, SemanticRole> = {};
  if (!analysis.graph || !analysis.commit) return { ...analysis, explanations, roles, ai };
  const client = await createSupabaseClient();
  const [explanationRows, roleRows] = await Promise.all([
    client.from('explanations').select('target_kind,target_path,content_key,model,prompt_version,body').eq('analysis_id', id).order('created_at', { ascending: false }).limit(10000),
    client.from('file_roles').select('role,content_key,model,prompt_version,source,file:files!file_roles_file_fk(path)').eq('analysis_id', id).order('created_at', { ascending: false }).limit(10000),
  ]);
  if (explanationRows.error || roleRows.error) {
    ai.messages.push('Stored AI results could not be loaded. Apply the AI cache migration and reload.');
    return { ...analysis, explanations, roles, ai };
  }
  if (explanationRows.data.length === 10000 || roleRows.data.length === 10000) ai.messages.push('Only the latest 10,000 stored results were loaded.');
  const filePaths = new Set(analysis.graph.files.map(file => file.id));
  const folderPaths = new Set(foldGraph(analysis.graph.files, analysis.graph.edges).folders.map(folder => folder.id));
  for (const row of explanationRows.data) {
    if (!ai.explanationModel || row.model !== ai.explanationModel || row.prompt_version !== explanationPromptVersion || !row.target_path || !row.content_key) continue;
    if (row.target_kind !== 'file' && row.target_kind !== 'folder') continue;
    if (!(row.target_kind === 'file' ? filePaths : folderPaths).has(row.target_path)) continue;
    const target: ExplainTarget = { kind: row.target_kind, id: row.target_path };
    const context = explanationContext(analysis.graph.files, analysis.graph.edges, target);
    if (requestFor(context, ai.explanationModel).key === row.content_key) explanations.push({ target, key: row.content_key, body: row.body });
  }
  for (const row of roleRows.data) {
    if (!ai.classificationModel || row.model !== ai.classificationModel || row.prompt_version !== classificationPromptVersion || row.source !== 'ai' || !row.file) continue;
    const file = analysis.graph.files.find(file => file.id === row.file?.path);
    if (!file || !generic(file)) continue;
    const role = semanticRoles.find(role => role === row.role);
    if (!role) { ai.messages.push('An unsupported saved file role was omitted.'); continue; }
    const context = explanationContext(analysis.graph.files, analysis.graph.edges, { kind: 'file', id: file.id });
    if (requestFor(context, ai.classificationModel, true).key === row.content_key) roles[file.id] = role;
  }
  return { ...analysis, graph: { ...analysis.graph, files: analysis.graph.files.map(file => roles[file.id] ? { ...file, annotations: { ...file.annotations, role: roles[file.id] } } : file) }, explanations, roles, ai };
}

async function inference(id: string, analysis: CompletedAnalysis, context: ExplanationContext, request: AIRequest, userId: string) {
  const client = await createSupabaseClient();
  const classification = request.operation === 'classify-file';
  const cache: AICache = {
    async read(key) {
      const query = classification
        ? client.from('file_roles').select('role').eq('analysis_id', id).eq('content_key', key).maybeSingle()
        : client.from('explanations').select('body').eq('analysis_id', id).eq('content_key', key).maybeSingle();
      const { data, error } = await query;
      if (error) throw new Error('Could not read the AI cache.', { cause: error });
      return data ? 'body' in data ? data.body : data.role : null;
    },
    async write(key, body) {
      const write_secret = pipelineWriteCredential();
      const common = { analysis_id: id, expected_attempt: analysis.attempt, content_key: key, model: request.model, analyzed_commit: analysis.commit, write_secret };
      const { data, error } = classification
        ? await client.rpc('write_file_role', { ...common, prompt_version: classificationPromptVersion, file_path: context.target.id, role: readSemanticRole(body) })
        : await client.rpc('write_explanation', { ...common, prompt_version: explanationPromptVersion, target_kind: context.target.kind, target_path: context.target.id, target_members: context.members.map(file => file.id), body });
      if (error) throw new Error('Could not publish the AI cache.', { cause: error });
      return data;
    },
  };
  return runAI(request, cache, { credential: async () => {
    await requireLocalAIRequest('mutation');
    const models = await listLocalChatGPTModels(userId);
    if (!models.some(model => model.slug === request.model)) throw new LocalChatGPTError('model_unavailable', 'The configured exact model is absent from this connected account catalog.');
    return accessTokenCredential(userId);
  } });
}

export async function explainAnalysis(id: string, input: unknown): Promise<ExplanationResult> {
  const { userId } = await requireWorkspace();
  try {
    const analysis = completed(await loadAnalysis(id));
    const target = targetFrom(input);
    const context = explanationContext(analysis.graph.files, analysis.graph.edges, target);
    const model = modelPin('CARTOGRAPH_EXPLANATION_MODEL');
    if (!model) throw new LocalChatGPTError('model_unconfigured', 'Configure CARTOGRAPH_EXPLANATION_MODEL with an exact dated model from the connected account catalog.');
    const request = requestFor(context, model);
    const result = await inference(id, analysis, context, request, userId);
    const freshness = await checkFreshness(analysis.repository, analysis.commit, context.members);
    return { status: 'ok', target, key: request.key, model, ...result, freshness };
  } catch (error) { return safeFailure(error); }
}

export async function classifyGenericFiles(id: string): Promise<ClassificationResult> {
  const { userId } = await requireWorkspace();
  const roles: Record<string, SemanticRole> = {};
  let remaining = 0;
  let processed = 0;
  try {
    const analysis = completed(await loadAnalysis(id));
    const model = modelPin('CARTOGRAPH_CLASSIFICATION_MODEL');
    if (!model) throw new LocalChatGPTError('model_unconfigured', 'Configure CARTOGRAPH_CLASSIFICATION_MODEL with an exact dated model from the connected account catalog.');
    const hydrated = await loadAnalysisAI(id);
    if (!hydrated || hydrated.attempt !== analysis.attempt || !hydrated.graph) throw new LocalChatGPTError('analysis_changed', 'The analysis changed during classification. Reload its current map.');
    Object.assign(roles, hydrated?.roles);
    const pending = analysis.graph.files.filter(file => generic(file) && !roles[file.id]);
    remaining = pending.length;
    for (const file of pending.slice(0, 8)) {
      const context = explanationContext(analysis.graph.files, analysis.graph.edges, { kind: 'file', id: file.id });
      const request = requestFor(context, model, true);
      const flightKey = `${userId}:${id}:${analysis.attempt}:${request.key}`;
      let operation = inflight.get(flightKey);
      if (!operation) {
        operation = inference(id, analysis, context, request, userId);
        inflight.set(flightKey, operation);
      }
      try { roles[file.id] = readSemanticRole((await operation).body); remaining--; processed++; }
      finally { if (inflight.get(flightKey) === operation) inflight.delete(flightKey); }
    }
    return { status: 'ok', roles, remaining, processed };
  } catch (error) { return { ...safeFailure(error), roles, remaining, processed }; }
}

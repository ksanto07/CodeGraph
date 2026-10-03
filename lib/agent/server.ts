import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { requireWorkspace } from '../workspace';
import { createSupabaseClient } from '../supabase';
import { loadAnalysisAI } from '../ai/service';
import { accessTokenCredential, listLocalChatGPTModels } from '../ai/local-auth';
import { DelegationRegistry } from './delegation-registry';
import { appOrigin, RuntimeIdentity } from './runtime-identity';
import { queryGraphTool, type GraphToolInput } from './graph-tools';
import { validateParseResult } from '../parser/result-file';
import { readFrameworkMetadata } from '../adapters/metadata';
import { currentRole } from '../ai/current-roles';
import { classificationPromptVersion } from '../ai/context';
import { explanationContext, type ExplainTarget } from '../ai/context';

type Client = Awaited<ReturnType<typeof createSupabaseClient>>;
interface Conversation {
  analysis: string; organization: string; user: string; attempt: string; commit: string;
  thread: string; principal: string; expires: number; activeRun: string | null; opened: boolean;
}
interface RunAuthority { conversation: Conversation; client: Client; session: string; abort: AbortController; cache: Map<string, string> }
interface Broker { delegations: DelegationRegistry<RunAuthority>; identity: RuntimeIdentity; conversations: Map<string, Conversation> }
declare global { var cartographAgentBroker: Broker | undefined; }
const broker = globalThis.cartographAgentBroker ??= { delegations: new DelegationRegistry<RunAuthority>(), identity: new RuntimeIdentity(), conversations: new Map<string, Conversation>() };
export const agentJWKS = () => broker.identity.jwks();

export function requireBrokerHost(request: Request) {
  if (process.env.CARTOGRAPH_LOCAL_AI !== '1' || request.headers.get('host') !== new URL(appOrigin()).host ||
    request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('The agent gateway is local only.');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== appOrigin()) throw new Error('The agent gateway requires its configured origin.');
}

export async function beginQuestion(analysis: string, thread?: string, selection?: ExplainTarget) {
  const workspace = await requireWorkspace();
  if (!workspace.sessionId) throw new Error('A signed-in session is required.');
  const view = await loadAnalysisAI(analysis);
  if (!view?.graph || !view.commit) throw new Error('The completed analysis is unavailable.');
  if (selection) explanationContext(view.graph.files, view.graph.edges, selection);
  for (const [id, entry] of broker.conversations) if (!entry.activeRun && entry.expires <= Date.now()) broker.conversations.delete(id);
  let conversation = thread ? broker.conversations.get(thread) : undefined;
  if (thread && !conversation) throw new Error('This conversation has expired. Start a new question.');
  if (conversation && (conversation.analysis !== analysis || conversation.user !== workspace.userId ||
    conversation.organization !== workspace.orgId || conversation.attempt !== view.attempt || conversation.commit !== view.commit)) {
    throw new Error('The conversation no longer belongs to this analysis.');
  }
  if (conversation?.activeRun) throw new Error('Wait for the current answer or cancel it.');
  if (!conversation) {
    if (broker.conversations.size >= 64) {
      let oldestIdle: Conversation | undefined;
      for (const entry of broker.conversations.values()) {
        if (!entry.activeRun && (!oldestIdle || entry.expires < oldestIdle.expires)) oldestIdle = entry;
      }
      if (!oldestIdle) throw new Error('All question slots are occupied. Try again later.');
      broker.conversations.delete(oldestIdle.thread);
    }
    conversation = { analysis, organization: workspace.orgId, user: workspace.userId, attempt: view.attempt,
      commit: view.commit, thread: randomUUID(), principal: randomBytes(32).toString('hex'), expires: Date.now() + 30 * 60_000, activeRun: null, opened: false };
    broker.conversations.set(conversation.thread, conversation);
  }
  const fresh = !conversation.opened;
  const run = randomBytes(32).toString('hex');
  conversation.activeRun = run;
  const expires = Date.now() + 300_000;
  let issued: Awaited<ReturnType<DelegationRegistry<RunAuthority>['issue']>>;
  let value: RunAuthority;
  try {
    value = { conversation, client: await createSupabaseClient(), session: workspace.sessionId, abort: new AbortController(), cache: new Map() };
    issued = await broker.delegations.issue({ analysis, organization: workspace.orgId, user: workspace.userId,
      attempt: view.attempt, commit: view.commit, thread: conversation.thread }, value);
  } catch (error) { if (conversation.activeRun === run) conversation.activeRun = null; throw error; }
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true; clearTimeout(deadline); issued.revoke(); value.abort.abort(); value.cache.clear();
    if (conversation.activeRun === run) { conversation.activeRun = null; conversation.expires = Date.now() + 30 * 60_000; }
  };
  const deadline = setTimeout(done, 300_000);
  deadline.unref();
  try {
    const nativeBearer = await broker.identity.issue(conversation.principal, conversation.thread, expires);
    return { thread: conversation.thread, fresh, runHandle: randomBytes(32).toString('hex'), expires,
      toolBearer: issued.token, nativeBearer, signal: value.abort.signal, done, opened: () => { conversation.opened = true; } };
  } catch (error) { done(); throw error; }
}

export async function resolveQuestion(token: string) {
  const { value, scope, revoke } = await broker.delegations.resolve(token);
  const clerk = await clerkClient();
  const [session, membership, analysis] = await Promise.all([
    clerk.sessions.getSession(value.session),
    clerk.organizations.getOrganizationMembershipList({ organizationId: scope.organization, userId: [scope.user], limit: 1 }),
    value.client.from('analyses').select('id,state,attempt_id,commit_sha').eq('id', scope.analysis).eq('is_seed', false).maybeSingle(),
  ]);
  if (value.abort.signal.aborted || session.status !== 'active' || session.userId !== scope.user || !membership.data.length ||
    analysis.error || !analysis.data || analysis.data.state !== 'completed' || analysis.data.attempt_id !== scope.attempt || analysis.data.commit_sha !== scope.commit) {
    value.abort.abort(); revoke();
    throw new Error('This repository question is no longer authorized.');
  }
  return { value, scope };
}

export async function executeQuestionTool(token: string, input: GraphToolInput) {
  const { value, scope } = await resolveQuestion(token);
  const { data, error } = await value.client.rpc('analysis_graph', { analysis_id: scope.analysis });
  if (error) throw new Error('The repository facts are unavailable.');
  const graph = validateParseResult(data);
  const metadata = readFrameworkMetadata(data && typeof data === 'object' && !Array.isArray(data) ? data.frameworkMetadata : undefined, graph.files);
  const model = process.env.CARTOGRAPH_CLASSIFICATION_MODEL;
  if (model) {
    const { data: roles, error: roleError } = await value.client.from('file_roles')
      .select('role,content_key,model,prompt_version,analyzed_commit,file:files!file_roles_file_fk(path)')
      .eq('analysis_id', scope.analysis).eq('model', model).eq('prompt_version', classificationPromptVersion)
      .eq('analyzed_commit', scope.commit).eq('source', 'ai').order('created_at', { ascending: false }).limit(10000);
    if (roleError) throw new Error('The current file roles are unavailable.');
    const overlay = new Map((roles ?? []).flatMap(row => {
      const role = currentRole(graph.files, graph.edges, scope.commit, row, model);
      return role && row.file ? [[row.file.path, role] as const] : [];
    }));
    graph.files = graph.files.map(file => overlay.has(file.id)
      ? { ...file, annotations: { ...file.annotations, role: overlay.get(file.id)! } } : file);
  }
  return queryGraphTool(graph, metadata, input);
}

export async function questionModelConnection(token: string) {
  const { value, scope } = await resolveQuestion(token);
  const model = process.env.CARTOGRAPH_AGENT_MODEL?.trim();
  if (!model) throw new Error('Configure the agent model from the connected catalog.');
  return { model, cache: value.cache, signal: value.abort.signal, connection: { credential: async () => {
    await resolveQuestion(token);
    const models = await listLocalChatGPTModels(scope.user);
    if (!models.some(item => item.slug === model)) throw new Error('The agent model is unavailable in the connected account.');
    return accessTokenCredential(scope.user);
  } } };
}

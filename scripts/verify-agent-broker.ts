import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

declare module 'node:module' {
  interface BrokerResolution { url: string; shortCircuit?: boolean }
  interface BrokerResolutionContext { parentURL?: string }
  function registerHooks(hooks: { resolve: (specifier: string, context: BrokerResolutionContext,
    nextResolve: (specifier: string, context: BrokerResolutionContext) => BrokerResolution) => BrokerResolution }): { deregister: () => void };
}

interface Fixture {
  workspace: { userId: string; orgId: string; sessionId: string };
  view: { graph: { files: never[]; edges: never[] }; commit: string; attempt: string };
  gate: Promise<void>;
  membership: boolean;
  sessions: Record<string, string>;
  state: { id: string; state: string; attempt_id: string; commit_sha: string };
  client: () => Promise<{ from: () => { select: () => { eq: (name: string, value: unknown) => unknown; maybeSingle: () => Promise<unknown> } } }>;
}
declare global { var cartographBrokerFixture: Fixture; }
const analysis = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const fixture: Fixture = globalThis.cartographBrokerFixture = {
  workspace: { userId: 'user_fixture', orgId: 'org_fixture', sessionId: 'sess_fixture' },
  view: { graph: { files: [], edges: [] }, commit: 'a'.repeat(40), attempt: 'attempt-fixture' },
  gate: Promise.resolve(), membership: true,
  sessions: { sess_fixture: 'user_fixture', sess_other: 'user_other' },
  state: { id: analysis, state: 'completed', attempt_id: 'attempt-fixture', commit_sha: 'a'.repeat(40) },
  async client() {
    await fixture.gate;
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: fixture.state, error: null }; } };
    return { from: () => query };
  },
};
const modules: Record<string, string> = {
  'server-only': 'export {};',
  '@clerk/nextjs/server': 'export const clerkClient=async()=>({sessions:{getSession:async id=>({status:"active",userId:globalThis.cartographBrokerFixture.sessions[id]})},organizations:{getOrganizationMembershipList:async({userId})=>({data:globalThis.cartographBrokerFixture.membership||userId[0]==="user_other"?[{}]:[]})}});',
  '../workspace': 'export const requireWorkspace=async()=>globalThis.cartographBrokerFixture.workspace;',
  '../supabase': 'export const createSupabaseClient=()=>globalThis.cartographBrokerFixture.client();',
  '../ai/service': 'export const loadAnalysisAI=async()=>globalThis.cartographBrokerFixture.view;',
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  const source = modules[specifier];
  if (source && (specifier === 'server-only' || context.parentURL?.endsWith('/lib/agent/server.ts'))) {
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
} });
try {
  const { beginQuestion, resolveQuestion } = await import('../lib/agent/server.ts');
  const original = await beginQuestion(analysis);
  original.done();
  let release!: () => void;
  fixture.gate = new Promise<void>(resolve => { release = resolve; });
  const racing = beginQuestion(analysis, original.thread);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(beginQuestion(analysis, original.thread), /Wait for the current answer/);
  release();
  const first = await racing;
  first.done();
  const second = await beginQuestion(analysis, original.thread);
  first.done(); original.done();
  await assert.rejects(beginQuestion(analysis, original.thread), /Wait for the current answer/);
  assert.equal((await resolveQuestion(second.toolBearer)).scope.analysis, analysis);
  fixture.workspace = { ...fixture.workspace, userId: 'user_other', sessionId: 'sess_other' };
  const other = await beginQuestion(analysis);
  fixture.membership = false;
  await assert.rejects(resolveQuestion(second.toolBearer), /no longer authorized/);
  assert.equal((await resolveQuestion(other.toolBearer)).scope.user, 'user_other');
  other.done();
  fixture.membership = true;
  await assert.rejects(resolveQuestion(second.toolBearer));
  second.done();
  fixture.workspace = { ...fixture.workspace, userId: 'user_fixture', sessionId: 'sess_fixture' };
  const changed = await beginQuestion(analysis, original.thread);
  fixture.state = { ...fixture.state, commit_sha: 'b'.repeat(40) };
  await assert.rejects(resolveQuestion(changed.toolBearer), /no longer authorized/);
  changed.done();
  fixture.state = { ...fixture.state, commit_sha: fixture.view.commit };
  let oldestThread = '';
  let newestThread = '';
  for (let index = 0; index < 70; index++) {
    const finished = await beginQuestion(analysis);
    if (index === 0) oldestThread = finished.thread;
    newestThread = finished.thread;
    finished.done();
  }
  assert.equal(globalThis.cartographAgentBroker?.conversations.size, 64);
  await assert.rejects(beginQuestion(analysis, oldestThread), /conversation has expired/);
  const reused = await beginQuestion(analysis, newestThread);
  assert.equal(reused.thread, newestThread);
  reused.done();
  fixture.workspace = { ...fixture.workspace, userId: 'user_other', sessionId: 'sess_other' };
  await assert.rejects(beginQuestion(analysis, newestThread), /no longer belongs/);
  const admitted = await beginQuestion(analysis);
  assert.equal((await resolveQuestion(admitted.toolBearer)).scope.user, 'user_other');
  admitted.done();
  fixture.workspace = { ...fixture.workspace, userId: 'user_fixture', sessionId: 'sess_fixture' };
  const active: Awaited<ReturnType<typeof beginQuestion>>[] = [];
  try {
    for (let index = 0; index < 64; index++) active.push(await beginQuestion(analysis));
    assert.equal(globalThis.cartographAgentBroker?.conversations.size, 64);
    await assert.rejects(beginQuestion(analysis), /All question slots are occupied/);
    assert.equal((await resolveQuestion(active[0].toolBearer)).scope.analysis, analysis);
    active[1].done();
    const replacement = await beginQuestion(analysis);
    active.push(replacement);
    assert.equal(globalThis.cartographAgentBroker?.conversations.size, 64);
    assert.equal((await resolveQuestion(active[0].toolBearer)).scope.analysis, analysis);
    await assert.rejects(beginQuestion(analysis, active[0].thread), /Wait for the current answer/);
  } finally { for (const question of active) question.done(); }
  const actualNow = Date.now;
  try {
    const future = actualNow() + 31 * 60_000;
    Date.now = () => future;
    await assert.rejects(beginQuestion(analysis, active[0].thread), /conversation has expired/);
    const afterExpiry = await beginQuestion(analysis);
    assert.equal(globalThis.cartographAgentBroker?.conversations.size, 1);
    afterExpiry.done();
  } finally { Date.now = actualNow; }
  console.log('Actual broker evicts idle history after 70 finished questions, preserves 64 active slots, ownership and stale cleanup, and revokes access after membership or graph changes.');
} finally { hooks.deregister(); }

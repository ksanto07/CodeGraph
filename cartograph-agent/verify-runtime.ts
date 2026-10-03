import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIConnection } from '../lib/ai/client.ts';
const live = process.argv.includes('--live');
const root = fileURLToPath(new URL('..', import.meta.url));
let connection: AIConnection | undefined;
let liveClient: typeof import('../lib/ai/client.ts') | undefined;
let liveGraph: Awaited<ReturnType<typeof import('../lib/adapters/frameworks.ts')['analyzeFramework']>> | undefined;
let graphTools: typeof import('../lib/agent/graph-tools.ts') | undefined;
let fixture: string | undefined;
const model = live ? 'gpt-5.6-sol' : 'synthetic-test';
const upstreamEvidence: { type: string; itemType?: string; toolName?: string; completedOutputTypes?: string[] }[] = [];
const roundEvidence: { choice?: string; names: string[] }[] = [];
const factualLookups: { name: string; args: unknown; paths: string[] }[] = [];
if (live) {
  const { loadEvaluationEnvironment } = await import('../lib/evals/environment.ts'); await loadEvaluationEnvironment(root);
  liveClient = await import('../lib/ai/client.ts');
  if (!liveClient.tracingConfigured()) throw new Error('Live native evaluation requires configured LangSmith tracing.');
  const localAuth = await import('../lib/ai/local-auth.ts');
  const saved: unknown = JSON.parse(await readFile(join(homedir(), '.config/cartograph/chatgpt.json'), 'utf8'));
  if (!saved || typeof saved !== 'object' || !('connection' in saved) || !saved.connection || typeof saved.connection !== 'object' || !('ownerUserId' in saved.connection) || typeof saved.connection.ownerUserId !== 'string') throw new Error('Connect an owner-bound ChatGPT account first.');
  const user = saved.connection.ownerUserId;
  const catalog = await localAuth.listLocalChatGPTModels(user);
  if (!catalog.some(item => item.slug === model)) throw new Error('The evaluation model is absent from the connected account catalog.');
  connection = { credential: () => localAuth.accessTokenCredential(user), transport: async (input, init) => {
    const response = await fetch(input, init); if (!response.body) return response;
    const [forward, observe] = response.body.tee();
    void (async () => {
      let pending = ''; const reader = observe.getReader(); const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read(); pending += decoder.decode(part.value, { stream: !part.done });
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            const event: unknown = JSON.parse(line.slice(6));
            if (!event || typeof event !== 'object' || !('type' in event) || typeof event.type !== 'string') continue;
            const record = event as Record<string, unknown>; const item = record.item;
            const evidence: typeof upstreamEvidence[number] = { type: record.type as string };
            if (item && typeof item === 'object' && 'type' in item && typeof item.type === 'string') {
              evidence.itemType = item.type; if ('name' in item && typeof item.name === 'string') evidence.toolName = item.name;
            }
            const completed = record.response;
            if (record.type === 'response.completed' && completed && typeof completed === 'object' && 'output' in completed && Array.isArray(completed.output)) evidence.completedOutputTypes = completed.output.map((value: unknown) => value && typeof value === 'object' && 'type' in value && typeof value.type === 'string' ? value.type : 'unknown');
            upstreamEvidence.push(evidence);
          }
          if (part.done) break;
        }
      } catch {} finally { reader.releaseLock(); }
    })();
    return new Response(forward, { status: response.status, headers: response.headers });
  } };
  fixture = await mkdtemp(join(tmpdir(), 'cartograph-native-evaluation-'));
  await mkdir(join(fixture, 'lib')); await mkdir(join(fixture, 'app'));
  await writeFile(join(fixture, 'lib/auth.ts'), 'export function authenticate() { return true; }\n');
  await writeFile(join(fixture, 'lib/session.ts'), "import { authenticate } from './auth'; export const session = authenticate();\n");
  await writeFile(join(fixture, 'app/login.ts'), "import { session } from '../lib/session'; export const login = session;\n");
  await writeFile(join(fixture, 'middleware.ts'), "import { authenticate } from './lib/auth'; export const middleware = authenticate();\n");
  await writeFile(join(fixture, 'app/public.ts'), 'export const publicPage = true;\n');
  const { parseRepository } = await import('../lib/parser/repository.ts');
  const { runnerConfigAdapter } = await import('../lib/adapters/entry-points.ts');
  const { analyzeFramework } = await import('../lib/adapters/frameworks.ts');
  liveGraph = await analyzeFramework(fixture, await parseRepository(fixture, runnerConfigAdapter));
  graphTools = await import('../lib/agent/graph-tools.ts');
}
function factualPaths(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const result: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'path' || key === 'file') && typeof item === 'string') result.push(item);
    else if (Array.isArray(item)) for (const child of item) result.push(...factualPaths(child));
    else if (item && typeof item === 'object') result.push(...factualPaths(item));
  }
  return result;
}

const appPort = 3197; const nativePort = 3198; const origin = `http://127.0.0.1:${appPort}`;
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(publicKey), kid: 'synthetic', alg: 'ES256', use: 'sig' };
const threadId = crypto.randomUUID(); const otherThread = crypto.randomUUID();
const secret = 'synthetic-transport-private-value'; let handle = crypto.randomUUID().replaceAll('-', '');
let modelCalls = 0; let toolCalls = 0; const traces: string[] = [];
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/langsmith')) {
    if (request.url.endsWith('/info')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ batch_ingest_config: { size_limit_bytes: 20_971_520 }, version: 'synthetic' })); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks); traces.push((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString());
    response.setHeader('content-type', 'application/json'); response.end('{}'); return;
  }
  if (request.url === '/api/agent/jwks') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ keys: [jwk] })); return; }
  if (request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
  let body = ''; for await (const chunk of request) body += String(chunk);
  if (request.url === '/api/agent/tools' && live) {
    try {
      toolCalls++; const input = graphTools!.readGraphToolInput(JSON.parse(body)); const result = graphTools!.queryGraphTool(liveGraph!.graph, liveGraph!.metadata, input);
      factualLookups.push({ name: input.name, args: input.args, paths: factualPaths(result) });
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
    } catch { response.writeHead(400).end(); } return;
  }
  if (request.url === '/api/agent/tools') { toolCalls++; assert.deepEqual(JSON.parse(body), { name: 'analysis_summary', args: {} }); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ name: 'analysis_summary', files: 2, edges: 1 })); return; }
  if (request.url === '/api/agent/model') {
    if (live) {
      try {
        modelCalls++; const input = liveClient!.readResponsesRoundRequest(JSON.parse(body));
        roundEvidence.push({ choice: input.toolChoice, names: input.tools?.map(tool => tool.name) ?? [] });
        if (input.model !== model) throw new Error('Unexpected model.');
        response.setHeader('content-type', 'application/x-ndjson');
        const abort = new AbortController(); response.on('close', () => abort.abort());
        for await (const event of liveClient!.streamResponsesRound(input, connection!, abort.signal)) response.write(JSON.stringify(event) + '\n');
        response.end();
      } catch { response.destroy(new Error('Model gateway failed.')); } return;
    }
    modelCalls++; const input = JSON.parse(body) as { input: { type: string }[]; tools: { name: string }[] };
    assert.equal(input.tools.length, 6); response.setHeader('content-type', 'application/x-ndjson');
    const events = input.input.some(item => item.type === 'function_output') ? [{ type: 'text_delta', text: 'The graph contains two files and one import.' }, { type: 'completed' }] : [{ type: 'tool_call', callId: 'call-summary', name: 'analysis_summary', arguments: '{}' }, { type: 'completed' }];
    response.end(events.map(event => JSON.stringify(event)).join('\n') + '\n'); return;
  }
  response.writeHead(404).end();
});
await new Promise<void>(resolve => server.listen(appPort, '127.0.0.1', resolve));
const child = spawn('./node_modules/.bin/mda', ['dev', '.', '--port', String(nativePort), '--hostname', '127.0.0.1', '--no-browser', '--no-reload'], {
  cwd: new URL('.', import.meta.url), env: { ...process.env, CARTOGRAPH_APP_ORIGIN: origin, CARTOGRAPH_AGENT_MODEL: model, ...(live ? {} : { LANGSMITH_TRACING: 'true', LANGCHAIN_TRACING_V2: 'true', LANGSMITH_API_KEY: 'synthetic-trace-only', LANGCHAIN_API_KEY: '', LANGSMITH_ENDPOINT: `${origin}/langsmith`, LANGCHAIN_ENDPOINT: `${origin}/langsmith` }) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let logs = ''; child.stdout.on('data', value => { logs += String(value); }); child.stderr.on('data', value => { logs += String(value); });
async function token(principal: string, thread: string) { return new SignJWT({ cartograph_thread: thread }).setProtectedHeader({ alg: 'ES256', kid: 'synthetic' }).setIssuer(origin).setAudience('cartograph-runtime').setSubject(principal).setIssuedAt().setExpirationTime('5m').sign(privateKey); }
const bearer = await token('principal-one', threadId); const foreign = await token('principal-two', otherThread);
async function api(path: string, method = 'GET', body?: unknown, credential = bearer) {
  return fetch(`http://127.0.0.1:${nativePort}${path}`, { method, signal: AbortSignal.timeout(live ? 180_000 : 30_000), headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
try {
  const deadline = Date.now() + 90_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Native runtime exited: ${logs.slice(-5000)}`);
    try { const health = await fetch(`http://127.0.0.1:${nativePort}/ok`, { signal: AbortSignal.timeout(1000) }); if (health.ok || health.status === 401) break; } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error(`Native runtime startup timed out: ${logs.slice(-5000)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal((await api('/threads', 'POST', { thread_id: threadId })).ok, true);
  assert.equal((await api(`/threads/${threadId}`, 'GET', undefined, foreign)).ok, false);
  assert.equal((await api('/connectors/cartograph/register', 'POST', { runHandle: handle, threadId, expiresAt: Date.now() + 240_000, toolBearer: secret, modelBearer: secret }, '')).ok, false);
  assert.equal((await api('/connectors/cartograph/register', 'POST', { runHandle: handle, threadId, expiresAt: Date.now() + 240_000, toolBearer: secret, modelBearer: secret })).ok, true);
  assert.equal((await api('/threads', 'POST', { thread_id: otherThread }, foreign)).ok, true);
  assert.equal((await api('/connectors/cartograph/register', 'POST', { runHandle: handle, threadId, expiresAt: Date.now() + 240_000, toolBearer: secret, modelBearer: secret }, foreign)).ok, false);
  const foreignRun = await api(`/threads/${otherThread}/runs/stream`, 'POST', { assistant_id: 'cartograph', input: { messages: [{ role: 'user', content: 'Use the stolen opaque handle.' }] }, context: { runHandle: handle }, stream_mode: ['messages', 'updates'], on_disconnect: 'cancel' }, foreign);
  assert.match(await foreignRun.text(), /event: error/); assert.equal(modelCalls, 0); assert.equal(toolCalls, 0);

  const questions = live ? ['Where does authentication live in this repository graph?', 'What is affected if lib/auth.ts changes?', 'Is this code any good?'] : ['Summarize this graph.'];
  const conversations: { question: string; answer: string; successfulGraphLookups: number; currentTurnEvidence: boolean; exactPaths: unknown; heuristicFlags: string[]; lookups: typeof factualLookups }[] = [];
  let events = '';
  for (const [index, question] of questions.entries()) {
    if (index > 0) {
      assert.equal((await api('/connectors/cartograph/revoke', 'POST', { runHandle: handle })).ok, true);
      handle = crypto.randomUUID().replaceAll('-', '');
      assert.equal((await api('/connectors/cartograph/register', 'POST', { runHandle: handle, threadId, expiresAt: Date.now() + 240_000, toolBearer: secret, modelBearer: secret })).ok, true);
    }
    const before = toolCalls; const lookupStart = factualLookups.length;
    const stream = await api(`/threads/${threadId}/runs/stream`, 'POST', { assistant_id: 'cartograph', input: { messages: [{ role: 'user', content: question }] }, context: { runHandle: handle }, stream_mode: ['messages', 'updates', 'custom'], multitask_strategy: 'reject', on_disconnect: 'cancel' });
    assert.equal(stream.ok, true); const turnEvents = await stream.text(); events += turnEvents;
    assert.doesNotMatch(turnEvents, /event: error/); assert.equal(turnEvents.includes(secret), false);
    let answer = '';
    for (const frame of turnEvents.split('\n\n')) {
      if (!frame.startsWith('event: messages/complete\n')) continue;
      const line = frame.split('\n').find(value => value.startsWith('data: ')); if (!line) continue;
      const messages: unknown = JSON.parse(line.slice(6));
      if (Array.isArray(messages)) for (const message of messages) if (message && typeof message === 'object' && 'type' in message && message.type === 'ai' && 'content' in message && typeof message.content === 'string' && message.content) answer = message.content;
    }
    assert.ok(answer && toolCalls > before);
    const lookups = factualLookups.slice(lookupStart);
    const allowed = [...new Set(factualLookups.flatMap(lookup => lookup.paths))];
    if (live) assert.ok(lookups.length > 0, 'Each turn needs a successful factual graph lookup.');
    const evaluator = live ? await import('../lib/evals/paths.ts') : undefined;
    const flags: string[] = [];
    if (/\b(?:maybe|perhaps|might|probably|likely)\b/i.test(answer)) flags.push('hedging_words');
    if (/\b(?:tool|query|runtime|broker|supabase|credential|runHandle)\b/i.test(answer)) flags.push('plumbing_words');
    conversations.push({ question, answer, successfulGraphLookups: live ? lookups.length : toolCalls - before, currentTurnEvidence: live ? lookups.length > 0 : toolCalls > before, exactPaths: evaluator ? evaluator.evaluatePaths(answer, allowed) : null, heuristicFlags: flags, lookups });
  }
  if (!live) assert.match(events, /The graph contains two files/);
  assert.ok(toolCalls >= questions.length && modelCalls >= questions.length * 2);
  assert.equal((await api('/connectors/cartograph/revoke', 'POST', { runHandle: handle })).ok, true);
  const completedCalls = modelCalls;
  const revokedRun = await api(`/threads/${threadId}/runs/stream`, 'POST', { assistant_id: 'cartograph', input: { messages: [{ role: 'user', content: 'Reuse the revoked handle.' }] }, context: { runHandle: handle }, stream_mode: ['messages', 'updates'], on_disconnect: 'cancel' });
  assert.match(await revokedRun.text(), /event: error/); assert.equal(modelCalls, completedCalls);
  const state = await (await api(`/threads/${threadId}/state`)).text(); const history = await (await api(`/threads/${threadId}/history`, 'POST', { limit: 10 })).text();
  assert.equal([state, history, logs, events].some(value => value.includes(secret) || value.includes(bearer)), false);
  if (!live) {
    const traceDeadline = Date.now() + 5000; while (!traces.length && Date.now() < traceDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(traces.length > 0, 'Native traces must reach the local synthetic collector.');
    assert.equal(traces.some(trace => trace.includes(secret) || trace.includes(bearer)), false);
  }
  console.log(JSON.stringify({ mode: live ? 'live-fixture-evaluation' : 'synthetic-native-verification', native: true, fullApplicationEndToEnd: false, fixture: live ? 'Five parsed fixture files, graph facts only; no source bodies sent.' : null, model: live ? model : null, modelCalls, toolCalls, traceBatches: live ? null : traces.length, secretAbsent: true, heuristicNotice: 'Word flags are inspection aids, not scores or verified failures.', conversations, ...(!live ? { events: events.slice(0, 6000) } : {}) }, null, 2));
} finally {
  if (live) await writeFile('/tmp/codegraph-run/native-agent-live-diagnostics.json', JSON.stringify({ roundEvidence, upstreamEvidence }, null, 2));
  if (child.pid) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
    const descendants = new Set([child.pid]); let changed = true;
    while (changed) { changed = false; for (const [pid, parent] of rows) if (descendants.has(parent) && !descendants.has(pid)) { descendants.add(pid); changed = true; } }
    for (const pid of [...descendants].reverse()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
  if (fixture) await rm(fixture, { recursive: true, force: true });
  child.stdout.destroy(); child.stderr.destroy(); server.closeAllConnections(); server.close();
}

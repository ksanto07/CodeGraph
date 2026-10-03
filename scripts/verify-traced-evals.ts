import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AIRequest } from '../lib/ai/client.ts';

const endpoint = 'https://synthetic-langsmith.invalid';
const projectName = 'synthetic-eval-project';
const sessionId = randomUUID();
const providerCredential = 'synthetic-inference-credential-never-traced';
const tracingKey = 'synthetic-tracing-key';
process.env.LANGSMITH_API_KEY = tracingKey;
process.env.LANGSMITH_ENDPOINT = endpoint;
process.env.LANGSMITH_PROJECT = projectName;
process.env.LANGSMITH_TRACING = 'true';
delete process.env.LANGSMITH_ADDRESS;
delete process.env.LANGCHAIN_API_KEY;
delete process.env.LANGCHAIN_ENDPOINT;

interface RecordedRequest { url: string; method: string; body: unknown }
const requests: RecordedRequest[] = [];
let rejectFeedback = false;
const unexpected: string[] = [];
function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
const syntheticFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(`${endpoint}/`)) {
    unexpected.push(url);
    throw new Error('The verifier forbids all non-synthetic network requests.');
  }
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const text = init?.body ? await new Response(init.body).text() : input instanceof Request ? await input.clone().text() : '';
  const body: unknown = text ? JSON.parse(text) : null;
  requests.push({ url, method, body });
  const path = new URL(url).pathname;
  if (path === '/sessions' && method === 'GET') {
    assert.equal(new URL(url).searchParams.get('name'), projectName);
    return Response.json([{ id: sessionId, name: projectName }]);
  }
  if (path === '/feedback' && method === 'POST') {
    if (rejectFeedback) return Response.json({ detail: 'Synthetic feedback rejection.' }, { status: 400 });
    return Response.json(body);
  }
  if ((path === '/runs' && method === 'POST') || (path.startsWith('/runs/') && method === 'PATCH')) return Response.json({});
  if (path === '/info' && method === 'GET') return Response.json({ batch_ingest_config: { use_multipart_endpoint: false } });
  unexpected.push(url);
  throw new Error('The verifier encountered an unrecognized synthetic endpoint.');
};
const originalFetch = globalThis.fetch;
globalThis.fetch = syntheticFetch;

// Import after the stub and synthetic env so SDK defaults cannot escape onto a real endpoint.
const { Client } = await import('langsmith');
const { RunTree } = await import('langsmith/run_trees');
const { withRunTree } = await import('langsmith/traceable');
const { runAI } = await import('../lib/ai/client.ts');
const client = new Client({ apiUrl: endpoint, apiKey: tracingKey, fetchImplementation: syntheticFetch,
  autoBatchTracing: false, timeout_ms: 1000, callerOptions: { maxRetries: 0 } });
let modelCalls = 0;
let credentialCalls = 0;
const connection = {
  credential: async () => { credentialCalls++; return providerCredential; },
  transport: (async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${providerCredential}`);
    modelCalls++;
    const events = [
      { type: 'response.output_text.delta', delta: 'Uses `src/allowed.ts`.' },
      { type: 'response.completed', response: { id: 'synthetic-response', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }) satisfies typeof fetch,
};
const request: AIRequest = { operation: 'explain-file', model: 'synthetic-2026-10-01', promptVersion: 'synthetic-v1',
  key: 'synthetic-key', instructions: 'Use the supplied paths.', input: '{"file":"src/allowed.ts"}',
  allowedPaths: ['src/allowed.ts'], source: 'application' };
const stored = new Map<string, string>();
const canonical = 'Uses `src/allowed.ts` and `src/invented.ts`.';
const cache = {
  read: async (key: string) => stored.get(key) ?? null,
  write: async (key: string) => { stored.set(key, canonical); return canonical; },
};
async function invoke(input: AIRequest) {
  const tree = new RunTree({ name: 'synthetic-request-container', project_name: projectName, client, tracingEnabled: true });
  await tree.postRun();
  const result = await withRunTree(tree, () => runAI(input, cache, connection));
  await tree.end({ completed: true });
  await tree.patchRun();
  await client.awaitPendingTraceBatches();
  return result;
}

try {
  const live = await invoke(request);
  assert.equal(live.body, canonical);
  assert.equal(live.cached, false);
  assert.equal(live.evaluation?.feedback, 'recorded');
  assert.equal(live.evaluation?.score, 0);
  assert.deepEqual(live.evaluation?.invented.map(mention => mention.raw), ['src/invented.ts']);
  const cached = await invoke(request);
  assert.equal(cached.body, canonical);
  assert.equal(cached.cached, true);
  assert.equal(cached.evaluation?.feedback, 'recorded');
  assert.equal(modelCalls, 1);
  assert.equal(credentialCalls, 1);
  const feedback = requests.filter(item => new URL(item.url).pathname === '/feedback').map(item => object(item.body));
  assert.equal(feedback.length, 2);
  assert.deepEqual(feedback.map(item => item.session_id), [sessionId, sessionId]);
  assert.deepEqual(feedback.map(item => item.run_id), [live.evaluation?.runId, cached.evaluation?.runId]);
  assert.notEqual(feedback[0].run_id, feedback[1].run_id);
  assert(feedback.every(item => item.score === 0 && item.key === 'invented_path_free_v2'));
  const explanationRuns = requests.filter(item => item.method === 'POST' && new URL(item.url).pathname === '/runs')
    .map(item => object(item.body)).filter(run => run.name === 'explain-file');
  assert.equal(explanationRuns.length, 2);
  for (const run of explanationRuns) {
    assert.deepEqual(object(object(run.inputs).request).allowedPaths, ['src/allowed.ts']);
    assert(feedback.some(item => item.run_id === run.id));
  }
  const completedRuns = requests.filter(item => item.method === 'PATCH' && item.url.includes('/runs/')).map(item => object(item.body));
  assert(completedRuns.some(run => object(run.outputs).cached === true));
  assert(!JSON.stringify(requests).includes(providerCredential));
  assert(!JSON.stringify(requests).includes(tracingKey));
  const fullyShown = await invoke({ ...request, allowedPaths: ['src/allowed.ts', 'src/invented.ts'] });
  assert.equal(fullyShown.evaluation?.feedback, 'recorded');
  assert.equal(fullyShown.evaluation?.score, 1);
  const passingFeedback = object(requests.filter(item => item.url === `${endpoint}/feedback`).at(-1)?.body);
  assert.equal(passingFeedback.score, 1);
  assert.equal(passingFeedback.run_id, fullyShown.evaluation?.runId);
  assert.equal(passingFeedback.session_id, sessionId);
  stored.set('ambiguous-key', 'Uses React/TypeScript with `src/allowed.ts`.');
  const ambiguous = await invoke({ ...request, key: 'ambiguous-key' });
  assert.equal(ambiguous.cached, true);
  assert.equal(ambiguous.evaluation?.score, null);
  assert.equal(ambiguous.evaluation?.feedback, 'recorded');
  assert.deepEqual(ambiguous.evaluation?.ambiguous.map(mention => mention.raw), ['React/TypeScript']);
  const ambiguousFeedback = object(requests.filter(item => item.url === `${endpoint}/feedback`).at(-1)?.body);
  assert.equal(ambiguousFeedback.key, 'invented_path_free_v2');
  assert.equal(ambiguousFeedback.value, 'ambiguous');
  assert(!('score' in ambiguousFeedback));
  const ambiguityDetails = object(JSON.parse(String(ambiguousFeedback.comment)));
  assert.equal(ambiguityDetails.ambiguousCount, 1);
  assert.equal(modelCalls, 1);
  rejectFeedback = true;
  const unavailable = await invoke(request);
  assert.equal(unavailable.body, canonical);
  assert.equal(unavailable.cached, true);
  assert.equal(unavailable.evaluation?.feedback, 'delivery_failed');
  assert.equal(unavailable.evaluation?.score, 0);
  assert.equal(modelCalls, 1);
  process.env.LANGSMITH_TRACING = 'false';
  const feedbackCount = requests.filter(item => item.url === `${endpoint}/feedback`).length;
  const local = await runAI(request, cache, connection);
  assert.equal(local.body, canonical);
  assert.equal(local.evaluation?.feedback, 'local_only');
  assert.equal(local.tracing, false);
  assert.equal(requests.filter(item => item.url === `${endpoint}/feedback`).length, feedbackCount);
  assert.deepEqual(unexpected, []);
  console.log('Actual SDK traces include exact request evidence and no credentials; canonical live/cache answers receive run/project feedback, with visible upload failure and tracing-off local scores.');
} finally {
  await client.awaitPendingTraceBatches();
  globalThis.fetch = originalFetch;
}

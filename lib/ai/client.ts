import OpenAI from 'openai';
import { traceable } from 'langsmith/traceable';
import { wrapOpenAI } from 'langsmith/wrappers/openai';
import { readSemanticRole } from './context.ts';
import { evaluatePaths } from '../evals/paths.ts';
import { recordPathEvaluation, type LivePathEvaluation } from '../evals/feedback.ts';
import { readSpecificityJudgment } from '../evals/judge.ts';

interface RequestBase {
  model: string;
  key: string;
  instructions: string;
  input: string;
  promptVersion: string;
  source?: 'application' | 'evaluation';
}
export type AIRequest = RequestBase & (
  | { operation: 'explain-file' | 'explain-folder'; allowedPaths: readonly string[] }
  | { operation: 'classify-file' | 'judge-specificity' }
);
export interface AICache {
  read: (key: string) => Promise<string | null>;
  write: (key: string, body: string) => Promise<string | void>;
}
export interface AIConnection {
  credential: () => Promise<string>;
  transport?: typeof fetch;
}
export interface AIResult { body: string; cached: boolean; tracing: boolean; evaluation?: LivePathEvaluation }

export function tracingConfigured(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY) && process.env.LANGSMITH_TRACING !== 'false';
}

export async function runAI(request: AIRequest, cache: AICache, connection: AIConnection): Promise<AIResult> {
  if (!/-\d{4}-\d{2}-\d{2}$/.test(request.model)) throw new Error('AI requests require an exact dated model snapshot.');
  const tracing = tracingConfigured();
  const run = traceable(async ({ request }: { request: AIRequest }): Promise<AIResult> => {
    const validate = (body: string) => request.operation === 'classify-file' ? readSemanticRole(body) :
      request.operation === 'judge-specificity' ? JSON.stringify(readSpecificityJudgment(body)) : body;
    const finish = async (body: string, cached: boolean): Promise<AIResult> => {
      body = validate(body);
      const evaluation = request.operation === 'explain-file' || request.operation === 'explain-folder'
        ? await recordPathEvaluation(evaluatePaths(body, request.allowedPaths), tracing) : undefined;
      return { body, cached, tracing, ...(evaluation ? { evaluation } : {}) };
    };
    const cached = await cache.read(request.key);
    if (cached !== null) return finish(cached, true);
    const client = wrapOpenAI(new OpenAI({
      apiKey: await connection.credential(), baseURL: 'https://api.openai.com/v1',
      maxRetries: 0, timeout: 60_000, fetch: connection.transport,
    }), { tracingEnabled: tracing });
    const stream = await client.responses.create({
      model: request.model, instructions: request.instructions,
      input: [{ role: 'user', content: request.input }], store: false, stream: true,
    });
    let body = '';
    let completed = false;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') body += event.delta;
      if (event.type === 'response.completed') completed = true;
      if (event.type === 'response.failed') throw new Error(`AI request failed (${event.response.error?.code ?? 'unknown'}).`);
      if (event.type === 'response.incomplete') throw new Error('AI response was incomplete.');
      if (event.type === 'error') throw new Error(`AI stream failed (${event.code ?? 'unknown'}).`);
    }
    if (!completed) throw new Error('AI stream ended without a completed response.');
    if (!body.trim()) throw new Error('AI response was empty.');
    body = validate(body);
    const canonical = await cache.write(request.key, body);
    return finish(canonical ?? body, false);
  }, { name: request.operation, tracingEnabled: tracing, metadata: {
    model: request.model, cacheKey: request.key, promptVersion: request.promptVersion,
    source: request.source ?? 'application', evidenceVersion: 1,
  } });
  return run({ request });
}

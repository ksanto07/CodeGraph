import { createHash } from 'node:crypto';
import type { Client } from 'langsmith';
import { getCurrentRunTree } from 'langsmith/traceable';
import type { PathEvaluation } from './paths.ts';

export type LivePathEvaluation = PathEvaluation & {
  feedback: 'local_only' | 'recorded' | 'delivery_failed';
  runId?: string;
};
const projects = new WeakMap<Client, Map<string, Promise<string>>>();

async function projectId(client: Client, name: string): Promise<string> {
  let entries = projects.get(client);
  if (!entries) { entries = new Map(); projects.set(client, entries); }
  let lookup = entries.get(name);
  if (!lookup) {
    lookup = client.readProject({ projectName: name }).then(project => project.id);
    entries.set(name, lookup);
    lookup.catch(() => entries.delete(name));
  }
  return lookup;
}

export async function recordPathEvaluation(evaluation: PathEvaluation, tracing: boolean): Promise<LivePathEvaluation> {
  if (!tracing) return { ...evaluation, feedback: 'local_only' };
  const tree = getCurrentRunTree(true);
  if (!tree) return { ...evaluation, feedback: 'delivery_failed' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const delivery = async () => {
      await tree.client.awaitPendingTraceBatches();
      const hex = createHash('sha256').update(`${tree.id}:${evaluation.version}`).digest('hex');
      const feedbackId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const common = {
        runId: tree.id, feedbackId, key: 'invented_path_free', score: evaluation.score,
        comment: JSON.stringify({ version: evaluation.version, checked: evaluation.checked.length,
          inventedCount: evaluation.invented.length, invented: evaluation.invented.slice(0, 20) }),
      };
      if (tree.address) await tree.client.createFeedback({ ...common, address: tree.address });
      else {
        if (!tree.project_name) throw new Error('The trace has no feedback project.');
        await tree.client.createFeedback({ ...common, sessionId: await projectId(tree.client, tree.project_name) });
      }
    };
    await Promise.race([delivery(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Path feedback delivery timed out.')), 5000);
    })]);
    return { ...evaluation, feedback: 'recorded', runId: tree.id };
  } catch {
    return { ...evaluation, feedback: 'delivery_failed', runId: tree.id };
  } finally { if (timer) clearTimeout(timer); }
}

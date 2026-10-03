import { loadEvaluationEnvironment } from '../lib/evals/environment.ts';

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!['roles', 'prompts', 'recent'].includes(command) || arguments_.length % 2) {
    throw new Error('Usage: node scripts/eval.ts roles|prompts --user user_ID --data held-out.json; recent [--since ISO] [--limit 50]');
  }
  const options = new Map<string, string>();
  for (let i = 0; i < arguments_.length; i += 2) {
    const name = arguments_[i];
    if (!['--user', '--data', '--since', '--limit'].includes(name) || options.has(name)) throw new Error('Invalid or repeated evaluation option.');
    options.set(name, arguments_[i + 1]);
  }
  await loadEvaluationEnvironment();
  const evaluation = await import('../evals/experiments.ts');
  if (command === 'recent') {
    const since = new Date(options.get('--since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const limit = Number(options.get('--limit') ?? 50);
    if (Number.isNaN(since.valueOf()) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Use a valid since date and limit from 1 to 100.');
    console.log(JSON.stringify(await evaluation.evaluateRecent(since, limit), null, 2));
  } else {
    const user = options.get('--user');
    const data = options.get('--data');
    if (!user || !data) throw new Error('Role and prompt experiments require --user and --data.');
    console.log(JSON.stringify(await (command === 'roles' ? evaluation.evaluateRoles(user, data) : evaluation.evaluatePrompts(user, data)), null, 2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

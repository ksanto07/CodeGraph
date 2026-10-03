import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEvaluationEnvironment } from '../lib/evals/environment.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = process.argv[2] ?? '2024';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || process.argv.length > 3) throw new Error('Usage: node scripts/local-agent.ts [port].');
if (process.platform === 'win32') throw new Error('The local agent launcher requires macOS or Linux.');
await loadEvaluationEnvironment(root);
if (['VERCEL', 'NETLIFY', 'RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'CF_PAGES', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME'].some(name => Boolean(process.env[name]))) throw new Error('The agent launcher cannot run on managed hosting.');
const agentRequire = createRequire(resolve(root, 'cartograph-agent/package.json'));
const executable = resolve(dirname(agentRequire.resolve('managed-deepagents')), '../bin/mda.mjs');
const child = spawn(process.execPath, [executable, 'dev', '.', '--hostname', '127.0.0.1', '--port', port, '--no-browser'], {
  cwd: resolve(root, 'cartograph-agent'), env: process.env, detached: true, stdio: 'inherit',
});
let shutdown: ReturnType<typeof setTimeout> | undefined;
const descendants = new Set<number>();
function captureDescendants(): void {
  if (!child.pid) return;
  descendants.add(child.pid);
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows) if (descendants.has(parent) && !descendants.has(pid)) { descendants.add(pid); changed = true; }
  }
}
function signalTree(signal: NodeJS.Signals): void {
  for (const pid of [...descendants].reverse()) { try { process.kill(pid, signal); } catch {} }
  if (child.pid) { try { process.kill(-child.pid, signal); } catch {} }
}
function stop(signal: NodeJS.Signals): void {
  if (shutdown) return;
  // The native CLI gives its npm/LangGraph server a separate process group.
  // Capture the ancestry before the launcher exits and those children reparent.
  captureDescendants();
  signalTree(signal);
  shutdown = setTimeout(() => signalTree('SIGKILL'), 5000);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1); });

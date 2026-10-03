import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const mode = process.argv[2] ?? 'dev';
const port = process.argv[3] ?? '3000';
if (!['dev', 'start'].includes(mode) || !/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || process.argv.length > 4) {
  throw new Error('Usage: node scripts/local-app.ts [dev|start] [port].');
}
if (['VERCEL', 'NETLIFY', 'RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'CF_PAGES', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME'].some(name => Boolean(process.env[name]))) {
  throw new Error('The local AI app launcher cannot run on managed hosting.');
}
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '-H', '127.0.0.1', '-p', port], {
  stdio: 'inherit', env: { ...process.env, CARTOGRAPH_LOCAL_AI: '1' },
});
let shutdown: ReturnType<typeof setTimeout> | undefined;
const stop = (signal: NodeJS.Signals) => {
  if (shutdown) return;
  child.kill(signal);
  shutdown = setTimeout(() => child.kill('SIGKILL'), 5000);
  shutdown.unref();
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (shutdown) clearTimeout(shutdown);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});

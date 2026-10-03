import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export async function loadEvaluationEnvironment(root = process.cwd()): Promise<void> {
  const projectRequire = createRequire(resolve(root, 'package.json'));
  const nextRequire = createRequire(projectRequire.resolve('next/package.json'));
  const loader: unknown = nextRequire('@next/env');
  if (!loader || typeof loader !== 'object' || !('loadEnvConfig' in loader) || typeof loader.loadEnvConfig !== 'function') {
    throw new Error('The installed Next environment loader is unavailable.');
  }
  loader.loadEnvConfig(root, process.env.NODE_ENV !== 'production', { info() {}, error() {} });
}

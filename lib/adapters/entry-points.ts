import type { FileNode, FrameworkAdapter } from '../parser/types.ts';

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const configName = /^(?:next|svelte|vite|vitest|jest|playwright|cypress|eslint|prettier|tailwind|postcss|rollup|webpack|babel|tsup)\.config\.(?:[cm]?[jt]s)$/;
function runnerEntry(file: Readonly<FileNode>): string | undefined {
  const name = file.id.split('/').at(-1)!;
  if (sourceExtension.test(file.id) && (/(?:^|\/)__tests__\//.test(file.id) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name))) return 'test';
  if (configName.test(name) || /^(?:\.eslintrc|\.prettierrc)\.[cm]?js$/.test(name)) return 'config';
}
export const runnerConfigAdapter: FrameworkAdapter = {
  id: 'runner-config',
  annotate(file) { const entryPoint = runnerEntry(file); return { ...file.annotations, ...(entryPoint ? { entryPoint } : {}) }; },
};
export const nextEntryAdapter: FrameworkAdapter = {
  id: 'next',
  annotate(file) {
    let entryPoint = runnerEntry(file);
    const app = /^(?:src\/)?app\/(?:.*\/)?(page|route|layout|template|loading|error|global-error|not-found|default)\.[jt]sx?$/.exec(file.id);
    const privateFolder = file.id.split('/').slice(0, -1).some(segment => segment.startsWith('_'));
    if (app && !privateFolder) entryPoint = app[1];
    const metadata = /^(?:src\/)?app\/(?:.*\/)?(sitemap)\.[jt]s$/.exec(file.id)
      ?? /^(?:src\/)?app\/(robots|manifest)\.[jt]s$/.exec(file.id)
      ?? /^(?:src\/)?app\/(?:.*\/)?(icon|apple-icon|opengraph-image|twitter-image)\.(?:js|ts|tsx)$/.exec(file.id);
    if (metadata && !privateFolder) entryPoint = metadata[1];
    if (/^(?:src\/)?pages\/.*\.[jt]sx?$/.test(file.id)) entryPoint = 'page';
    const root = /^(?:src\/)?(middleware|proxy|instrumentation|instrumentation-client)\.[jt]s$/.exec(file.id);
    if (root) entryPoint = root[1];
    return { ...file.annotations, ...(entryPoint ? { entryPoint } : {}) };
  },
};

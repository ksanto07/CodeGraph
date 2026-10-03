import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeFramework } from '../lib/adapters/frameworks.ts';
import { parseRepository } from '../lib/parser/repository.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'cartograph-adapters-'));
async function fixture(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  const graph = await parseRepository(root);
  const result = await analyzeFramework(root, graph);
  assert.deepEqual(result.graph.edges, graph.edges);
  assert.deepEqual(result.graph.coverage, graph.coverage);
  return result;
}
try {
  const next = await fixture({
    'packages/web/package.json': JSON.stringify({ dependencies: { next: '*', react: '*' } }),
    'packages/web/next.config.ts': "export default { basePath: '/docs' }",
    'packages/web/app/(site)/[slug]/page.tsx': 'export default function Page() { return null }',
    'packages/web/app/api/items/route.ts': 'export async function GET() {}\nexport const POST = async () => {}',
    'packages/web/app/_private/page.tsx': 'export default function Page() { return null }',
    'packages/web/pages/blog/index.tsx': 'export default function Page() { return null }',
  });
  assert.equal(next.metadata.framework, 'nextjs');
  assert.deepEqual(next.metadata.routes.map(({ method, path }) => [method, path]), [['GET', '/docs/[slug]'], ['GET', '/docs/api/items'], ['POST', '/docs/api/items'], ['GET', '/docs/blog']]);
  assert.equal(next.graph.files.find(file => file.id.includes('_private'))?.annotations.role, 'generic');
  const mixed = await fixture({
    'packages/ui/package.json': JSON.stringify({ dependencies: { react: '*' } }),
    'packages/ui/pages/example.tsx': 'export default function Example() { return null }',
    'packages/api/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*' } }),
    'packages/api/items.controller.ts': "import { Controller, Get } from '@nestjs/common'; @Controller('items') export class Items { @Get() list() {} }",
    'packages/other/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*' } }),
    'packages/other/main.ts': "app.setGlobalPrefix('other');",
    'packages/other/other.controller.ts': "import { Controller, Get } from '@nestjs/common'; @Controller('other') export class Other { @Get() list() {} }",
  });
  assert.equal(mixed.metadata.framework, 'nextjs');
  assert.equal(mixed.graph.files.find(file => file.id === 'packages/ui/pages/example.tsx')?.annotations.role, 'component');
  assert.equal(mixed.graph.files.find(file => file.id === 'packages/ui/pages/example.tsx')?.annotations.entryPoint, undefined);
  assert(mixed.metadata.routes.some(route => route.file === 'packages/api/items.controller.ts' && route.path === '/items'));
  assert(!mixed.metadata.routes.some(route => route.file.startsWith('packages/ui/') || route.file.startsWith('packages/other/')));
  await rm(path.join(root, 'packages/web/next.config.ts'));
  const commonjs = await fixture({ 'packages/web/next.config.cjs': "module.exports = { basePath: '/manual' };" });
  assert(commonjs.metadata.routes.filter(route => route.file.startsWith('packages/web/')).every(route => route.path.startsWith('/manual/')));
  assert.equal(commonjs.metadata.routes.filter(route => route.file.startsWith('packages/web/')).length, 4);
  const bracket = await fixture({ 'packages/web/next.config.cjs': "module['exports'] = { basePath: '/bracket' };" });
  assert.equal(bracket.metadata.routes.filter(route => route.file.startsWith('packages/web/')).length, 4);
  assert(bracket.metadata.routes.filter(route => route.file.startsWith('packages/web/')).every(route => route.path.startsWith('/bracket/')));
  const read = await fixture({ 'packages/web/next.config.cjs': "module.exports = { basePath: '/read' }; module[key]; module.exports;" });
  assert.equal(read.metadata.routes.filter(route => route.file.startsWith('packages/web/')).length, 4);
  assert(read.metadata.routes.filter(route => route.file.startsWith('packages/web/')).every(route => route.path.startsWith('/read/')));
  for (const config of [
    'module.exports = buildConfig();',
    'module.exports = { basePath: process.env.PREFIX };',
    "const module = {}; module.exports = { basePath: '/fake' };",
    "function configure(module) { module.exports = { basePath: '/fake' }; }",
    "module.exports = { basePath: '/first' }; module.exports = { basePath: '/second' };",
    "module.exports = { basePath: '/first' }; module['exports'] = { basePath: '/second' };",
    "module.exports = { basePath: '/first' }; module['exports']['basePath'] = process.env.PREFIX;",
    "module.exports = { basePath: '/first' }; module[dynamic] = { basePath: '/second' };",
    "module.exports = { basePath: '/first' }; module.exports.basePath = process.env.PREFIX;",
    "module.exports = { basePath: '/first' }; Object.assign(module.exports, { basePath: process.env.PREFIX });",
    "module.exports = { basePath: '/first' }; Object.assign(module[key], { basePath: process.env.PREFIX });",
    "module.exports = { basePath: '/first' }; const alias = module[key]; alias.basePath = process.env.PREFIX;",
  ]) {
    const result = await fixture({ 'packages/web/next.config.cjs': config });
    assert(!result.metadata.routes.some(route => route.file.startsWith('packages/web/')), config);
    assert(result.metadata.routes.some(route => route.path === '/items'));
  }
  await rm(path.join(root, 'packages/web/next.config.cjs'));
  const variable = await fixture({ 'packages/web/next.config.ts': "const config = { basePath: '/variable' }; export default config;" });
  assert.equal(variable.metadata.routes.filter(route => route.file.startsWith('packages/web/')).length, 4);
  assert(variable.metadata.routes.filter(route => route.file.startsWith('packages/web/')).every(route => route.path.startsWith('/variable/')));
  await rm(path.join(root, 'packages'), { recursive: true });
  const nest = await fixture({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*', react: '*' } }),
    'items.controller.ts': "import { Controller, Get, Post } from '@nestjs/common';\n@Controller('items') export class Items { @Get(':id') one() {} @Post() create() {} @Get(dynamic) unknown() {} }",
    'items.service.ts': 'export class ItemsService {}',
  });
  assert.equal(nest.metadata.framework, 'nestjs');
  assert.deepEqual(nest.metadata.routes.map(({ method, path }) => [method, path]), [['POST', '/items'], ['GET', '/items/:id']]);
  assert.equal(nest.graph.files.find(file => file.id === 'items.service.ts')?.annotations.role, 'service');
  const shared = await fixture({
    'packages/app/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*' } }),
    'packages/app/main.ts': "import './app.module'; app.setGlobalPrefix('v1');",
    'packages/app/app.module.ts': "export { Shared } from '../shared/shared.controller';",
    'packages/shared/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*' } }),
    'packages/shared/shared.controller.ts': "import { Controller, Get } from '@nestjs/common'; @Controller('shared') export class Shared { @Get() list() {} }",
  });
  assert(shared.graph.edges.some(edge => edge.from === 'packages/app/app.module.ts' && edge.to === 'packages/shared/shared.controller.ts'));
  assert(!shared.metadata.routes.some(route => route.file === 'packages/shared/shared.controller.ts'));
  assert(shared.metadata.routes.some(route => route.file === 'items.controller.ts' && route.path === '/items'));
  console.log('Adapter verification passed. Per-package roles, reachable Nest controller invalidation, dot and bracket CommonJS exports, dynamic config omission, and graph preservation.');
} finally { await rm(root, { recursive: true, force: true }); }

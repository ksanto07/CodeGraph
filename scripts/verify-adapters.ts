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
  await rm(path.join(root, 'packages'), { recursive: true });
  const nest = await fixture({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '*', react: '*' } }),
    'items.controller.ts': "import { Controller, Get, Post } from '@nestjs/common';\n@Controller('items') export class Items { @Get(':id') one() {} @Post() create() {} @Get(dynamic) unknown() {} }",
    'items.service.ts': 'export class ItemsService {}',
  });
  assert.equal(nest.metadata.framework, 'nestjs');
  assert.deepEqual(nest.metadata.routes.map(({ method, path }) => [method, path]), [['POST', '/items'], ['GET', '/items/:id']]);
  assert.equal(nest.graph.files.find(file => file.id === 'items.service.ts')?.annotations.role, 'service');
  console.log('Adapter verification passed. Monorepo detection, exact Next and Nest routes, nonliteral omission, private folders, and graph preservation.');
} finally { await rm(root, { recursive: true, force: true }); }

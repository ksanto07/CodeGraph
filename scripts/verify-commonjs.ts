import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseRepository } from '../lib/parser/repository.ts';
import { validateParseResult } from '../lib/parser/result-file.ts';
import { analyzeFramework } from '../lib/adapters/frameworks.ts';

const root = await mkdtemp(path.join(tmpdir(), 'cartograph-commonjs-'));
try {
  await mkdir(path.join(root, 'controllers'));
  await mkdir(path.join(root, 'service'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '*' } }));
  await writeFile(path.join(root, 'service/item.cjs'), 'module.exports = { alpha: 1, beta() {} };');
  await writeFile(path.join(root, 'controllers/item.js'), "const one = require('../service/item.cjs'); const two = require('../service/item.cjs'); import '../service/item.cjs'; require(dynamicPath);");
  await writeFile(path.join(root, 'shadow.js'), "function require(path) { return path } require('./absent');");
  const exportsCases: Record<string, { source: string; names: string[] }> = {
    'replacement.cjs': { source: 'exports.old = 1; module.exports = { current: 2 }; exports.detached = 3; module.exports.new = 4;', names: ['current', 'new'] },
    'twice.cjs': { source: 'module.exports = { old: 1 }; module.exports = { current: 2 };', names: ['current'] },
    'alias.cjs': { source: 'exports.before = 1; exports = {}; exports.detached = 2; module.exports.after = 3;', names: ['after', 'before'] },
    'shadow-exports.cjs': { source: 'const exports = {}; exports.fake = 1; module.exports.real = 2;', names: ['real'] },
    'shadow-module.cjs': { source: 'const module = { exports: {} }; module.exports.fake = 1; exports.real = 2;', names: ['real'] },
    'shadow-class.cjs': { source: 'class module {} module.exports = { fake: 1 }; exports.real = 2;', names: ['real'] },
    'shadow-parameter.cjs': { source: 'exports.real = 1; function change(module, exports) { module.exports.fake = 2; exports.fake = 3; }', names: ['real'] },
    'reattach.cjs': { source: 'module.exports = { current: 1 }; exports = module.exports; exports.next = 2;', names: ['current', 'next'] },
    'conditional.cjs': { source: 'exports.before = 1; if (flag) module.exports = { maybe: 2 };', names: [] },
    'function.cjs': { source: 'exports.before = 1; function change() { exports.maybe = 2; }', names: [] },
    'mixed.js': { source: 'export const stable = 1; exports.old = 1; module.exports = { current: 2 };', names: ['current', 'stable'] },
    'bracket.cjs': { source: 'exports.old = 1; module["exports"] = { current: 2 }; module["exports"]["new"] = 3;', names: ['current', 'new'] },
  };
  for (const [name, fixture] of Object.entries(exportsCases)) await writeFile(path.join(root, name), fixture.source);
  const parsed = await parseRepository(root);
  for (const [name, fixture] of Object.entries(exportsCases)) assert.deepEqual(parsed.files.find(file => file.id === name)?.exportNames, fixture.names, name);
  assert.equal(parsed.coverage.filter(item => item.kind === 'require').length, 3);
  assert.equal(parsed.edges.filter(edge => edge.kind === 'require').length, 1);
  assert.equal(parsed.edges.filter(edge => edge.kind === 'import').length, 1);
  assert.equal(parsed.coverage.find(item => item.specifier === 'dynamicPath')?.outcome.kind, 'unresolved');
  assert(!parsed.coverage.some(item => item.source === 'shadow.js'));
  assert.deepEqual(parsed.files.find(file => file.id === 'service/item.cjs')?.exportNames, ['alpha', 'beta']);
  assert.deepEqual(validateParseResult(JSON.parse(JSON.stringify(parsed))), parsed);
  const adapted = await analyzeFramework(root, parsed);
  assert.equal(adapted.metadata.framework, 'express');
  assert.deepEqual(adapted.metadata.routes, []);
  assert.equal(adapted.graph.files.find(file => file.id.startsWith('controllers/'))?.annotations.role, 'controller');
  assert.equal(adapted.graph.files.find(file => file.id.startsWith('service/'))?.annotations.role, 'service');
  if (process.argv[2]) {
    const before = validateParseResult(JSON.parse(await readFile(process.argv[2], 'utf8')));
    const ids = new Set(before.files.map(file => file.id));
    const after = await parseRepository(process.cwd());
    const existing = after.edges.filter(edge => edge.kind !== 'require' && ids.has(edge.from) && ids.has(edge.to));
    assert.equal(JSON.stringify(existing), JSON.stringify(before.edges), 'Existing import edges remain byte-identical.');
    console.log(`${existing.length} existing edges remain byte-identical.`);
  }
  console.log('CommonJS coverage, duplicate suppression, shadowing, export names, JSON round-trip and Express roles passed.');
} finally { await rm(root, { recursive: true, force: true }); }

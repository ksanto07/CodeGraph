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
  const parsed = await parseRepository(root);
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

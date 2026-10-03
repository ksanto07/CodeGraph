import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseRepository } from '../lib/parser/repository.ts';

const root = await mkdtemp(path.join(tmpdir(), 'cartograph-parser-limits-'));
try {
  await writeFile(path.join(root, 'a.ts'), 'export const value = 1;');
  await writeFile(path.join(root, 'b.js'), 'require("./a"); require("./a"); require(); import("./a");');
  await writeFile(path.join(root, 'notes.md'), 'Unsupported files do not consume the source budget.');
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules/ignored.js'), 'require("missing");');
  const unlimited = await parseRepository(root);
  assert.equal(unlimited.files.length, 2);
  assert.equal(unlimited.coverage.length, 4);
  const bounded = await parseRepository(root, undefined, { sourceFiles: 2, imports: 4 });
  assert.deepEqual(bounded, unlimited, 'Exactly sufficient limits preserve parser output.');
  await assert.rejects(parseRepository(root, undefined, { sourceFiles: 1 }), /source file limit \(1\)/);
  await assert.rejects(parseRepository(root, undefined, { sourceFiles: 0 }), /source file limit \(0\)/);
  await assert.rejects(parseRepository(root, undefined, { imports: 2 }), /import limit \(2\)/, 'A no-argument require consumes the next import slot.');
  await assert.rejects(parseRepository(root, undefined, { imports: 3 }), /import limit \(3\)/);
  await assert.rejects(parseRepository(root, undefined, { imports: 0 }), /import limit \(0\)/);
  for (const limit of [-1, 1.5, Infinity, NaN]) await assert.rejects(parseRepository(root, undefined, { sourceFiles: limit }), /non-negative safe integers/);
  console.log('Parser source selection and import limits passed, including empty require calls and unbounded compatibility.');
} finally { await rm(root, { recursive: true, force: true }); }

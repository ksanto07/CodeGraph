import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPreparedEvaluationDataset } from '../evals/experiments.ts';
import type { HeldOutDataset } from '../lib/evals/dataset.ts';

async function main() {
  const filename = process.argv[2];
  if (!filename || process.argv.length !== 3) throw new Error('Usage: node scripts/verify-eval-dataset.ts <collected-held-out.json>');
  const original: HeldOutDataset = JSON.parse(await readFile(filename, 'utf8'));
  const verified = await readPreparedEvaluationDataset(filename);
  assert.equal(verified.examples.length, 30);
  const directory = await mkdtemp(path.join(tmpdir(), 'verify-eval-dataset-'));
  async function rejects(name: string, change: (dataset: HeldOutDataset) => void) {
    const changed = structuredClone(original);
    change(changed);
    const output = path.join(directory, `${name}.json`);
    await writeFile(output, JSON.stringify(changed));
    await assert.rejects(readPreparedEvaluationDataset(output), /differs from freshly verified|Unapproved evaluation manifest/);
  }
  try {
    await rejects('label', dataset => { dataset.examples[0].expectedRole = 'service'; });
    await rejects('edge', dataset => {
      const context = dataset.examples.find(example => example.context.edges.length > 0)?.context;
      assert.ok(context, 'The real dataset must contain an incident edge.');
      context.edges[0].kind = context.edges[0].kind === 'require' ? 'import' : 'require';
    });
    await rejects('source-hash', dataset => { dataset.examples[0].context.members[0].sha256 = 'a'.repeat(64); });
    await rejects('neighbor-hash', dataset => {
      const file = dataset.examples.flatMap(example => [...example.context.incoming, ...example.context.outgoing])[0];
      assert.ok(file, 'The real dataset must contain a neighbor.');
      file.sha256 = 'b'.repeat(64);
    });
    await rejects('recomputed-manifest', dataset => {
      dataset.examples[0].expectedRole = 'service';
      dataset.manifestSha256 = createHash('sha256').update(JSON.stringify(dataset.examples)).digest('hex');
    });
    await rejects('duplicate-identity', dataset => { dataset.examples[1] = structuredClone(dataset.examples[0]); });
    console.log('Verified 30 real files; edited labels, edges, source and neighbor hashes, recomputed manifest hashes, and duplicate identities rejected.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

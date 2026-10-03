import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareHeldOutDataset } from '../lib/evals/dataset.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 && args.length !== 4 || args[0] !== '--out' || args.length === 4 && args[2] !== '--manifest') {
    throw new Error('Usage: node scripts/collect-eval-dataset.ts --out <json> [--manifest <roles.json>]');
  }
  const manifestFile = path.resolve(args[3] ?? 'evals/datasets/roles.json');
  const output = path.resolve(args[1]);
  if (output === manifestFile) throw new Error('The output cannot replace the source manifest.');
  const manifest: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
  const dataset = await prepareHeldOutDataset(manifest);
  await writeFile(output, JSON.stringify(dataset, null, 2) + '\n');
  console.log(JSON.stringify({ files: dataset.examples.length, distribution: dataset.distribution,
    manifestSha256: dataset.manifestSha256, output }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

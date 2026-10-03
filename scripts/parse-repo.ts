import { parseRepository } from '../lib/parser/repository.ts';
import { nextEntryAdapter, runnerConfigAdapter } from '../lib/adapters/entry-points.ts';
import { noFrameworkAdapter } from '../lib/parser/types.ts';
import { writeParseResult } from '../lib/parser/result-file.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const usage = 'Usage: pnpm parse-repo <directory> [--out <json>] [--adapter none|runner-config|next]';
  if (!args[0] || args[0].startsWith('--') || args.length % 2 !== 1) throw new Error(usage);
  let output: string | undefined;
  let adapter = noFrameworkAdapter;
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i += 2) {
    const option = args[i];
    const value = args[i + 1];
    if (seen.has(option) || !value || value.startsWith('--')) throw new Error(usage);
    seen.add(option);
    if (option === '--out') output = value;
    else if (option === '--adapter') {
      const profiles = [noFrameworkAdapter, runnerConfigAdapter, nextEntryAdapter];
      const chosen = profiles.find(profile => profile.id === value);
      if (!chosen) throw new Error(usage);
      adapter = chosen;
    } else throw new Error(usage);
  }
  const result = await parseRepository(args[0], adapter);
  console.log(`Files found ${result.summary.filesFound}, parsed ${result.summary.filesParsed}, skipped ${result.summary.filesSkipped}.`);
  console.log(`Folders ${result.summary.folders}, edges ${result.edges.length}, import occurrences ${result.coverage.length}.`);
  console.log(`Re-exports found ${result.summary.reExportsFound}, resolved ${result.summary.reExportsResolved}.`);
  for (const item of result.excludedDirectories) console.log(`Excluded directory ${item.path}: ${item.reason}`);
  for (const item of result.skipped) console.log(`Skipped ${item.path}: ${item.reason}. ${item.detail}`);
  for (const item of result.configDiagnostics) console.log(`Config ${item.path} (${item.code}): ${item.message}`);
  const outcomes = new Map<string, number>();
  for (const item of result.coverage) outcomes.set(item.outcome.kind, (outcomes.get(item.outcome.kind) ?? 0) + 1);
  console.log(`Coverage ${JSON.stringify(Object.fromEntries(outcomes))}`);
  for (const item of result.coverage.filter(item => item.outcome.kind === 'unresolved').slice(0, 20)) console.log(`Unresolved ${item.source}:${item.line} ${item.specifier}: ${item.outcome.kind === 'unresolved' ? `${item.outcome.reason}. ${item.outcome.detail}` : ''}`);
  for (const item of result.coverage.filter(item => item.kind === 're-export' && item.outcome.kind !== 'resolved')) console.log(`Re-export ${item.source}:${item.line} ${item.specifier}: ${JSON.stringify(item.outcome)}`);
  if (output) { await writeParseResult(output, result); console.log(`Wrote ${output}`); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

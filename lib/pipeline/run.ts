import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../database.types';
import { createSupabaseClient } from '../supabase';
import { repositoryAddress } from '../repository-address';
import { fetchRepository, type RepositoryArchive } from './archive';
import { parseRepository } from '../parser/repository';
import { validateParseResult } from '../parser/result-file';
import type { PipelineStage } from './progress';
import { runnerConfigAdapter } from '../adapters/entry-points';
import { analyzeFramework } from '../adapters/frameworks';

interface Claim { id: string; attempt: string; started: boolean }
function readClaim(value: unknown): Claim {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !('attempt' in value) || typeof value.attempt !== 'string' || !('started' in value) || typeof value.started !== 'boolean') throw new Error('Invalid pipeline claim.');
  return { id: value.id, attempt: value.attempt, started: value.started };
}
export async function submitRepository(url: string): Promise<string> {
  const address = repositoryAddress(url);
  const client = await createSupabaseClient();
  const { data, error } = await client.rpc('claim_repository', { repository_slug: address.slug });
  if (error) throw new Error('Could not start the analysis. Apply the pipeline migration and check your workspace.', { cause: error });
  const claim = readClaim(data);
  if (claim.started) after(() => executeRun(client, claim, address));
  return claim.id;
}
export async function restartRepository(id: string): Promise<void> {
  const client = await createSupabaseClient();
  const { data: analysis, error: lookupError } = await client.from('analyses').select('project:projects!analyses_project_fk(repository)').eq('id', id).eq('is_seed', false).single();
  if (lookupError || !analysis?.project) throw new Error('This analysis is unavailable.');
  const address = repositoryAddress(`https://github.com/${analysis.project.repository}`);
  const { data, error } = await client.rpc('restart_analysis', { analysis_id: id });
  if (error) throw new Error('Could not restart the analysis.', { cause: error });
  const claim = readClaim(data);
  if (claim.started) after(() => executeRun(client, claim, address));
}
async function executeRun(client: SupabaseClient<Database>, claim: Claim, address: ReturnType<typeof repositoryAddress>): Promise<void> {
  let stage: PipelineStage = 'fetch';
  let archive: RepositoryArchive | undefined;
  const advance = async (next: PipelineStage, message: string) => {
    stage = next;
    const { data, error } = await client.rpc('advance_analysis', { analysis_id: claim.id, attempt: claim.attempt, next_stage: next, status_message: message });
    if (error) throw new Error('Could not record analysis progress.', { cause: error });
    return data;
  };
  try {
    if (!await advance('fetch', 'Fetching the public repository at its current commit.')) return;
    archive = await fetchRepository(address);
    if (!await advance('select', 'Selecting TypeScript and JavaScript source files.')) return;
    if (!await advance('parse', 'Resolving imports and recording coverage.')) return;
    const parsed = await parseRepository(archive.directory, runnerConfigAdapter);
    if (parsed.files.length > 10_000 || parsed.edges.length > 60_000) throw new Error('This repository exceeds the local limit of 10,000 source files or 60,000 imports.');
    const adapted = await analyzeFramework(archive.directory, parsed);
    const result = validateParseResult(adapted.graph);
    if (!await advance('store', `Storing ${result.files.length} files and ${result.edges.length} resolved imports.`)) return;
    const payload: Json = JSON.parse(JSON.stringify({ ...result, frameworkMetadata: adapted.metadata }));
    const { error } = await client.rpc('publish_analysis', { analysis_id: claim.id, attempt: claim.attempt, commit_id: archive.commit, parsed: payload });
    if (error) throw new Error('Could not store the repository map.', { cause: error });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The analysis failed unexpectedly.';
    const { error: writeError } = await client.rpc('advance_analysis', { analysis_id: claim.id, attempt: claim.attempt, next_stage: stage, status_message: message, failed: true });
    if (writeError) console.error('Could not record the failed analysis.', { analysisId: claim.id, stage, code: writeError.code });
  } finally { await archive?.dispose(); }
}

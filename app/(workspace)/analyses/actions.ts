'use server';

import { redirect } from 'next/navigation';
import { restartRepository, submitRepository } from '@/lib/pipeline/run';
import { requireWorkspace } from '@/lib/workspace';

export async function analyzeRepository(_previous: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  await requireWorkspace();
  let id: string;
  try {
    const url = form.get('repository');
    if (typeof url !== 'string') throw new Error('Enter a public GitHub repository URL.');
    id = await submitRepository(url);
  } catch (error) { return { error: error instanceof Error ? error.message : 'Could not start the analysis.' }; }
  redirect(`/analyses/${id}`);
}
export async function rerunAnalysis(id: string): Promise<void> {
  await restartRepository(id);
  redirect(`/analyses/${id}`);
}

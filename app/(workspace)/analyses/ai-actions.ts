'use server';

import { refresh } from 'next/cache';
import { requireWorkspace } from '@/lib/workspace';
import { classifyGenericFiles, explainAnalysis } from '@/lib/ai/service';
import { connectLocalChatGPT, disconnectLocalChatGPT, LocalChatGPTError } from '@/lib/ai/local-auth';
import { requireLocalAIRequest } from '@/lib/ai/local-request';
import type { ExplainTarget } from '@/lib/ai/context';

export async function explainSelectedTarget(id: string, target: ExplainTarget) {
  return explainAnalysis(id, target);
}
export async function classifyAnalysisBatch(id: string) {
  return classifyGenericFiles(id);
}
export async function connectChatGPT(): Promise<{ error: string | null }> {
  const { userId } = await requireWorkspace();
  try {
    await requireLocalAIRequest('mutation');
    await connectLocalChatGPT(userId);
    refresh();
    return { error: null };
  } catch (error) { return { error: error instanceof LocalChatGPTError ? error.message : 'ChatGPT sign-in could not complete. Try again.' }; }
}
export async function disconnectChatGPT(): Promise<{ error: string | null }> {
  const { userId } = await requireWorkspace();
  try {
    await requireLocalAIRequest('mutation');
    await disconnectLocalChatGPT(userId);
    refresh();
    return { error: null };
  } catch (error) {
    refresh();
    return { error: error instanceof LocalChatGPTError ? error.message : 'ChatGPT could not disconnect. Try again.' };
  }
}

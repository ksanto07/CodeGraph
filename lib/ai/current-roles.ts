import type { Edge, FileNode } from '../parser/types.ts';
import { classificationPromptVersion, explanationContext, explanationKey, semanticRoles, type SemanticRole } from './context.ts';
import { modelCachePolicy } from './model-policy.ts';

export interface CurrentRoleRow {
  role: string;
  content_key: string | null;
  model: string | null;
  prompt_version: string | null;
  analyzed_commit: string | null;
  file: { path: string } | null;
}
export function currentRole(files: readonly FileNode[], edges: readonly Edge[], commit: string, row: CurrentRoleRow, model: string | null): SemanticRole | null {
  if (!model || !row.file || row.model !== model || row.prompt_version !== classificationPromptVersion || row.analyzed_commit !== commit) return null;
  const file = files.find(file => file.id === row.file?.path);
  if (!file || (file.annotations.role && file.annotations.role !== 'generic')) return null;
  const role = semanticRoles.find(role => role === row.role);
  if (!role) return null;
  const context = explanationContext(files, edges, { kind: 'file', id: file.id });
  return explanationKey(context, modelCachePolicy(model).identity, classificationPromptVersion) === row.content_key ? role : null;
}

export interface ModelCachePolicy { identity: string; revision: string; expiresAt: number | null }
const day = 86_400_000;

export function configuredModel(value: string | undefined): string | null {
  const model = value?.trim();
  return model && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(model) ? model : null;
}

export function modelCachePolicy(model: string, now = Date.now()): ModelCachePolicy {
  if (!configuredModel(model)) throw new Error('Configure a model from the connected account catalog.');
  if (/-\d{4}-\d{2}-\d{2}$/.test(model)) return { identity: model, revision: 'dated-snapshot', expiresAt: null };
  const window = Math.floor(now / day);
  const revision = `catalog-alias-v1:${window}`;
  return { identity: `${model}@${revision}`, revision, expiresAt: (window + 1) * day };
}

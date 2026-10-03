import { repositoryAddress } from './repository-address';

export interface RepositoryIntent { nonce: string; repository: string; expiresAt: number }
export const repositoryIntentCookiePrefix = 'cartograph-repository-intent-';
export const repositoryIntentLifetime = 15 * 60_000;

export function repositoryIntentCookie(nonce: unknown): string | null {
  return typeof nonce === 'string' && /^[a-f0-9]{64}$/.test(nonce) ? repositoryIntentCookiePrefix + nonce : null;
}

export function canonicalRepository(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a public GitHub repository URL.');
  return `https://github.com/${repositoryAddress(value).slug}`;
}

export function readRepositoryIntent(raw: string | undefined, nonce: unknown, now = Date.now()): RepositoryIntent | null {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce) || !raw || raw.length > 4096) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['nonce', 'repository', 'expiresAt'].includes(key)) ||
    !('nonce' in value) || value.nonce !== nonce || !('repository' in value) || !('expiresAt' in value) ||
    typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + repositoryIntentLifetime) return null;
  try {
    const repository = canonicalRepository(value.repository);
    if (repository !== value.repository) return null;
    return { nonce, repository, expiresAt: value.expiresAt };
  } catch { return null; }
}

export function repositoryReturnPath(intent: RepositoryIntent | null): string {
  return intent ? `/?intent=${intent.nonce}` : '/';
}

'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { canonicalRepository, readRepositoryIntent, repositoryIntentCookie, repositoryIntentCookiePrefix, repositoryIntentLifetime, repositoryReturnPath } from '@/lib/repository-intent';
import { submitRepository } from '@/lib/pipeline/run';
import { auth } from '@clerk/nextjs/server';

export async function beginRepository(_previous: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  let repository: string;
  try { repository = canonicalRepository(form.get('repository')); }
  catch (error) { return { error: error instanceof Error ? error.message : 'Enter a public GitHub repository URL.' }; }
  const intent = { nonce: randomBytes(32).toString('hex'), repository, expiresAt: Date.now() + repositoryIntentLifetime };
  const store = await cookies();
  for (const cookie of store.getAll()) if (repositoryIntentCookie(cookie.name.slice(repositoryIntentCookiePrefix.length)) === cookie.name) store.delete(cookie.name);
  store.set(repositoryIntentCookiePrefix + intent.nonce, JSON.stringify(intent), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: repositoryIntentLifetime / 1000,
    secure: (await headers()).get('x-forwarded-proto') === 'https',
  });
  redirect(repositoryReturnPath(intent));
}

export async function resumeRepository(_previous: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const store = await cookies();
  const nonce = form.get('intent');
  const cookieName = repositoryIntentCookie(nonce);
  const intent = readRepositoryIntent(cookieName ? store.get(cookieName)?.value : undefined, nonce);
  if (!cookieName || !intent) return { error: 'This repository request expired or was replaced in another tab. Enter the repository again.' };
  const { userId, orgId } = await auth();
  if (!userId) redirect(`/sign-in?intent=${intent.nonce}`);
  if (!orgId) redirect(repositoryReturnPath(intent));
  let id: string;
  try { id = await submitRepository(intent.repository); }
  catch (error) { return { error: error instanceof Error ? error.message : 'Could not start the analysis. Try again.' }; }
  store.delete(cookieName);
  redirect(`/analyses/${id}`);
}

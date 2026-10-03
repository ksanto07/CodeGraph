import { SignUp } from "@clerk/nextjs";
import { cookies } from 'next/headers';
import { readRepositoryIntent, repositoryIntentCookie, repositoryReturnPath } from '@/lib/repository-intent';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ intent?: string | string[] }> }) {
  const { intent: nonce } = await searchParams;
  const cookieName = repositoryIntentCookie(nonce);
  const intent = readRepositoryIntent(cookieName ? (await cookies()).get(cookieName)?.value : undefined, nonce);
  const returnPath = repositoryReturnPath(intent);
  return <main className="auth-page"><SignUp forceRedirectUrl={returnPath} signInForceRedirectUrl={returnPath} signInUrl={intent ? `/sign-in?intent=${intent.nonce}` : '/sign-in'} /></main>;
}

import { auth } from '@clerk/nextjs/server';
import { OrganizationList } from '@clerk/nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import WorkspaceLayout from './(workspace)/layout';
import { WorkspaceDashboard } from '@/components/workspace-dashboard';
import { AccountProvider } from '@/components/account-provider';
import { LandingPage } from '@/components/landing-page';
import { ResumeRepository } from '@/components/repository-intent-form';
import { readRepositoryIntent, repositoryIntentCookie, repositoryReturnPath } from '@/lib/repository-intent';

export default async function Home({ searchParams }: { searchParams: Promise<{ repository?: string | string[]; intent?: string | string[] }> }) {
  const query = await searchParams;
  const { userId, orgId } = await auth();
  const cookieName = repositoryIntentCookie(query.intent);
  const intent = readRepositoryIntent(cookieName ? (await cookies()).get(cookieName)?.value : undefined, query.intent);
  if (query.intent && !intent) return <main className="auth-page"><section className="repository-continuation">
    <h1>Repository request expired</h1><p>It may have expired or been replaced in another tab. Enter the repository again.</p><Link href="/">Continue</Link>
  </section></main>;
  if (!userId) {
    if (intent) redirect(`/sign-in?intent=${intent.nonce}`);
    return <LandingPage />;
  }
  if (!orgId) return <AccountProvider><main className="auth-page"><section className="repository-continuation">
    <h1>Choose a team</h1><p>Your repository maps belong to a team. Select one or create a team to continue.</p>
    <OrganizationList hidePersonal skipInvitationScreen afterSelectOrganizationUrl={repositoryReturnPath(intent)} afterCreateOrganizationUrl={repositoryReturnPath(intent)} />
  </section></main></AccountProvider>;
  if (intent) return <ResumeRepository key={intent.nonce} nonce={intent.nonce} repository={intent.repository} />;
  return <WorkspaceLayout><WorkspaceDashboard repository={typeof query.repository === 'string' ? query.repository : undefined} /></WorkspaceLayout>;
}

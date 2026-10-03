import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from 'next/navigation';

export async function requireWorkspace() {
  const session = await auth();
  const { userId, orgId } = session;
  if (!userId) {
    return session.redirectToSignIn({ returnBackUrl: "/" });
  }
  if (!orgId) redirect('/');
  return { ...session, userId, orgId };
}

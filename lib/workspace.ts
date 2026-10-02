import "server-only";
import { auth } from "@clerk/nextjs/server";

export async function requireWorkspace() {
  const session = await auth();
  const { userId, orgId } = session;
  if (!userId || !orgId) {
    return session.redirectToSignIn({ returnBackUrl: "/" });
  }
  return { ...session, userId, orgId };
}

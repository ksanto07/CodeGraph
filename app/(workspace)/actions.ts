"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { InvitationState } from "@/lib/invitation";

export async function inviteMember(
  _previous: InvitationState,
  formData: FormData,
): Promise<InvitationState> {
  const { userId, orgId, has } = await auth();
  if (!userId || !orgId || !has({ role: "org:admin" })) {
    return { status: "error", message: "Only a team admin can send invitations." };
  }

  const input = formData.get("email");
  const email = typeof input === "string" ? input.trim() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const requestHeaders = await headers();
  let origin: URL;
  try {
    origin = new URL(requestHeaders.get("origin") ?? "");
  } catch {
    return { status: "error", message: "Reload the workspace before sending an invitation." };
  }
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.host !== host || origin.username || origin.password ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && isLocal))
  ) {
    return { status: "error", message: "The invitation must come from this app's workspace." };
  }

  try {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress: email,
      role: "org:member",
      redirectUrl: `${origin.origin}/sign-in`,
    });
    return { status: "success", email };
  } catch {
    return { status: "error", message: "Invitation could not be sent. Check the email address and try again." };
  }
}

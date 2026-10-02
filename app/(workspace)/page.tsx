import { InviteMember } from "@/components/invite-member";
import { requireWorkspace } from "@/lib/workspace";

export default async function WorkspacePage() {
  const { orgId, orgSlug, has } = await requireWorkspace();

  return (
    <main className="workspace-content">
      <section className="workspace-identity" aria-labelledby="workspace-heading">
        <h1 id="workspace-heading">{orgSlug ?? "Team workspace"}</h1>
        <p>Your active team</p>
        <code>{orgId}</code>
      </section>
      <div className="workspace-empty">
        <p>You&apos;re signed in to this team&apos;s workspace.</p>
      </div>
      {has({ role: "org:admin" }) && <InviteMember key={orgId} />}
    </main>
  );
}

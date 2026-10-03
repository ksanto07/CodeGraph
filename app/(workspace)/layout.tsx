import { AccountProvider } from "@/components/account-provider";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace();

  return (
    <AccountProvider><div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Workspace">
        <p className="sidebar-label">Team workspace</p>
        <div className="team-controls">
          <OrganizationSwitcher
            hidePersonal
            skipInvitationScreen
            afterSelectOrganizationUrl="/"
            afterCreateOrganizationUrl="/"
            afterLeaveOrganizationUrl="/sign-in"
            appearance={{
              elements: {
                organizationSwitcherPopoverActionButton__manageOrganization: { display: "none" },
              },
            }}
          />
        </div>
        <nav aria-label="Workspace navigation"><Link href="/" className="workspace-nav-link" aria-current="page">Analyses</Link></nav>
        <div className="sidebar-user"><UserButton /><span>Account</span></div>
      </aside>
      {children}
    </div></AccountProvider>
  );
}

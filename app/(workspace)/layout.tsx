import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { requireWorkspace } from "@/lib/workspace";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace();

  return (
    <div className="workspace-shell">
      <div className="workspace-toolbar">
        <span>Workspace</span>
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
          <UserButton />
        </div>
      </div>
      {children}
    </div>
  );
}

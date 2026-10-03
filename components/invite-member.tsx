"use client";

import { useActionState } from "react";
import { inviteMember } from "@/app/(workspace)/actions";
import type { InvitationState } from "@/lib/invitation";

const initialState: InvitationState = { status: "idle" };

export function InviteMember() {
  const [state, action, pending] = useActionState(inviteMember, initialState);

  return (
    <section className="invitation" aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite a teammate</h2>
      <form action={action}>
        <label htmlFor="invite-email">Email address</label>
        <div className="invitation-fields">
          <input id="invite-email" name="email" type="email" required maxLength={254} placeholder="teammate@example.com" />
          <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</button>
        </div>
      </form>
      <p className={state.status === "error" ? "form-message error" : "form-message"} role="status">
        {state.status === "success" ? `Invitation sent to ${state.email}.` : state.status === "error" ? state.message : "Invitations open this app's sign-in page."}
      </p>
    </section>
  );
}

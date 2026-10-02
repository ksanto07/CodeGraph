export type InvitationState =
  | { status: "idle" }
  | { status: "success"; email: string }
  | { status: "error"; message: string };

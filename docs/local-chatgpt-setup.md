# Local ChatGPT connection

Cartograph registers its own OAuth client. Connecting ChatGPT is separate from
Clerk sign-in. The selected Clerk user may spend this machine's connected
ChatGPT allowance; other organization members may not.

Use Node 22.12 or later on macOS or Linux. Sign in to Cartograph through Clerk,
then obtain your exact `user_...` ID from Clerk's user record. From the project
directory, run these commands when ready to review the browser authorization.

```sh
node scripts/chatgpt-auth.ts connect --user user_YOUR_CLERK_ID
node scripts/chatgpt-auth.ts status --user user_YOUR_CLERK_ID
node scripts/chatgpt-auth.ts disconnect --user user_YOUR_CLERK_ID
```

Run the app with `pnpm local` for local ChatGPT usage. This launcher binds Next
to `127.0.0.1` and enables the local request guard only in that child process.
Use `pnpm local start` for an already-built app. Regular development and hosted
servers keep local ChatGPT spending disabled.

After connecting, choose exact model slugs returned by that account's catalog.
Set `CARTOGRAPH_EXPLANATION_MODEL`, `CARTOGRAPH_CLASSIFICATION_MODEL`, and
`CARTOGRAPH_AGENT_MODEL` in the server's `.env.local`, then restart the local app.
Approved moving aliases use bounded cache windows described below.

The connect command starts a listener on `127.0.0.1` before opening the system
browser. Review the Cartograph registration and grant ChatGPT plan usage.
The command checks the returned signed identity before replacing a connection.
Rerun connect after an expired one-time code; it retains the issued client ID.
This version maintains one ChatGPT registration per installation. To bind a
different Clerk user, first disconnect as the current owner. Reauthorization
must return the original registered ChatGPT account.

The store is `~/.config/cartograph/chatgpt.json`. Its directory has mode `0700`
and its file has mode `0600`. These are protected local credentials, not an
encrypted Keychain store. Backups and software running as your OS user can read
them. Do not copy the file into the repository, browser, Supabase, environment,
traces, logs, or a deployed server. Cartograph never reads Codex credential files.

Updates replace the file atomically. A process lock serializes browser sign-in,
disconnect, and refresh. A received successor refresh token is checkpointed
before verifying a refreshed identity, allowing verification to resume after a
network outage. An interrupted network exchange that never returns its successor
can require reconnecting. After a crash, stop every Cartograph process before
removing `~/.config/cartograph/chatgpt.lock`; the command does not guess when a
lock is safe to reclaim.

Server callers must enforce local-only access and authenticate the current
Clerk user before requesting credentials. Organization membership does not
authorize spending. The one wrapped OpenAI client receives credentials directly
in memory. OAuth credentials must never become inputs or outputs of a trace.
The account model catalog preserves exact returned slugs. It uses a `models`
array, unlike the regular SDK model-list shape. A listed model or connected
badge does not prove inference access. The user must verify one completed
Responses request, with `store: false` and `stream: true`.

Run the synthetic terminal checks without connecting a real account.

```sh
node scripts/verify-local-auth.ts
pnpm exec tsc --noEmit
```

Disconnect removes local credentials even if remote revocation fails. If the
command cannot confirm revocation, remove Cartograph's connection in ChatGPT
settings. Manage plan usage at <https://chatgpt.com/settings/usage>.

Protocol references, checked October 2, 2026.

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

Boundary Discipline keeps owner authorization at the credential boundary.
Model the Domain separates registration, active connection, and pending refresh
so an unverified rotation cannot authorize a request.

Model configuration uses exact returned catalog slugs in
`CARTOGRAPH_EXPLANATION_MODEL`, `CARTOGRAPH_CLASSIFICATION_MODEL`, and
`CARTOGRAPH_AGENT_MODEL`. User-approved catalog aliases are supported; they are
not represented as immutable snapshots. Alias cache keys include
`catalog-alias-v1` and a UTC day window, so saved explanations, labels, and agent
rounds are reused for at most 24 hours. Dated snapshots retain stable keys. Both
SQL cache shape constraints must accept real catalog slugs (migration 00005).
Every agent round reads its bounded delegation cache inside the trace.

Run `node scripts/verify-chatgpt-model.ts` for synthetic actual-SDK tool-call,
reasoning replay, cache, streaming, and cancellation checks without spending.

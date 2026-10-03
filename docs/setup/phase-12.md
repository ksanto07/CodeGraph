# Local repository questions

The agent is a separate Managed Deep Agents service. Start both processes from
the application directory. They share the existing Next environment loader and
the application's `.env.local`.

```sh
pnpm local
pnpm agent
```

The app defaults to port 3000 and the agent to port 2024. Both launchers bind to
`127.0.0.1`. To change ports, run `pnpm local dev 3001` and `pnpm agent 2025`,
then set the corresponding fixed loopback origins in `.env.local`.

```dotenv
CARTOGRAPH_APP_ORIGIN=http://127.0.0.1:3000
CARTOGRAPH_AGENT_ORIGIN=http://127.0.0.1:2024
CARTOGRAPH_AGENT_MODEL=your_connected_catalog_model
```

Use the same connected-account setup as explanations. The local ChatGPT owner
must be signed into the current Clerk workspace. Catalog aliases may change
upstream; model rounds use a daily cache namespace and each question retains
cached rounds only until its five-minute delegation ends.

Open a completed analysis and switch the whole right pane to **Ask**. Selected
files or folders become question context. Each successful graph lookup appears
before its answer. Switching back to **Details** preserves the selection. Stop
or exit Ask to cancel an active request. Use **New conversation** after a server
restart or an expired conversation. The app retains at most 64 conversations;
starting another can evict the oldest idle conversation, while active answers
keep their slots.

The native runtime owns threads and streaming. A clean stream close does not
mark an answer complete. The relay checks the same authenticated native run
once after the stream closes and requires success plus graph lookup evidence;
interrupted runs retain a visible error. The app issues a separate opaque
principal for each thread and a five-minute signed delegation for one analysis.
The broker retains a Clerk-backed database client; every lookup checks the live
session, organization membership and current analysis attempt/commit. Existing
database policies determine organization access. No database signing key or
service-role credential enters the agent.

Model and tool credentials stay in the runtime's private process registry.
Only an opaque handle enters native context. Restarting either service discards
authority. The runtime exposes six factual graph queries; its filesystem,
planner, summarizer and subagent capabilities are unavailable to the model.

Synthetic terminal checks exercise native HTTP authentication, ownership,
streaming, credential redaction and the wrapped SDK without provider calls.

```sh
node scripts/verify-agent-broker.ts
node scripts/verify-agent-relay.ts
node scripts/verify-chat-client.ts
node scripts/verify-chatgpt-model.ts
pnpm --dir cartograph-agent verify
```

The broker verifier uses Node's synchronous module hooks, available in Node
22.15 and later. The native build installs the runtime dependencies declared by
Managed Deep Agents. Its generated files remain under ignored `.mda/`.

`pnpm --dir cartograph-agent eval` runs three real-model questions against a
parsed fixture through the native runtime. It spends the connected account's
allowance and uploads question/graph/output traces to LangSmith. Hedge and
plumbing flags are heuristic measurements requiring inspection, not quality
grades for a repository. The fixture evaluation does not establish the complete
Clerk-to-browser flow; the phase's browser acceptance check remains manual.

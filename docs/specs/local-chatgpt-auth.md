# Local ChatGPT authentication

User direction replaces the Phase 10 API-key prerequisite for local use with
Sign in with ChatGPT. Clerk still owns application sign-in and organization
authorization. Connecting a ChatGPT plan is a separate, explicit operation.

## Behavior

- A local sign-in command opens the system browser after starting an IPv4
  loopback callback listener. Cartograph registers its own OAuth client using
  the official dynamic-registration flow and a persistent installation ID.
- Each attempt uses new state, nonce, and PKCE values. Validate the returned
  identity before replacing an existing connection. Retain the issued client
  ID for subsequent sign-ins. Require the granted ChatGPT plan usage scope
  before allowing inference.
- Keep credentials in protected local storage. Never send them to the browser,
  store them in Supabase, commit them, or include them in traces or logs.
  Refresh rotating credentials together and serialize refresh across processes.
- One wrapped OpenAI client remains the inference boundary. OAuth access tokens
  authenticate Responses calls with `store: false` and `stream: true`. Only a
  completed response counts as success. Surface incomplete, interrupted,
  revoked, and usage-limited requests as distinct failures.
- The local connection authorizes only its explicitly selected application
  user. Organization membership alone does not authorize spending the host's
  ChatGPT allowance. Remote hosting cannot silently use a local connection.
- Show the connected account and ChatGPT plan usage state. Provide a disconnect
  action and a link to ChatGPT usage settings. Trace availability remains visible
  independently of authentication.

## Verification

Terminal checks cover invalid callback state, missing or mismatched client IDs,
identity validation, denied plan permission, token refresh, and incomplete
inference. They use synthetic credentials and never expose real tokens.

The user completes browser sign-in and explicitly grants plan usage. A small
completed inference through the same wrapped client proves access for that
account and model. A connected badge or model catalog alone does not prove it.

## Official references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

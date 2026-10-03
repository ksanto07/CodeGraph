# Public repository entry

The root page shows the product introduction when signed out and the existing
analysis dashboard when signed in with a team. The shared header retains the
product theme control. The landing page uses static SVG drawings and the same
color tokens as the map.

Submitting the hero validates and normalizes the public GitHub URL. A
fifteen-minute HttpOnly draft carries it through sign-in, sign-up and native
team selection. The continuation submits an authenticated action; visiting a
page never starts an analysis. Failures retain the draft for retry. Each draft
uses its own cookie name so an older response cannot clear a newer tab's
request. An expired or replaced request asks for the repository again.

The local launcher binds to `127.0.0.1`. Next preserves that hostname through
proxy requests so Clerk's internal denial rewrites remain internal instead of
being forwarded back to `localhost`.

`node scripts/verify-repository-intent.ts` exercises the real server actions
with controlled request/auth/pipeline boundaries. It checks canonical URLs,
expiry, sign-in and team gates, tab ownership, overlapping responses, retry,
and consumption after a successful claim. It does not establish real Clerk
browser redirects or team-creation policy.

For the manual phase check, open the root signed out and submit a public
repository URL. Sign in, select or create a team, and confirm the analysis
starts without another submission. Check both themes and a narrow viewport.

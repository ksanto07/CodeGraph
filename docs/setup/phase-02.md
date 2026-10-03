# Phase 02 setup

Apply the tracked `supabase/migrations/20261002214656_workspace_schema.sql` migration through the project's migration workflow. It creates the eight public tables and a private organization identity anchor. The enum holds queued, running, completed and failed states.

Seed two actual Clerk organizations separately. Both must exist in Clerk and must have different IDs. Run with a privileged PostgreSQL connection supplied through your normal local environment, never an application publishable key.

```sh
psql "$DATABASE_URL" -v org_a="org_FIRST_ACTUAL_ID" -v org_b="org_SECOND_ACTUAL_ID" -f supabase/seeds/phase-02.sql
```

Replace both example values. Missing, malformed or identical values fail. Fixed UUIDs make rerunning the same fixture input idempotent. Keep the same pair of organizations on subsequent runs. The seed rejects existing fixture IDs owned by another organization rather than moving their rows. The seed contains one example repository per organization and all four lifecycle states, with different state ordering and timestamps between organizations. It leaves files, edges, routes, explanations, file roles and insights empty. The UI identifies rows as seeded examples; no repository was parsed.

The server reads at most 50 analyses with the active Clerk session token. It has no organization filter. All eight SELECT policies read the token's `o.id` claim, and anonymous users receive no table privileges. Authenticated clients have SELECT privileges only. Composite foreign keys enforce the same organization on relationships and the same analysis on file references. Deleting the private organization anchor cascades its rows. Synchronizing Clerk organization deletion is outside this phase.

Run `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build` before handoff. The phase spec's manual acceptance check remains the user's browser check. Switch between the seeded teams to see different rows, and use an unseeded team to see the empty state. A query failure shows a retry action rather than an empty list.

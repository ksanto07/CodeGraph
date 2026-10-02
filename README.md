# Cartograph

Cartograph is a local app for dependency maps of public GitHub repositories. Phase 1 adds Clerk sign-in, team workspaces, invitations, and a persistent theme preference.

## Run the app

Configure the four environment values and the Clerk and Supabase integration described in [Auth and teams setup](docs/setup/phase-01.md). Then run:

```sh
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Signed-out visitors go to the app's sign-in page. The workspace requires an active organization.

## Check the code

Run the terminal checks before declaring a phase ready:

```sh
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

The browser acceptance check belongs to the user and lives in [the Phase 1 spec](docs/specs/phase-01.md).

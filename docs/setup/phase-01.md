# Auth and teams setup

The development Clerk instance uses required organization membership, automatic first-organization creation, and Clerk's default organization naming. Clerk completes this session task before the workspace opens. The app never creates an organization in a layout or sign-in callback.

## Configure another Clerk instance

1. Enable Organizations in Clerk.
2. Require organization membership and enable automatic creation of the first organization. Use Clerk's default name.
3. Set the app home path to `/`, the sign-in path to `/sign-in`, and the sign-up path to `/sign-up`.
4. Add `"role": "authenticated"` to the session token's custom claims for Supabase.
5. Enable the sign-in methods you want in Clerk. All methods use the existing `SignIn` and `SignUp` components and the same `/` destination.

The app also fixes these paths in `ClerkProvider` and the route proxy. Conflicting Clerk URL environment variables fail during startup.

## Connect Supabase to Clerk

The development Supabase project already trusts the Clerk development issuer. For another project, register the Clerk issuer in Supabase's third-party authentication settings before using the database client. Register the corresponding production issuer when you deploy with production Clerk keys. See [Supabase's Clerk integration guide](https://supabase.com/docs/guides/auth/third-party/clerk).

The server-only `createSupabaseClient()` factory uses the ordinary Clerk session token as its `accessToken`. It requires a signed-in user and an active organization. A missing token throws instead of sending an anonymous request. Supabase does not store or refresh a second session.

Clerk session token schema v2 puts the organization ID in `o.id`. Server rendering reads Clerk's verified `auth().orgId` and `auth().orgSlug` values from that token. Future row policies must read the token's organization claim. They must not look up membership through Clerk's API.

This phase makes no database queries and creates no tables.

## Supply environment values

Put these values in `.env.local` at the app root:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`next.config.ts` validates the values when Next starts or builds. Missing configuration and invalid URLs stop startup without printing secrets.

## Send an invitation

Sign in as a team admin and use **Invite a teammate** in the workspace. The server action validates the email address and checks the admin role in the session token. It sends the Clerk invitation with this app's current origin and `/sign-in` as the redirect destination.

The organization switcher hides the organization management action and skips the invitation screen after organization creation. Invitations use the workspace form so they do not send recipients to Clerk's Account Portal. Clerk handles invitation acceptance through the existing sign-in component.

## Persist the theme

The **Theme** control writes `system`, `light`, or `dark` to the `cartograph-theme` cookie and the root element's `data-theme` attribute. Server rendering restores the cookie before the first paint. The system dark-mode media rule applies only when `data-theme` is `system`, so an explicit light preference wins on a dark system.

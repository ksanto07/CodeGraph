# Clerk setup

## Behavior

Use the Clerk application specified in the setup request for account creation,
sign-in, and account controls. Show sign-in and sign-up actions in the shared
header when signed out. Show the account menu when signed in. Keep the current
public pages available. Preserve the Supabase database setup.

## Acceptance check

1. Open the app while signed out and see Sign in and Sign up in the header.
2. Create a test account using Sign up and confirm the profile icon appears.
3. Open the profile menu and sign out.
4. Sign in again and confirm the profile icon returns.

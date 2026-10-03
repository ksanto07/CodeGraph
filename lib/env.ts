export function readEnvironment() {
  const clerkPublishableKey = required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const clerkSecretKey = required("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY);
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabasePublishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!/^pk_(test|live)_/.test(clerkPublishableKey)) {
    throw new Error("Invalid NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.");
  }
  if (!/^sk_(test|live)_/.test(clerkSecretKey)) {
    throw new Error("Invalid CLERK_SECRET_KEY.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (
    databaseUrl.username || databaseUrl.password ||
    (databaseUrl.protocol !== "https:" &&
      !(databaseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)))
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be HTTPS or a local HTTP URL.");
  }

  const authPaths = {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL: "/",
    NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL: "/",
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/",
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/",
  };
  for (const [name, expected] of Object.entries(authPaths)) {
    if (process.env[name] !== undefined && process.env[name] !== expected) {
      throw new Error(`Invalid ${name}. Expected ${expected}.`);
    }
  }

  return { clerkPublishableKey, clerkSecretKey, supabaseUrl, supabasePublishableKey };
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing environment configuration: ${name}`);
  }
  return value;
}

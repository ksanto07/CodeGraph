import { ClerkProvider } from "@clerk/nextjs";

export function AccountProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      appearance={{
        variables: {
          colorPrimary: "var(--accent)",
          colorBackground: "var(--panel)",
          colorForeground: "var(--foreground)",
          colorMutedForeground: "var(--muted)",
          colorBorder: "var(--border)",
          colorDanger: "var(--danger)",
          fontFamily: "var(--font-geist-sans)",
          fontSize: "13px",
          borderRadius: "4px",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

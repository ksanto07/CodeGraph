import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeControl } from "@/components/theme-control";
import { isThemePreference, themeCookie } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cartograph",
  description: "A dependency map of your codebase.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const savedTheme = (await cookies()).get(themeCookie)?.value;
  const theme = isThemePreference(savedTheme) ? savedTheme : "system";

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInForceRedirectUrl="/"
          signUpForceRedirectUrl="/"
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
          <header className="app-header">
            <Link href="/" className="app-name">Cartograph</Link>
            <ThemeControl initialTheme={theme} />
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

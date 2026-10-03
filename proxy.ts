import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { readEnvironment } from "@/lib/env";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/__clerk(.*)"]);

const authenticatedProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
}, { signInUrl: "/sign-in", signUpUrl: "/sign-up" });

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname === "/preview" || request.nextUrl.pathname === "/preview/") return NextResponse.next();
  readEnvironment();
  return authenticatedProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};

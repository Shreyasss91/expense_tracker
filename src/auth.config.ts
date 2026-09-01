import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { RateLimiter, timingSafeStringEqual } from "@/lib/secure-compare";

const passwordSchema = z.object({ password: z.string().max(200) });

// §1.8 — brute-force mitigation. Best-effort, per-process (see RateLimiter):
// 10 failed attempts per 5-minute window from any caller, then throttle.
const loginFailLimiter = new RateLimiter(10, 5 * 60 * 1000);

// §1.8 — explicit session lifetime. A 30-day default JWT has no revocation
// path, so we cap it at 7 days and refresh on activity (updateAge). Bump
// maxAge back up if the household prefers fewer re-logins.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // refresh once per day of use

export const authConfig = {
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  providers: [
    Credentials({
      name: "Family Password",
      credentials: { password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        // Throttle before doing any work — a blocked caller gets nothing.
        if (loginFailLimiter.isBlocked("login")) return null;
        const parsed = passwordSchema.safeParse(credentials);
        if (!parsed.success) {
          loginFailLimiter.record("login");
          return null;
        }
        // §3.1: single master password from FAMILY_MASTER_PASSWORD (env only, §9).
        const master = process.env.FAMILY_MASTER_PASSWORD;
        // §1.8: constant-time compare (no timing leak of the correct password).
        if (!master || !timingSafeStringEqual(parsed.data.password, master)) {
          loginFailLimiter.record("login");
          return null;
        }
        return { id: "family", name: "Family", role: "family_admin" };
      },
    }),
  ],
  callbacks: {
    // §3.1.4: protect everything except /login.
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      const isLoginPage = pathname.startsWith("/login");
      if (isLoggedIn && isLoginPage) return Response.redirect(new URL("/", request.nextUrl));
      if (!isLoggedIn && !isLoginPage) return false;
      return true;
    },
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string } | undefined)?.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) (session.user as { role?: string }).role = token.role as string | undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { RateLimiter, masterPasswordFingerprint, timingSafeStringEqual } from "@/lib/secure-compare";

const passwordSchema = z.object({ password: z.string().max(200) });

// §1.8 — brute-force mitigation. Best-effort, per-process (see RateLimiter):
// 10 failed attempts per 5-minute window from any caller, then throttle.
const loginFailLimiter = new RateLimiter(10, 5 * 60 * 1000);

// §1.8 — explicit session lifetime. A 30-day default JWT has no revocation
// path, so we cap it at 7 days and refresh on activity (updateAge). Bump
// maxAge back up if the household prefers fewer re-logins.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // refresh once per day of use

// §3.1 — retire sessions when the master password changes. The session cookie
// is a stateless JWT signed with AUTH_SECRET, so nothing server-side notices a
// new FAMILY_MASTER_PASSWORD: the old cookie keeps verifying until maxAge, and
// updateAge (§1.8) rolls an active holder forward forever. We pin a keyed
// fingerprint of the password into the token at sign-in and re-check it on
// every request, so a password change is an effective "sign everyone out".
//
// NOTE: middleware is bundled for the Edge runtime, where Next inlines
// `process.env` at build time — the platform's documented flow (change the env
// var, then redeploy) is therefore required for a password change to take
// effect, which is exactly the §3.1 "deployment administration operation".
const PASSWORD_FP_CLAIM = "pwfp";
const PASSWORD_STALE_CLAIM = "pwfpStale";

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
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string } | undefined)?.role;
        // Sign-in: pin the password this holder actually authenticated against.
        token[PASSWORD_FP_CLAIM] = await masterPasswordFingerprint();
      }
      const pinned = token[PASSWORD_FP_CLAIM];
      const current = await masterPasswordFingerprint();
      token[PASSWORD_STALE_CLAIM] =
        typeof pinned !== "string" || !timingSafeStringEqual(pinned, current);
      return token;
    },
    session({ session, token }) {
      // A stale fingerprint means the master password changed after this token
      // was issued. Dropping `user` makes `authorized` above treat the holder
      // as logged out (so pages redirect to /login) and makes every
      // `if (!session?.user)` Server Action / route-handler guard fail closed.
      if (token[PASSWORD_STALE_CLAIM]) {
        // Cast: next-auth types `Session["user"]` as non-optional, but a
        // missing `user` IS the signed-out signal here — `authorized` and the
        // `!session?.user` guards all key off its absence, never its shape.
        session.user = undefined as unknown as typeof session.user;
        return session;
      }
      if (session.user) (session.user as { role?: string }).role = token.role as string | undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;

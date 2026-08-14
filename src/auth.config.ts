import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const passwordSchema = z.object({ password: z.string().max(200) });

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Family Password",
      credentials: { password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const parsed = passwordSchema.safeParse(credentials);
        if (!parsed.success) return null;
        // §3.1: single master password from FAMILY_MASTER_PASSWORD (env only, §9).
        const master = process.env.FAMILY_MASTER_PASSWORD;
        if (!master || parsed.data.password !== master) return null;
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

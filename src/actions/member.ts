"use server";

import { auth } from "@/auth";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { z } from "zod";

/**
 * §3.2 member switcher — a plain, client-readable cookie named active_member_id.
 * §3.2.1: the member must exist in the `members` table; this is a data-integrity
 * check, never an authentication check.
 */
export async function updateActiveMember(memberId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = z.string().uuid().safeParse(memberId);
  if (!parsed.success) return { ok: false as const, error: "Invalid member" };

  const exists = await db.query.members.findFirst({ where: eq(members.id, parsed.data) });
  if (!exists) return { ok: false as const, error: "Unknown member" };

  const cookieStore = await cookies();
  // §1.8: SPEC §3.2 keeps this cookie deliberately non-httpOnly (SSR
  // determinism + no hydration flash), so we harden the remaining flags:
  // sameSite "lax" blocks cross-site CSRF, and secure only on prod where
  // TLS is guaranteed.
  cookieStore.set("active_member_id", parsed.data, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true as const };
}

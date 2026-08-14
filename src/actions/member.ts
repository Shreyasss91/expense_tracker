"use server";

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
  const parsed = z.string().uuid().safeParse(memberId);
  if (!parsed.success) return { ok: false as const, error: "Invalid member" };

  const exists = await db.query.members.findFirst({ where: eq(members.id, parsed.data) });
  if (!exists) return { ok: false as const, error: "Unknown member" };

  const cookieStore = await cookies();
  cookieStore.set("active_member_id", parsed.data, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return { ok: true as const };
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

/**
 * §2.11 — push subscription management.
 *
 *   POST   { subscription: { endpoint, keys: { p256dh, auth } } }  → save
 *   DELETE { endpoint }                                          → revoke
 *
 * Re-uses the app's single master password: the middleware matcher excludes
 * /api, so the session is checked right here. A subscription is the push
 * service endpoint plus the two keys the browser hands us at subscribe time;
 * we store them verbatim (the Web Push sender needs them byte-for-byte) and
 * UPsert on endpoint so re-subscribing the same device is idempotent.
 */
import { auth } from "@/auth";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { isPushConfigured } from "@/lib/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const endpointSchema = z.object({ endpoint: z.string().url() });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: false, error: "Web Push is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(body?.subscription);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid subscription payload" }, { status: 400 });
  }

  await db
    .insert(pushSubscriptions)
    .values({ endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, lastSeenAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = endpointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid endpoint" }, { status: 400 });
  }

  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  return NextResponse.json({ ok: true });
}

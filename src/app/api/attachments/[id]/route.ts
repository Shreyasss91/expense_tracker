import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { BlobNotConfiguredError, deleteBlob, fetchBlob } from "@/lib/blob";
import { revalidatePath } from "next/cache";
import { idSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/attachments/[id] — stream one receipt's bytes.
 *
 * Vercel Blob URLs are public by default, so handing `url` to the browser would
 * put every household receipt on an unauthenticated URL. This proxy re-checks
 * the session (the middleware matcher excludes /api, so nothing else does it)
 * and streams from the store, keeping receipts behind the app's password.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const idCheck = idSchema.safeParse((await params).id);
  if (!idCheck.success) {
    return NextResponse.json({ ok: false, error: "Invalid attachment id" }, { status: 400 });
  }

  try {
    const [row] = await db.select().from(attachments).where(eq(attachments.id, idCheck.data));
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const upstream = await fetchBlob(row.url);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ ok: false, error: "Could not read the receipt" }, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": row.contentType,
        // Immutable: a receipt is written once and never replaced in place.
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `inline; filename="${row.pathname.split("/").pop() ?? "receipt"}"`,
      },
    });
  } catch (error) {
    if (error instanceof BlobNotConfiguredError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error("Receipt read failed", error);
    return NextResponse.json({ ok: false, error: "Could not read the receipt" }, { status: 500 });
  }
}

/**
 * DELETE /api/attachments/[id] — remove a receipt.
 * The object is deleted from the store first, then the row: an orphaned blob is
 * unreachable and un-cleanable, while an orphaned row is merely invisible (and
 * a retry can finish the job).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const idCheck = idSchema.safeParse((await params).id);
  if (!idCheck.success) {
    return NextResponse.json({ ok: false, error: "Invalid attachment id" }, { status: 400 });
  }

  try {
    const [row] = await db
      .delete(attachments)
      .where(eq(attachments.id, idCheck.data))
      .returning({ pathname: attachments.pathname });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    try {
      await deleteBlob(row.pathname);
    } catch (error) {
      // The row is already gone; a leftover object is invisible to the app and
      // can be swept later. Failing the request now would lie to the user.
      console.error("Receipt row deleted but the object could not be removed", error);
    }

    revalidatePath("/");
    revalidatePath("/transactions");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Receipt delete failed", error);
    return NextResponse.json({ ok: false, error: "Could not delete the receipt" }, { status: 500 });
  }
}

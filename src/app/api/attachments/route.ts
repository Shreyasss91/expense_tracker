import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { attachments, transactions } from "@/db/schema";
import { BlobNotConfiguredError, BlobError, putBlob } from "@/lib/blob";
import {
  RECEIPT_CONTENT_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_PER_TRANSACTION,
  formatBytes,
  isAllowedReceiptType,
  receiptPathname,
} from "@/lib/attachments";
import { idSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";
// Route Handlers have no 1 MB body cap (that limit belongs to Server Actions),
// which is exactly why receipt uploads go through here rather than an action.
export const runtime = "nodejs";

/**
 * POST /api/attachments — attach one receipt to a transaction.
 *
 * The middleware matcher excludes /api (§1.8), so this handler owns its own
 * authorization: an unauthenticated caller gets 401, not a partial upload.
 * multipart/form-data keeps the bytes out of a base64 JSON envelope (33%
 * smaller) and lets the platform stream them.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
  }

  const rawTransactionId = form.get("transactionId");
  const file = form.get("file");
  const idCheck = idSchema.safeParse(typeof rawTransactionId === "string" ? rawTransactionId : "");
  if (!idCheck.success) {
    return NextResponse.json({ ok: false, error: "Invalid transaction id" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }

  const transactionId = idCheck.data;

  try {
    const transaction = await db.query.transactions.findFirst({
      where: eq(transactions.id, transactionId),
      columns: { id: true },
    });
    if (!transaction) {
      return NextResponse.json({ ok: false, error: "Transaction not found" }, { status: 404 });
    }

    // Validate the declared type, not just the filename extension — the
    // extension is client-supplied and trivially spoofed.
    if (!isAllowedReceiptType(file.type)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type — use ${RECEIPT_CONTENT_TYPES.join(", ")}` },
        { status: 415 },
      );
    }
    if (file.size <= 0) {
      return NextResponse.json({ ok: false, error: "File is empty" }, { status: 400 });
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `File is ${formatBytes(file.size)} — the limit is ${formatBytes(RECEIPT_MAX_BYTES)}` },
        { status: 413 },
      );
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attachments)
      .where(eq(attachments.transactionId, transactionId));
    if (Number(countRow?.count ?? 0) >= RECEIPT_MAX_PER_TRANSACTION) {
      return NextResponse.json(
        { ok: false, error: `At most ${RECEIPT_MAX_PER_TRANSACTION} receipts per transaction` },
        { status: 409 },
      );
    }

    const pathname = receiptPathname(transactionId, file.type);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blob = await putBlob({ pathname, contentType: file.type, body: bytes });

    // Compensating delete: if the row insert fails the object would be
    // unreachable by every read path (which joins through this table) and
    // nothing else could ever clean it up.
    let row;
    try {
      [row] = await db
        .insert(attachments)
        .values({
          transactionId,
          pathname: blob.pathname,
          url: blob.url,
          contentType: blob.contentType,
          sizeBytes: blob.size,
        })
        .returning();
    } catch (error) {
      console.error("Attachment insert failed; removing the orphaned object", error);
      const { deleteBlob } = await import("@/lib/blob");
      await deleteBlob(blob.pathname).catch(() => undefined);
      throw error;
    }

    if (!row) return NextResponse.json({ ok: false, error: "Could not save the receipt" }, { status: 500 });

    return NextResponse.json({
      ok: true,
      attachment: {
        id: row.id,
        url: row.url,
        pathname: row.pathname,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof BlobNotConfiguredError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    if (error instanceof BlobError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    console.error("Receipt upload failed", error);
    return NextResponse.json({ ok: false, error: "Could not save the receipt" }, { status: 500 });
  }
}

/**
 * GET /api/attachments?transactionId=… — list a transaction's receipts.
 * The blob URL is intentionally NOT returned to the client: reads go through
 * /api/attachments/[id], which re-checks the session before streaming bytes.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const idCheck = idSchema.safeParse(new URL(request.url).searchParams.get("transactionId") ?? "");
  if (!idCheck.success) {
    return NextResponse.json({ ok: false, error: "Invalid transaction id" }, { status: 400 });
  }

  try {
    const rows = await db
      .select({
        id: attachments.id,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(and(eq(attachments.transactionId, idCheck.data)))
      .orderBy(attachments.createdAt);

    return NextResponse.json({
      ok: true,
      attachments: rows.map((r) => ({
        id: r.id,
        // A stable, session-checked proxy URL — the store's own URL stays server-side.
        url: `/api/attachments/${r.id}`,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Receipt list failed", error);
    return NextResponse.json({ ok: false, error: "Could not load receipts" }, { status: 500 });
  }
}

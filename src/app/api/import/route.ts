import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * §2.10 — /api/import: the way back in. Export used to be one-way.
 *
 *   POST /api/import?mode=preview   →  { ok, summary }   (nothing written)
 *   POST /api/import?mode=commit    →  { ok, inserted, skipped, summary }
 *
 * Body is the file's raw text; the original filename travels in `x-filename`
 * (it selects the parser: .json → full-fidelity, 7-column CSV → canonical,
 * 16-column CSV → extended). No multipart parsing, no form library.
 *
 * Why a Route Handler and not a Server Action: Next caps Server Action request
 * bodies at 1 MB by default, and a backup file is allowed to be 5 MB. The
 * preview/commit split is deliberate too — a restore is destructive-ish, so
 * the UI shows exactly what will happen before anything is written.
 */
import { auth } from "@/auth";
import { resolveImport, commitImport } from "@/lib/import-apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // §1.5 — an import writes to the ledger; it is as private as the ledger.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  // Reject before buffering: parseImportFile would catch it, but only after
  // the whole body is already in memory.
  if (declared > 6 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "file exceeds the 5 MB import limit" }, { status: 413 });
  }

  const mode = new URL(request.url).searchParams.get("mode") === "commit" ? "commit" : "preview";
  const filename = request.headers.get("x-filename") ?? "upload.csv";
  const text = await request.text();

  const resolution = await resolveImport(filename, text);
  if (resolution.fatal) {
    return NextResponse.json({ ok: false, error: resolution.fatal }, { status: 400 });
  }

  if (mode === "preview") {
    return NextResponse.json({ ok: true, summary: resolution.summary });
  }

  const { inserted, skipped } = await commitImport(resolution.insertable);
  // Dashboard aggregates and the ledger list are cached under this tag.
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  return NextResponse.json({ ok: true, inserted, skipped, summary: resolution.summary });
}

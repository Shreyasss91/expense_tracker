// §2.9 Receipts — constants and pure helpers shared by the browser (capture +
// downscale + upload) and the server (validation + storage). No imports and no
// `server-only`, so a client component can enforce the exact same rules the
// route handler does.

/** MIME types we accept. HEIC is excluded: Safari serves it as image/heic but
 *  canvas cannot decode it, so a downscale attempt would silently fail. */
export const RECEIPT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

/** Largest upload the route handler accepts, in bytes (4 MB).
 *  Server Actions cap their body at 1 MB by default, which is why uploads go
 *  through a Route Handler instead — the platform limit is the binding one. */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

/** At most this many photos per transaction. */
export const RECEIPT_MAX_PER_TRANSACTION = 5;

/** Longest edge of a downscaled photo, in pixels. */
export const RECEIPT_MAX_EDGE = 1600;

/** JPEG quality used when re-encoding a downscaled photo (0–1). */
export const RECEIPT_JPEG_QUALITY = 0.82;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "jpg", // re-encoded to JPEG by the downscaler
  "image/webp": "jpg",
  "application/pdf": "pdf",
};

export function isAllowedReceiptType(type: string): type is ReceiptContentType {
  return (RECEIPT_CONTENT_TYPES as readonly string[]).includes(type);
}

export function receiptExtension(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType] ?? "bin";
}

/**
 * Object-storage pathname. Layout is `receipts/<yyyy>/<mm>/<uuid>.<ext>` —
 * month-prefixed so a household's objects stay browsable/lifecyclable by month,
 * and UUID-named so a re-upload never collides with (or overwrites) an
 * existing receipt.
 */
export function receiptPathname(transactionId: string, contentType: string): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // The transaction id is folded in so debugging a ledger row against the
  // bucket is possible without a join.
  return `receipts/${month}/${transactionId}/${id}.${receiptExtension(contentType)}`;
}

/** Human-readable size for the attachment chips. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

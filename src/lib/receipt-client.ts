"use client";

import {
  RECEIPT_JPEG_QUALITY,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_EDGE,
  isAllowedReceiptType,
} from "@/lib/attachments";

export type ReceiptUploadError = { file: string; message: string };

/**
 * §2.9 — browser half of receipt capture.
 *
 * Phone photos are 3–8 MB, which is over the platform's request-body ceiling.
 * So every image is decoded and re-encoded down to RECEIPT_MAX_EDGE at
 * RECEIPT_JPEG_QUALITY before it leaves the device — that lands a typical
 * receipt under 400 KB and makes capture usable on mobile data. PDFs are
 * passed through untouched (they are already compact and cannot be re-encoded
 * in a browser).
 *
 * The downscale is best-effort by design: if canvas or the decoder is
 * unavailable the original file is uploaded as-is and the server's own size
 * check is the backstop.
 */
export async function prepareReceipt(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (typeof document === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, RECEIPT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough — re-encoding would only cost quality.
    if (scale === 1 && file.size <= RECEIPT_MAX_BYTES / 2) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    // White matte: a transparent PNG flattened onto JPEG would turn
    // transparent pixels black and make the receipt unreadable.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", RECEIPT_JPEG_QUALITY);
    });
    if (!encoded) return file;

    // Never upload a "downscale" that came out bigger than the original.
    if (encoded.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "receipt";
    return new File([encoded], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Reject a file with a message the caller can put straight into a toast. */
export function validateReceipt(file: File): string | null {
  if (!isAllowedReceiptType(file.type)) {
    return `${file.name}: unsupported type — attach a JPEG, PNG, WebP or PDF`;
  }
  if (file.size <= 0) {
    return `${file.name}: the file is empty`;
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return `${file.name}: too large (${(file.size / 1024 / 1024).toFixed(1)} MB — limit 4 MB)`;
  }
  return null;
}

export interface UploadedReceipt {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Upload one prepared file to /api/attachments. Throws only on network loss. */
export async function uploadReceipt(transactionId: string, file: File): Promise<UploadedReceipt> {
  const form = new FormData();
  form.set("transactionId", transactionId);
  form.set("file", file);
  const response = await fetch("/api/attachments", { method: "POST", body: form });
  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string; attachment?: UploadedReceipt }
    | null;
  if (!response.ok || !json?.ok || !json.attachment) {
    throw new Error(json?.error ?? "Upload failed");
  }
  return json.attachment;
}

export async function deleteReceipt(id: string): Promise<void> {
  const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error ?? "Could not remove the receipt");
  }
}

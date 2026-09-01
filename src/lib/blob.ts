import "server-only";

/**
 * §2.9 — object storage for receipts, against Vercel Blob's REST API.
 *
 * Deliberately dependency-free: the whole surface a receipt needs is
 * "PUT bytes at a pathname" and "DELETE a pathname", and both are plain
 * authenticated fetch calls. Adding @vercel/blob to ship two endpoints would
 * pull a SDK into the bundle for no gain.
 *
 * When BLOB_READ_WRITE_TOKEN is unset every call throws BlobNotConfiguredError
 * rather than silently degrading — a receipt the user believes was saved and
 * that was actually dropped is a worse failure than an honest error toast.
 */

const BLOB_API = "https://blob.vercel-storage.com";

export class BlobNotConfiguredError extends Error {
  constructor() {
    super("Object storage is not configured (BLOB_READ_WRITE_TOKEN is unset)");
    this.name = "BlobNotConfiguredError";
  }
}

export class BlobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BlobError";
  }
}

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) throw new BlobNotConfiguredError();
  return value;
}

export interface PutBlobResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}

/**
 * Upload bytes. `pathname` must already be namespaced and unique — the store
 * overwrites in place, so a reused pathname would replace an existing receipt.
 * `addRandomSuffix` is switched off precisely because of that: the caller owns
 * uniqueness and the stored URL must stay stable.
 */
export async function putBlob(args: {
  pathname: string;
  contentType: string;
  body: Uint8Array | ArrayBuffer;
  /** Cache-Control max-age in seconds; receipts are immutable once written. */
  cacheControlMaxAge?: number;
}): Promise<PutBlobResult> {
  const { pathname, contentType, body } = args;
  const response = await fetch(`${BLOB_API}/${encodePathname(pathname)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": contentType,
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": String(args.cacheControlMaxAge ?? 31536000),
    },
    body: body as BodyInit,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new BlobError(`Blob upload failed (HTTP ${response.status})`, response.status);
  }

  const json = (await response.json().catch(() => null)) as {
    url?: string;
    pathname?: string;
    size?: number;
    contentType?: string;
  } | null;

  if (!json?.url) {
    throw new BlobError("Blob upload returned no URL", 502);
  }

  return {
    url: json.url,
    pathname: json.pathname ?? pathname,
    contentType: json.contentType ?? contentType,
    size: json.size ?? byteLength(body),
  };
}

/** Remove an object. A 404 is treated as success — it is already gone. */
export async function deleteBlob(pathname: string): Promise<void> {
  const response = await fetch(`${BLOB_API}/${encodePathname(pathname)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new BlobError(`Blob delete failed (HTTP ${response.status})`, response.status);
  }
}

/** Stream an object back. Used by the authed read proxy, never by the client. */
export async function fetchBlob(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(30_000) });
}

/** Each path segment is escaped; the separating slashes are preserved. */
function encodePathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function byteLength(body: Uint8Array | ArrayBuffer): number {
  return body instanceof ArrayBuffer ? body.byteLength : body.byteLength;
}

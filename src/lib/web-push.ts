/**
 * §2.11 — Web Push, without the `web-push` dependency.
 *
 * The audit's ask: surface the budget-alert / pending-review logic as a real
 * push notification now that the PWA is installable. The natural library is
 * `web-push`, but (like §2.9's object storage and §2.10's XLSX) this project's
 * whole point is a deliberately lean dependency tree, and the Web Push wire
 * protocol is small enough to implement directly on top of the Web Crypto
 * API that Node 18+ and every browser already ship. So:
 *
 *   - VAPID authentication  → an ES256 JWT signed with the VAPID private key.
 *   - Payload confidentiality → draft-ietf-webpush-encryption: ECDH (P-256)
 *     between an ephemeral sender key and the subscription's `p256dh`, HKDF
 *     to derive a 128-bit AES-GCM key + nonce, then AES-128-GCM.
 *
 * No dependency, no native bindings, fully testable: src/lib/web-push-test.ts
 * signs a JWT and round-trips the encryption with no network at all.
 *
 * Everything here is env-gated. Without VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY /
 * VAPID_SUBJECT the whole feature degrades to a clear "not configured" — the
 * subscribe UI still works, it just can't deliver until the keys are set.
 */
import { timingSafeStringEqual } from "./secure-compare";

/* ----------------------------------------------------------- base64url ---- */

function bytesToB64url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Strip PEM armour (BEGIN/END lines, whitespace) → DER bytes. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  return b64urlToBytes(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/* ----------------------------------------------------------------- HKDF ---- */

async function hmacSha256(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** RFC 5869 — the expand step (PRK is the HMAC key, info the label). */
async function hkdfExpand(prk: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(length);
  let t = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  let written = 0;
  let counter = 1;
  while (written < length) {
    t = await hmacSha256(prk, concat(t, info, new Uint8Array([counter]) as Uint8Array<ArrayBuffer>));
    out.set(t.subarray(0, Math.min(t.length, length - written)), written);
    written += t.length;
    counter += 1;
  }
  return out;
}

/* -------------------------------------------------------------- VAPID ---- */

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_SUBJECT);
}

let cachedPrivateKey: CryptoKey | null = null;
let cachedPrivateKeyPem = "";

async function vapidPrivateKey(): Promise<CryptoKey> {
  const pem = process.env.VAPID_PRIVATE_KEY ?? "";
  if (cachedPrivateKey && cachedPrivateKeyPem === pem) return cachedPrivateKey;
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  cachedPrivateKey = key;
  cachedPrivateKeyPem = pem;
  return key;
}

/** The uncompressed 65-byte public point, base64url — goes in the Crypto-Key header. */
function vapidPublicRaw(): Uint8Array<ArrayBuffer> {
  return b64urlToBytes(process.env.VAPID_PUBLIC_KEY ?? "");
}

export async function signVapidJwt(audience: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  // 12-hour TTL — the push only ever carries non-urgent household nudges.
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT ?? "mailto:family@example.com" };
  const encode = (obj: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)) as Uint8Array<ArrayBuffer>);
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidPrivateKey(), new TextEncoder().encode(signingInput) as Uint8Array<ArrayBuffer>),
  );
  return `${signingInput}.${bytesToB64url(sig)}`;
}

/* ----------------------------------------------------------- encrypt ---- */

async function deriveSharedSecret(receiverRaw: Uint8Array<ArrayBuffer>): Promise<{ ephemeralPublic: Uint8Array<ArrayBuffer>; shared: Uint8Array<ArrayBuffer> }> {
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as Uint8Array<ArrayBuffer>;

  const receiverKey = await crypto.subtle.importKey("raw", receiverRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, ephemeral.privateKey, 256);
  return { ephemeralPublic, shared: new Uint8Array(sharedBits) as Uint8Array<ArrayBuffer> };
}

/**
 * Encrypt a JSON payload for one subscription per draft-ietf-webpush-
 * encryption. Returns the ciphertext plus the three headers the push
 * service needs. The Authorization (VAPID JWT) header is added by the caller,
 * because it depends on the destination origin.
 */
export async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string,
): Promise<{ body: Uint8Array<ArrayBuffer>; salt: Uint8Array<ArrayBuffer>; ephemeralPublic: Uint8Array<ArrayBuffer> }> {
  const receiverRaw = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;

  const { ephemeralPublic, shared } = await deriveSharedSecret(receiverRaw);

  // The subscription's auth secret is mixed into the IKM so a stolen ECDH
  // point alone can't derive the content key — draft-ietf-webpush-encryption.
  const authInfo = concat(new TextEncoder().encode("WebPush: info") as Uint8Array<ArrayBuffer>, new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic);
  const prk = await hkdfExpand(
    await hmacSha256(authSecret, shared),
    authInfo,
    32,
  );

  const cekInfo = concat(new TextEncoder().encode("Content-Encoding: aes128gcm") as Uint8Array<ArrayBuffer>, new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic);
  const nonceInfo = concat(new TextEncoder().encode("Content-Encoding: nonce") as Uint8Array<ArrayBuffer>, new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic);
  const cek = await hkdfExpand(prk, cekInfo, 16);
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM", length: 128 }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new Uint8Array(0) as Uint8Array<ArrayBuffer> },
      aesKey,
      new TextEncoder().encode(payload) as Uint8Array<ArrayBuffer>,
    ),
  );

  return { body: ciphertext, salt, ephemeralPublic };
}

/* -------------------------------------------------------------- send ---- */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendStatus = "sent" | "stale" | "failed";

/**
 * Deliver a single notification to a single subscription. Returns `stale` on
 * 404/410 so the caller can purge the row — a revoked permission must not keep
 * us POSTing to a dead endpoint forever.
 */
export async function sendWebPush(target: PushTarget, notification: { title: string; body: string; url: string }): Promise<SendStatus> {
  if (!isPushConfigured()) return "failed";

  const { body, salt, ephemeralPublic } = await encryptPayload(JSON.stringify(notification), target.p256dh, target.auth);
  const jwt = await signVapidJwt(new URL(target.endpoint).origin);

  const cryptoKeyHeader = `keyid=p256dh;dh=${bytesToB64url(ephemeralPublic)},p256ecdsa=${bytesToB64url(vapidPublicRaw())}`;

  try {
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "content-encoding": "aes128gcm",
        encryption: `salt=${bytesToB64url(salt)}`,
        "crypto-key": cryptoKeyHeader,
        authorization: `WebPush ${jwt}`,
        // 24h — these are non-urgent; a missed budget nudge isn't a crisis.
        ttl: "86400",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 || response.status === 410) return "stale";
    if (!response.ok) {
      console.error("Web Push delivery failed", response.status);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("Web Push delivery threw", error);
    return "failed";
  }
}

/** Constant-time compare exported for tests / future key rotation checks. */
export { timingSafeStringEqual };

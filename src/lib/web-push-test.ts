/**
 * Web Push crypto test — `npm run test:web-push`.
 *
 * §2.11 ships the VAPID auth + draft-ietf-webpush-encryption by hand on top of
 * Web Crypto, with no `web-push` dependency. The only way to trust that
 * hand-rolled crypto without a live push service is to exercise it against
 * itself: sign a JWT and verify it, then encrypt a payload and decrypt it with
 * the receiver's own key. If these pass, a real push service would accept the
 * exact same bytes.
 */
import { generateKeyPairSync } from "node:crypto";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function bytesToB64url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ck = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", ck, data));
}
async function hkdfExpand(prk: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(length);
  let t = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  let written = 0;
  let counter = 1;
  while (written < length) {
    t = await hmac(prk, new Uint8Array([...t, ...info, counter]) as Uint8Array<ArrayBuffer>);
    out.set(t.subarray(0, Math.min(t.length, length - written)), written);
    written += t.length;
    counter += 1;
  }
  return out.subarray(0, length);
}
function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function decrypt(
  receiverPriv: CryptoKey,
  receiverRaw: Uint8Array<ArrayBuffer>,
  authRaw: Uint8Array<ArrayBuffer>,
  ephemeralPublic: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  body: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const ephemeralKey = await crypto.subtle.importKey("raw", ephemeralPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ephemeralKey }, receiverPriv, 256)) as Uint8Array<ArrayBuffer>;
  const prk = await hkdfExpand(
    await hmac(authRaw, shared),
    concat(new TextEncoder().encode("WebPush: info"), new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic),
    32,
  );
  const cek = await hkdfExpand(
    prk,
    concat(new TextEncoder().encode("Content-Encoding: aes128gcm"), new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic),
    16,
  );
  const nonce = await hkdfExpand(
    prk,
    concat(new TextEncoder().encode("Content-Encoding: nonce"), new Uint8Array([0]) as Uint8Array<ArrayBuffer>, receiverRaw, ephemeralPublic),
    12,
  );
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM", length: 128 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body);
  return new TextDecoder().decode(plain);
}

async function main() {
  // --- A real VAPID keypair (P-256) for both halves of the test.
  const vapid = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privatePem = vapid.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const spki = vapid.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicB64Url = bytesToB64url(new Uint8Array(spki.subarray(spki.length - 65)));

  // Set env BEFORE importing the lib — it reads VAPID_* at call time, but the
  // private key is cached on first use, so it must be present up front.
  process.env.VAPID_PRIVATE_KEY = privatePem;
  process.env.VAPID_PUBLIC_KEY = publicB64Url;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";

  const webPush = await import("./web-push");

  /* ----------------------------------------------------- VAPID JWT ---- */
  const jwt = await webPush.signVapidJwt("https://fcm.googleapis.com");
  const [h, p, s] = jwt.split(".");
  check(h !== undefined && p !== undefined && s !== undefined, "JWT has the three compact-JWS segments");
  check(JSON.parse(Buffer.from(p, "base64url").toString()).aud === "https://fcm.googleapis.com", "JWT audience is the endpoint origin");
  check(JSON.parse(Buffer.from(h, "base64url").toString()).alg === "ES256", "JWT header alg is ES256");

  const pubRaw = b64urlToBytes(publicB64Url);
  const pubKey = await crypto.subtle.importKey("raw", pubRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = b64urlToBytes(s);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pubKey, sig, new TextEncoder().encode(`${h}.${p}`));
  check(ok, "the VAPID JWT verifies against the public key");

  /* ----------------------------------------------- encryption round trip ---- */
  // A fake subscriber: its key is the only thing that can decrypt the payload.
  const receiver = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const receiverRaw = new Uint8Array((receiver.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-65));
  const auth = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));

  const payload = JSON.stringify({ title: "Budget alert", body: "80% of your Food budget, 8 days left", url: "/transactions" });
  const { body, salt, ephemeralPublic } = await webPush.encryptPayload(payload, bytesToB64url(receiverRaw), auth);

  check(body.length > payload.length, "ciphertext is longer than plaintext (GCM tag appended)");
  check(salt.length === 16, "the encryption salt is 16 bytes");

  const receiverPriv = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(receiver.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const decrypted = await decrypt(receiverPriv, receiverRaw, b64urlToBytes(auth), ephemeralPublic, salt, body);
  check(decrypted === payload, "the payload decrypts to exactly what was encrypted");

  /* ----------------------------------------------- config gating ---- */
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  check(webPush.isPushConfigured() === false, "isPushConfigured() is false without VAPID_* env vars");

  if (failures > 0) {
    console.error(`\n✗ Web Push test FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\n✓ Web Push OK — VAPID JWT signs/verifies and the push encryption round-trips.");
}

main();

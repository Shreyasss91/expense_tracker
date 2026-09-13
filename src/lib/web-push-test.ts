/**
 * Web Push crypto test — `npm run test:web-push`.
 *
 * §2.11 implements VAPID auth + RFC 8291/8188 payload encryption by hand on top
 * of Web Crypto. Hand-rolled crypto needs more than a round trip: encrypting and
 * decrypting with the same (possibly wrong) derivation proves only that the code
 * is self-consistent — which is exactly how a non-conformant key derivation
 * survived this suite before.
 *
 * So the receiver below is a SECOND, independent implementation written from
 * RFC 8188 §2 and RFC 8291 §3.4, and it is pinned to the RFC's own published
 * vectors (RFC 8291 §5 / Appendix A), intermediates included. Only once it
 * reproduces the RFC's shared secret, IKM, PRK, CEK, nonce and plaintext does
 * it prove anything about `encryptPayload`: decrypting OUR output with a
 * vector-verified spec implementation means those bytes are what a real push
 * service and browser expect.
 */
import { generateKeyPairSync } from "node:crypto";

type Bytes = Uint8Array<ArrayBuffer>;

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function bytesToB64url(bytes: Bytes): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(value: string): Bytes {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return new Uint8Array(Buffer.from(padded, "base64")) as Bytes;
}
function utf8(value: string): Bytes {
  return new TextEncoder().encode(value) as Bytes;
}
function u8(value: number): Bytes {
  return new Uint8Array([value]) as Bytes;
}
function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const ck = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", ck, data)) as Bytes;
}
async function hkdfExpand(prk: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const out = new Uint8Array(length);
  let t = new Uint8Array(0) as Bytes;
  let written = 0;
  let counter = 1;
  while (written < length) {
    t = await hmac(prk, new Uint8Array([...t, ...info, counter]) as Bytes);
    out.set(t.subarray(0, Math.min(t.length, length - written)), written);
    written += t.length;
    counter += 1;
  }
  return out.subarray(0, length) as Bytes;
}
async function importEcdhPublic(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

/**
 * RFC 8291 §3.4 + RFC 8188 §2.2–2.3, with every intermediate returned so the
 * RFC's published values can be asserted directly against them.
 */
async function derive(uaPrivate: CryptoKey, uaPublic: Bytes, authSecret: Bytes, salt: Bytes, asPublic: Bytes) {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: await importEcdhPublic(asPublic) }, uaPrivate, 256),
  ) as Bytes;
  // key_info carries the key context; the cek/nonce info strings below are
  // labels + 0x00 only (RFC 8188 §2.2–2.3), and the salt is the extract salt
  // for the content key (RFC 8291 §3.4 "HKDF calculations from RFC 8188").
  const ikm = await hkdfExpand(await hmac(authSecret, shared), concat(utf8("WebPush: info"), u8(0), uaPublic, asPublic), 32);
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, concat(utf8("Content-Encoding: aes128gcm"), u8(0)), 16);
  const nonce = await hkdfExpand(prk, concat(utf8("Content-Encoding: nonce"), u8(0)), 12);
  return { shared, ikm, prk, cek, nonce };
}

/** RFC 8188 §2.1 body framing (salt | rs | idlen | keyid | "records"), then decryption. */
async function decryptBody(uaPrivate: CryptoKey, uaPublic: Bytes, authSecret: Bytes, body: Bytes): Promise<string> {
  const view = new DataView(body.buffer, body.byteOffset);
  const salt = body.subarray(0, 16);
  const rs = view.getUint32(16, false);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const { cek, nonce } = await derive(uaPrivate, uaPublic, authSecret, salt, asPublic);
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM", length: 128 }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext)) as Bytes;

  if (rs < plain.length + 16) throw new Error(`rs ${rs} cannot frame a ${plain.length}-octet record`);
  // RFC 8291 §4: the final record's padding delimiter MUST be 0x02; any other
  // value must cause the message to be discarded.
  if (plain[plain.length - 1] !== 0x02) throw new Error("final record's padding delimiter is not 0x02");
  return new TextDecoder().decode(plain.subarray(0, plain.length - 1));
}

/** RFC 8291 §5 / Appendix A — the published example, in full. */
const RFC = {
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  shared: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  plaintext: "When I grow up, I want to be a watermelon",
};

async function main() {
  /* ----------------------------------------------------- VAPID JWT ---- */
  const vapid = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privatePem = vapid.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const spki = vapid.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicB64Url = bytesToB64url(new Uint8Array(spki.subarray(spki.length - 65)) as Bytes);

  // Set env BEFORE importing the lib — it reads VAPID_* at call time, but the
  // private key is cached on first use, so it must be present up front.
  process.env.VAPID_PRIVATE_KEY = privatePem;
  process.env.VAPID_PUBLIC_KEY = publicB64Url;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";

  const webPush = await import("./web-push");

  const jwt = await webPush.signVapidJwt("https://fcm.googleapis.com");
  const [h, p, s] = jwt.split(".");
  check(h !== undefined && p !== undefined && s !== undefined, "JWT has the three compact-JWS segments");
  check(JSON.parse(Buffer.from(p, "base64url").toString()).aud === "https://fcm.googleapis.com", "JWT audience is the endpoint origin");
  check(JSON.parse(Buffer.from(h, "base64url").toString()).alg === "ES256", "JWT header alg is ES256");

  const pubRaw = b64urlToBytes(publicB64Url);
  const pubKey = await crypto.subtle.importKey("raw", pubRaw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = b64urlToBytes(s);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pubKey, sig, utf8(`${h}.${p}`));
  check(ok, "the VAPID JWT verifies against the public key");

  /* ------------------- RFC 8291 §5 vector — spec conformance ---- */
  // The RFC publishes this example's full intermediate values, so the
  // reference derivation can be checked step by step rather than trusted.
  const rfcUaPublic = b64urlToBytes(RFC.uaPublic);
  const rfcUaPrivate = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(rfcUaPublic.subarray(1, 33) as Bytes),
      y: bytesToB64url(rfcUaPublic.subarray(33, 65) as Bytes),
      d: RFC.uaPrivate,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );

  const rfcBody = b64urlToBytes(RFC.body);
  const rfcView = new DataView(rfcBody.buffer, rfcBody.byteOffset);
  check(bytesToB64url(rfcBody.subarray(0, 16) as Bytes) === "DGv6ra1nlYgDCS1FRnbzlw", "RFC body opens with the published salt");
  check(rfcView.getUint32(16, false) === 4096, "RFC body declares rs = 4096");
  check(rfcBody[20] === 65, "RFC body declares a 65-octet keyid");
  check(bytesToB64url(rfcBody.subarray(21, 86) as Bytes) === RFC.asPublic, "RFC body's keyid is the sender's public key (RFC 8291 §4)");

  const rfcAuth = b64urlToBytes(RFC.authSecret);
  const rfcDerived = await derive(rfcUaPrivate, rfcUaPublic, rfcAuth, rfcBody.subarray(0, 16) as Bytes, rfcBody.subarray(21, 86) as Bytes);
  check(bytesToB64url(rfcDerived.shared) === RFC.shared, "ECDH shared secret matches RFC 8291 Appendix A");
  check(bytesToB64url(rfcDerived.ikm) === RFC.ikm, "IKM matches RFC 8291 Appendix A (auth secret as extract salt, key_info)");
  check(bytesToB64url(rfcDerived.prk) === RFC.prk, "PRK matches (the message salt is the content-key extract salt)");
  check(bytesToB64url(rfcDerived.cek) === RFC.cek, "CEK matches RFC 8291 Appendix A");
  check(bytesToB64url(rfcDerived.nonce) === RFC.nonce, "NONCE matches RFC 8291 Appendix A");
  check((await decryptBody(rfcUaPrivate, rfcUaPublic, rfcAuth, rfcBody)) === RFC.plaintext, "the RFC's own message body decrypts to its plaintext");

  /* ----------------------------------------------- encryption round trip ---- */
  // A fake subscriber: its key is the only thing that can decrypt the payload.
  const receiver = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const receiverRaw = new Uint8Array((receiver.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-65)) as Bytes;
  const auth = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
  const receiverPriv = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(receiver.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer) as Bytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );

  const payload = JSON.stringify({ title: "Budget alert", body: "80% of your Food budget, 8 days left", url: "/transactions" });
  const { body, ephemeralPublic } = await webPush.encryptPayload(payload, bytesToB64url(receiverRaw), auth);

  const view = new DataView(body.buffer, body.byteOffset);
  check(body.length === 86 + utf8(payload).length + 1 + 16, `body is header + plaintext + delimiter + tag (${body.length} octets)`);
  check(view.getUint32(16, false) === 4096, "our body declares rs = 4096");
  check(body[20] === 65, "our body declares a 65-octet keyid");
  check(bytesToB64url(body.subarray(21, 86) as Bytes) === bytesToB64url(ephemeralPublic), "our keyid is the sender's ephemeral public key");
  check(
    (await decryptBody(receiverPriv, receiverRaw, b64urlToBytes(auth), body)) === payload,
    "the payload decrypts to exactly what was encrypted, under the spec derivation",
  );

  const tampered = new Uint8Array(body) as Bytes;
  tampered[0] ^= 0x01; // corrupt the salt, so the derived keys differ
  let rejected = false;
  try {
    await decryptBody(receiverPriv, receiverRaw, b64urlToBytes(auth), tampered);
  } catch {
    rejected = true;
  }
  check(rejected, "a body whose salt was tampered with fails to decrypt (GCM integrity)");

  /* ----------------------------------------------- config gating ---- */
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  check(webPush.isPushConfigured() === false, "isPushConfigured() is false without VAPID_* env vars");

  if (failures > 0) {
    console.error(`\n✗ Web Push test FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\n✓ Web Push OK — the RFC's own vector decrypts, and our encrypted payload round-trips through a spec-conformant receiver.");
}

main();

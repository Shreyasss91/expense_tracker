/**
 * VAPID key generator for §2.11 — `node scripts/generate-vapid.mjs`.
 *
 * Prints three values to paste into .env.local / the deployment platform:
 *
 *   VAPID_PUBLIC_KEY  — base64url of the uncompressed 65-byte P-256 point.
 *                        This is the CLIENT-side value: it ships in
 *                        NEXT_PUBLIC_VAPID_PUBLIC_KEY and is handed to
 *                        pushManager.subscribe(). No secret.
 *   VAPID_PRIVATE_KEY — the EC private key as a PKCS#8 PEM. The server signs
 *                        the VAPID JWT with this; keep it server-only.
 *   VAPID_SUBJECT     — a mailto: or https: contact, required by the VAPID spec.
 *
 * The app's Web Push sender (src/lib/web-push.ts) reads all three and needs no
 * npm dependency — it signs ES256 with Web Crypto and does the push encryption
 * inline. So this script is the only place the keys are ever "generated".
 */
import { generateKeyPairSync } from "node:crypto";

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

// SPKI DER for a P-256 key is 91 bytes; the public point is the final 65.
const spki = publicKey.export({ type: "spki", format: "der" });
const point = spki.subarray(spki.length - 65);
const publicB64Url = toBase64Url(point);

console.log("# --- paste into .env.local (server) and Vercel project env ---\n");
console.log(`VAPID_PUBLIC_KEY="${publicB64Url}"`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${publicB64Url}"`);
console.log(`VAPID_PRIVATE_KEY="${privatePem.replace(/\n/g, "\\n")}"`);
console.log(`VAPID_SUBJECT="mailto:family@example.com"`);

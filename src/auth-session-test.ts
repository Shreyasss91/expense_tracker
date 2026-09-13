/**
 * §3.1 session revocation on master-password change — `npm run test:password-session`.
 *
 * DB-free and server-free. Proves the property this app previously lacked: the
 * session cookie is a stateless JWT (§1.8), so it stays signature-valid after
 * `FAMILY_MASTER_PASSWORD` changes — and `updateAge` rolls an active holder
 * forward indefinitely. `auth.config.ts` now pins a keyed fingerprint of the
 * password into the token at sign-in and re-checks it on every request.
 *
 * The REAL `jwt`/`session`/`authorized` callbacks are exercised, not a
 * re-implementation, so the wiring itself is what is under test.
 */
import { authConfig } from "@/auth.config";
import { masterPasswordFingerprint } from "@/lib/secure-compare";

type LooseToken = Record<string, unknown>;
type LooseSession = {
  user?: { name?: string | null; role?: string | null } | undefined;
  expires: string;
};

// The callbacks are contextually typed by next-auth with params this test has
// no business fabricating (account, profile, trigger…), so exercise them
// through narrow signatures instead.
const runJwt = authConfig.callbacks.jwt as unknown as (args: {
  token: LooseToken;
  user?: { role?: string } | null;
}) => Promise<LooseToken>;
const runSession = authConfig.callbacks.session as unknown as (args: {
  session: LooseSession;
  token: LooseToken;
}) => LooseSession;
const runAuthorized = authConfig.callbacks.authorized as unknown as (args: {
  auth: LooseSession | null;
  request: { nextUrl: URL };
}) => boolean | Response;

const ORIGINAL_ENV = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  FAMILY_MASTER_PASSWORD: process.env.FAMILY_MASTER_PASSWORD,
};

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string) {
  console.log(`✓ ${msg}`);
}

function setEnv(secret: string | undefined, password: string | undefined) {
  if (secret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = secret;
  if (password === undefined) delete process.env.FAMILY_MASTER_PASSWORD;
  else process.env.FAMILY_MASTER_PASSWORD = password;
}

function assert(condition: boolean, msg: string) {
  if (!condition) fail(msg);
  ok(msg);
}

function freshSession(): LooseSession {
  return { user: { name: "Family", role: "family_admin" }, expires: "2099-01-01T00:00:00.000Z" };
}

function requestFor(path: string) {
  return { nextUrl: new URL(`https://family.example${path}`) };
}

/**
 * One authenticated request: next-auth runs `jwt` first (re-deriving the
 * password fingerprint) and hands its result to `session`, which decides
 * whether the holder is still signed in. Modelling both steps matters —
 * inspecting the sign-in token in isolation would prove nothing about what a
 * later request sees.
 */
async function openRequest(token: LooseToken): Promise<LooseSession> {
  const refreshed = await runJwt({ token: { ...token } });
  return runSession({ session: freshSession(), token: refreshed });
}

async function main() {
  // --- the fingerprint itself -------------------------------------------------
  setEnv("auth-secret-a", "12345");
  const first = await masterPasswordFingerprint();
  const second = await masterPasswordFingerprint();
  assert(first === second, "fingerprint is deterministic for a fixed env");
  assert(first !== "unconfigured", "fingerprint is derived when both env vars are set");
  assert(!first.includes("12345"), "fingerprint does not contain the password verbatim");

  setEnv("auth-secret-a", "21011994");
  const rotatedPassword = await masterPasswordFingerprint();
  assert(rotatedPassword !== first, "fingerprint changes when the password changes");

  setEnv("auth-secret-b", "21011994");
  const rotatedSecret = await masterPasswordFingerprint();
  assert(rotatedSecret !== rotatedPassword, "fingerprint changes when AUTH_SECRET changes");

  setEnv(undefined, "21011994");
  assert((await masterPasswordFingerprint()) === "unconfigured", "missing AUTH_SECRET fails closed");

  // --- sign-in pins the password ---------------------------------------------
  setEnv("auth-secret-a", "12345");
  const signedIn = await runJwt({ token: {}, user: { role: "family_admin" } });
  assert(signedIn.role === "family_admin", "sign-in keeps the family_admin role");
  assert(
    !JSON.stringify(signedIn).includes("12345"),
    "the issued token never carries the master password",
  );

  // --- unchanged password: the holder stays signed in ------------------------
  const stillValid = await openRequest(signedIn);
  assert(!!stillValid.user, "an unchanged password leaves the existing session signed in");
  assert(
    runAuthorized({ auth: stillValid, request: requestFor("/") }) === true,
    "authorized() admits a session whose password fingerprint is current",
  );

  // --- password changed: the existing token is retired -----------------------
  setEnv("auth-secret-a", "21011994");
  const afterChange = await openRequest(signedIn);
  assert(
    afterChange.user === undefined,
    "changing the password signs the existing session out",
  );
  assert(
    runAuthorized({ auth: afterChange, request: requestFor("/") }) === false,
    "authorized() rejects the retired session (→ redirect to /login)",
  );
  assert(
    runAuthorized({ auth: afterChange, request: requestFor("/login") }) === true,
    "the retired session can still reach /login to re-authenticate",
  );

  // --- legacy token, issued before this change, carries no claim at all -------
  assert(
    (await openRequest({ role: "family_admin" })).user === undefined,
    "a pre-existing token without the fingerprint claim is treated as signed out",
  );

  // --- AUTH_SECRET rotation also retires sessions ----------------------------
  setEnv("auth-secret-b", "21011994");
  const reissued = await runJwt({ token: {}, user: { role: "family_admin" } });
  setEnv("auth-secret-a", "21011994");
  assert(
    (await openRequest(reissued)).user === undefined,
    "rotating AUTH_SECRET alone also retires sessions",
  );

  setEnv(ORIGINAL_ENV.AUTH_SECRET, ORIGINAL_ENV.FAMILY_MASTER_PASSWORD);
  console.log("\nAll master-password session-revocation checks passed.");
}

main().catch((error) => {
  setEnv(ORIGINAL_ENV.AUTH_SECRET, ORIGINAL_ENV.FAMILY_MASTER_PASSWORD);
  fail(error instanceof Error ? error.message : String(error));
});

/**
 * Shared helper for the live-site scripts (smoke-prod, export-live-check).
 * Logs into the deployed app through the real NextAuth credentials flow and
 * returns a fetch bound to the base URL that carries the session cookie.
 *
 * Also owns `.env.local` loading (see `loadLiveEnv`): these scripts talk to
 * PRODUCTION, so a stale secret silently winning over the file is worse than
 * no secret at all.
 */
import { existsSync, readFileSync } from "node:fs";
import { parse as parseEnvFile } from "dotenv";

const timeout = (ms = 60000) => AbortSignal.timeout(ms);

/**
 * Load `.env.local` for the live scripts, refusing to run when the ambient
 * environment shadows it with a different value.
 *
 * `dotenv` never overrides an existing variable — deliberate, but it means an
 * exported `FAMILY_MASTER_PASSWORD` silently beats the file. A smoke test then
 * logs in with the WRONG password, gets a bare 302, and reports "wrong master
 * password", pointing the investigation at production instead of at the shell.
 * The inverse is worse: an exported `PROD_URL` or `CRON_SECRET` would run the
 * checks against a different target entirely.
 *
 * So a difference is fatal, not a warning, and it is detected BEFORE anything
 * is merged — afterwards the two sources are indistinguishable.
 *
 * CI is unaffected: `.env.local` is gitignored, so the file is absent there and
 * the workflow's own env vars are the only source — nothing to conflict with.
 *
 * Deliberate override (e.g. aiming a run at a preview deployment):
 * `ALLOW_ENV_OVERRIDE=1`. Values are never printed — these are secrets.
 */
export function loadLiveEnv(path = ".env.local") {
  if (!existsSync(path)) return; // CI: the environment is the only source.

  const file = parseEnvFile(readFileSync(path, "utf8"));
  const shadowed = Object.entries(file).filter(
    ([key, value]) => process.env[key] !== undefined && process.env[key] !== value,
  );

  // Merge only what is missing, matching dotenv's non-override semantics, so a
  // half-exported shell still picks up the file's other values.
  for (const [key, value] of Object.entries(file)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  if (shadowed.length === 0) return;

  const names = shadowed.map(([key]) => key);
  if (process.env.ALLOW_ENV_OVERRIDE === "1") {
    console.log(
      `⚠ ${names.length} variable(s) from ${path} overridden by the environment (ALLOW_ENV_OVERRIDE=1): ${names.join(", ")}`,
    );
    return;
  }

  console.error(
    `✗ ${names.length} variable(s) from ${path} are shadowed by the environment — ` +
      "dotenv never overrides an existing variable, so the shell value wins:",
  );
  for (const name of names) console.error(`    ${name}  (value differs from ${path})`);
  console.error(`  Fix: \`unset ${names.join(" ")}\`, or pass the intended value inline`);
  console.error(`  (e.g. \`${names[0]}=<value> npm run <script>\`).`);
  console.error("  Aiming at a different target on purpose? Set ALLOW_ENV_OVERRIDE=1.");
  process.exit(1);
}

export async function login(base, password) {
  // Fail fast on a missing argument, BEFORE any request. Without this,
  // `login(BASE)` posts `password=undefined`, NextAuth answers 302, and the
  // caller reports "wrong master password or missing env?" — which blames
  // production for a call-site mistake and sends the investigation there.
  if (typeof base !== "string" || base.length === 0) {
    throw new TypeError("login(base, password) called without a base URL");
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError(
      "login(base, password) called without a password — pass the master password through",
    );
  }

  const jar = new Map();

  function setCookies(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  const csrfRes = await fetch(`${base}/api/auth/csrf`, { signal: timeout() });
  setCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const authRes = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    signal: timeout(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: base,
      cookie: cookieHeader(),
    },
    body: new URLSearchParams({ csrfToken, password }),
  });
  setCookies(authRes);

  if (![...jar.keys()].some((k) => k.includes("session-token"))) {
    throw new Error(`login failed (status ${authRes.status}) — wrong master password or missing env?`);
  }

  return {
    cookie: cookieHeader(),
    fetch: (path, opts = {}) =>
      fetch(`${base}${path}`, {
        ...opts,
        signal: opts.signal ?? timeout(),
        headers: { ...(opts.headers ?? {}), cookie: cookieHeader() },
      }),
  };
}

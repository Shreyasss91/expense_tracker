/**
 * Shared helper for the live-site scripts (smoke-prod, export-live-check).
 * Logs into the deployed app through the real NextAuth credentials flow and
 * returns a fetch bound to the base URL that carries the session cookie.
 */
const timeout = (ms = 60000) => AbortSignal.timeout(ms);

export async function login(base, password) {
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

/**
 * The WhatsApp sender agent — Termux + Baileys, running on Dad's phone.
 *
 * It posts ONE message a day into a private family WhatsApp group: the ledger
 * changes the server rendered for the 24 hours ending at 22:00 IST. Everything
 * about *what* the message says lives on the server; this process only decides
 * *whether* there is anything to send, sends it, and records that it did.
 *
 * NORMATIVE SOURCES — read these before changing anything here:
 *   - `docs/PLAN_WHATSAPP_AGENT_TERMUX.md` — this component's implementation plan
 *     (phone setup, CLI surface, exit codes, the retry ladder, acceptance tests)
 *   - `docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md` §6 — the contract it consumes
 *
 * Deliberately NOT this agent's job (plan §1.3): it does no formatting, touches
 * no database, knows nothing about the window beyond echoing back the
 * `windowKey` it computed, and never reads incoming messages.
 *
 * ---------------------------------------------------------------------------
 * Why this file is shaped the way it is
 * ---------------------------------------------------------------------------
 *
 * **1. The boundary math is pure and exported.** `windowKeyFor(lastBoundary(t))`
 * must be BYTE-IDENTICAL to the server's `feedWindowForInstant(t).key` — that
 * string is the entire idempotency contract, and it is the first thing to check
 * if a double-post is ever seen. Keeping it pure and side-effect-free lets
 * `agent-test.ts` cross-check it against the server's real implementation at many
 * instants, which is the only way to verify it without a phone.
 *
 * **2. Baileys is imported lazily.** A dynamic `import()` inside `connect()`
 * means this module can be imported for testing without the dependency being
 * installed. Nothing at module scope touches the network, the filesystem or
 * `process.exit`.
 *
 * **3. The retry ladder is persisted, and exhaustion is a state, not an exit.**
 * `start.sh` restarts the process on a crash; an in-memory ladder would be
 * re-created empty on every restart and re-armed from +2 minutes, forever. The
 * state lives in `sent/retry-state.json` (plan §6.4).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ paths -- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");
const AUTH_DIR = path.join(HERE, "auth");
const SENT_DIR = path.join(HERE, "sent");
const LOCK_PATH = path.join(SENT_DIR, "agent.lock");
const RETRY_PATH = path.join(SENT_DIR, "retry-state.json");
const LOG_PATH = path.join(HERE, "agent.log");

/** Rotate past ~1 MB by truncating. One file is enough; no logging framework. */
const LOG_MAX_BYTES = 1024 * 1024;

/* -------------------------------------------------------------- constants -- */

/** IST is a fixed +05:30 with no DST — but it is applied explicitly, never read from the device. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The canonical boundary hour, matching the server's `FEED_HOUR_IST`. */
export const FEED_HOUR_IST = 22;

/**
 * Retry offsets in minutes, indexed by the number of failures so far: after the
 * 1st failure wait 2 min, after the 2nd 5, after the 3rd 15, after the 4th 30,
 * and after the 5th there is no offset left — that is exhaustion (plan §6.4).
 */
export const RETRY_OFFSETS_MIN = [0, 2, 5, 15, 30];

/** Exit codes — normative (plan §5.8). `start.sh` branches on these. */
export const EXIT = {
  OK: 0,
  FATAL: 1, // unexpected crash; start.sh restarts after 30 s
  CONFIG: 2, // bad config or args — a human must fix it, never auto-restart
  RELINK: 3, // WhatsApp returned 401 on the socket — re-run --link
  AUTH: 4, // API 401/503 — fix the token
  LOCKED: 7, // another instance holds sent/agent.lock
  LINK_TIMEOUT: 8, // --link produced no code, or the code was never confirmed
};

const LINK_QR_TIMEOUT_MS = 60_000;
const LINK_OPEN_TIMEOUT_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Cap on the outgoing-message store. Exactly ONE message is sent per night and
 * WhatsApp's retry request arrives within seconds of the send, so 50 entries is
 * years of headroom while keeping the map bounded on a phone.
 */
const OUTGOING_MESSAGE_CACHE_MAX = 50;

/** Cached group metadata is trusted for this long before Baileys refetches it. */
const GROUP_METADATA_TTL_MS = 5 * 60 * 1000;

/**
 * Shown in WhatsApp's Linked-devices list. A truthful desktop-ish name is better
 * than a fake one — the household will see this entry and may want to remove it.
 */
const BAILEYS_BROWSER = ["Family Ledger", "Termux", "1.0.0"];

/* ------------------------------------------------------------- pure maths --- */

/** IST calendar date (YYYY-MM-DD) of an instant. */
function istDateOf(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The next 22:00 IST instant after `now` — when the scheduler should fire.
 *
 * Shifts into IST, floors to the IST day, adds the boundary hour, shifts back.
 * Never uses `getHours()` or any device-local accessor (plan §6.2).
 */
export function nextBoundary(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const boundaryIst = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    FEED_HOUR_IST,
    0,
    0,
    0,
  );
  let boundary = boundaryIst - IST_OFFSET_MS;
  if (boundary <= now.getTime()) boundary += 24 * 60 * 60 * 1000;
  return new Date(boundary);
}

/**
 * The **most recent** 22:00 IST instant at or before `now` — the window the
 * agent is responsible for.
 *
 * This reproduces SPEC §5.1 step 4 exactly, and that is what makes an early fire
 * harmless: at 21:30 the target is *yesterday's* window, which is almost
 * certainly already marked, so nothing is posted. Do NOT "fix" this by clamping
 * forward to tonight's boundary — that would post a partial window and then let
 * the marker suppress the rest of the day.
 */
export function lastBoundary(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const boundaryIst = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    FEED_HOUR_IST,
    0,
    0,
    0,
  );
  const boundary = boundaryIst - IST_OFFSET_MS;
  return new Date(boundary <= now.getTime() ? boundary : boundary - 24 * 60 * 60 * 1000);
}

/**
 * `"<startDateIst>..<endDateIst>"` for the 24 h window ENDING at `endBoundary`.
 *
 * The server computes this same string (`window.key`), and a mismatch is a
 * contract violation worth logging loudly — `agent-test.ts` pins the two
 * implementations together so it should be unreachable.
 */
export function windowKeyFor(endBoundary) {
  const start = new Date(endBoundary.getTime() - 24 * 60 * 60 * 1000);
  return `${istDateOf(start)}..${istDateOf(endBoundary)}`;
}

/* ------------------------------------------------------------------- time -- */

/** `YYYY-MM-DD HH:mm:ss` in IST, for log lines. */
function istStamp(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "invalid-date";
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

export function maskPhone(phone) {
  const digits = String(phone ?? "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 2)}••••••${digits.slice(-4)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ logging - */

let currentLevel = process.env.AGENT_LOG_LEVEL ?? "info";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Rotate before writing, so a long-running process cannot fill the phone's storage. */
function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > LOG_MAX_BYTES) {
      fs.writeFileSync(LOG_PATH, `[${istStamp(new Date())} IST] INFO log rotated at ${LOG_MAX_BYTES} bytes\n`);
    }
  } catch {
    // No log file yet — nothing to rotate.
  }
}

/**
 * One line to stdout and to `agent.log`.
 *
 * Never pass a token, an Authorization header or a response body to this.
 */
export function log(level, message, meta) {
  if ((LEVELS[level] ?? 20) < (LEVELS[currentLevel] ?? 20)) return;
  const line = `[${istStamp(new Date())} IST] ${level.toUpperCase()} ${message}${meta ? ` ${meta}` : ""}`;
  console.log(line);
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_PATH, `${line}\n`);
  } catch {
    // A read-only directory must not take the agent down; stdout still has it.
  }
}

/** Only string arguments, truncated — Baileys passes payload objects we must not dump. */
function describeArgs(args) {
  return args
    .filter((a) => typeof a === "string")
    .join(" ")
    .slice(0, 200);
}

/**
 * Baileys wants a pino-shaped logger. Ours forwards only errors, and only the
 * string arguments: at info/debug Baileys logs message payloads, which would put
 * the household's ledger into a file on the phone.
 */
const baileysLogger = {
  level: "error",
  child: () => baileysLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error(...args) {
    const text = describeArgs(args);
    if (text) log("error", `baileys: ${text}`);
  },
  fatal(...args) {
    const text = describeArgs(args);
    if (text) log("error", `baileys: ${text}`);
  },
};

/* ------------------------------------------------------------------- config - */

const DIGITS_RE = /^\d{8,15}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate a parsed `config.json` (§3.5 of the plan). Pure, so it is testable.
 *
 * `phone` is required even for modes that do not use it, because the failure it
 * prevents — requesting a pairing code for a silently mangled number — is far
 * worse than a startup refusal. Nothing here strips characters: a number with a
 * `+` or spaces is an ERROR, never a silent repair.
 */
export function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["config.json must contain an object"] };

  const apiUrl = typeof raw.apiUrl === "string" ? raw.apiUrl.trim().replace(/\/+$/, "") : "";
  if (!/^https?:\/\/\S+$/.test(apiUrl)) errors.push("apiUrl must be an absolute http(s) URL");

  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!token) errors.push("token is required (the server's DIGEST_AGENT_TOKEN)");
  else if (token.length < 16) errors.push("token looks truncated — expected at least 16 characters");

  const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
  if (!DIGITS_RE.test(phone)) {
    errors.push("phone must be E.164 digits only (e.g. \"919876543210\") — no \"+\", no spaces, no dashes");
  }

  const groupJid = typeof raw.groupJid === "string" ? raw.groupJid.trim() : "";
  if (groupJid && !/^[\d-]+@g\.us$/.test(groupJid)) errors.push("groupJid must look like 1203630xxxxxxxxx@g.us");

  const sendAt = typeof raw.sendAt === "string" ? raw.sendAt.trim() : "22:00";
  if (!TIME_RE.test(sendAt)) errors.push("sendAt must be HH:MM");
  else if (sendAt !== "22:00") {
    // Not a nicety: the boundary is fixed at 22:00 IST SERVER-side, and the
    // window key must match byte-for-byte. A different value here would not
    // change when the post happens — it would only mislead the next reader.
    errors.push(
      "sendAt must be \"22:00\": the window boundary is fixed server-side (22:00 IST) and this agent's key must match it exactly. A different value would not change the schedule, only mislead.",
    );
  }

  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "Asia/Kolkata";
  if (timezone !== "Asia/Kolkata") {
    errors.push(
      "timezone must be \"Asia/Kolkata\": the boundary is applied as a constant +05:30 and the device timezone is never read.",
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], config: { apiUrl, token, phone, groupJid, sendAt, timezone } };
}

/** Read + validate. Exits `2` on failure — a human must fix the file. */
function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    log("error", `cannot read ${CONFIG_PATH}: ${err.code === "ENOENT" ? "file is missing" : err.message}`);
    log("error", "copy config.example.json to config.json and fill it in (see README.md)");
    process.exit(EXIT.CONFIG);
  }
  const result = validateConfig(raw);
  if (!result.ok) {
    for (const problem of result.errors) log("error", `config.json: ${problem}`);
    process.exit(EXIT.CONFIG);
  }
  return result.config;
}

/* -------------------------------------------------------------- filesystem -- */

function ensureDirs() {
  for (const dir of [SENT_DIR, AUTH_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Write, then rename. A power cut must never leave a half-written marker: a
 * truncated `sent/<key>.json` still reads as "sent" and would silently suppress
 * the night's post (plan §5.9).
 */
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the lock ----- */

/**
 * `sent/agent.lock`, exclusive create, holding the owning PID.
 *
 * Every mode takes it — including `--link` and `--groups`. Two processes sharing
 * one `auth/` directory corrupt the session, and two processes evaluating the
 * same window race each other's check-then-write and can BOTH post. A note in a
 * README is not a fix for that (plan §5.9).
 */
function acquireLock() {
  ensureDirs();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const holder = Number.parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10);
      let alive = false;
      if (Number.isInteger(holder) && holder > 0) {
        try {
          process.kill(holder, 0);
          alive = true;
        } catch (probe) {
          alive = probe.code === "EPERM";
        }
      }
      if (alive) {
        log("error", `another instance is running (pid ${holder}) — exiting. Stop it first: pkill -f agent.mjs && pkill -f start.sh`);
        process.exit(EXIT.LOCKED);
      }
      log("warn", `removing a stale lock left by pid ${holder || "?"}`);
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch {
        // Someone else removed it in the meantime — the retry will tell us.
      }
    }
  }
  log("error", "could not acquire sent/agent.lock");
  process.exit(EXIT.LOCKED);
}

function releaseLock() {
  try {
    const holder = Number.parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10);
    if (holder === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    // Already gone, or never written — nothing to release.
  }
}

/* --------------------------------------------------- markers and the ladder - */

/** True when this window has already been resolved locally. */
export function hasLocalMarker(key) {
  return fs.existsSync(path.join(SENT_DIR, `${key}.json`));
}

/**
 * Record that this window is finished. Written AFTER a successful send, and also
 * for every non-failure outcome (see `finish()` below) — a window whose contents
 * are frozen must not be re-fetched all evening.
 */
function writeLocalMarker(key, extra) {
  const body = { windowKey: key, recordedAt: new Date().toISOString(), ...extra };
  writeFileAtomic(path.join(SENT_DIR, `${key}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

export function freshState(key) {
  return { key, attempts: 0, firstFailureAt: null, nextAttemptAt: null, exhausted: false };
}

/** Advance the ladder by one failure. Pure; the caller persists the result. */
export function advanceLadder(state, now) {
  const attempts = (state.attempts ?? 0) + 1;
  const firstFailureAt = state.firstFailureAt ?? now.toISOString();
  const offsetMin = RETRY_OFFSETS_MIN[attempts];
  const exhausted = offsetMin === undefined;
  return {
    key: state.key,
    attempts,
    firstFailureAt,
    nextAttemptAt: exhausted ? null : new Date(Date.parse(firstFailureAt) + offsetMin * 60_000).toISOString(),
    exhausted,
  };
}

/**
 * The pre-network gate. Pure — everything it needs is injected, so the decision
 * itself is unit-tested rather than re-derived by reading the scheduler.
 *
 * Returns `run: false` for "do nothing at all", which means ZERO network calls.
 * The tick runs every 60 s; polling a database-backed endpoint ~1,440 times a
 * day to re-learn an answer that changes once a day is exactly what this
 * prevents.
 */
export function gateFor({ key, state, hasMarker, now }) {
  const effective = state && state.key === key ? state : freshState(key);
  if (hasMarker) return { run: false, key, state: effective, reason: "already-posted" };
  if (effective.exhausted) return { run: false, key, state: effective, reason: "exhausted" };
  if (effective.nextAttemptAt && now.getTime() < Date.parse(effective.nextAttemptAt)) {
    return { run: false, key, state: effective, reason: "waiting" };
  }
  return { run: true, key, state: effective, reason: "due" };
}

function loadRetryState() {
  return readJsonSafe(RETRY_PATH);
}

function saveRetryState(state) {
  writeFileAtomic(RETRY_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

/** Drop the ladder for a finished window. Leaves a newer window's state alone. */
function clearState(key) {
  const state = loadRetryState();
  if (!state) return;
  if (state.key && state.key !== key) return;
  try {
    fs.unlinkSync(RETRY_PATH);
  } catch {
    // Already gone.
  }
}

/* ---------------------------------------------------- Baileys-side caches --- */

/**
 * Outgoing messages by id, so Baileys can answer WhatsApp's "resend that".
 *
 * A redelivery needs the ORIGINAL message returned by id. Without it the retry
 * cannot happen — and the dangerous part is how that looks from here:
 * `sendMessage()` resolves either way, so `tick()` would write the local marker
 * and POST `status: "sent"` for a message that never reached the group, while
 * the 22:15 fallback stayed silent because the server now has a record. That is
 * exactly the silent miss this feature exists to prevent.
 */
const sentMessages = new Map();

/** Remember a sent message for the retry path. Exported for the repo-side test. */
export function rememberMessage(message) {
  const id = message?.key?.id;
  if (typeof id !== "string" || id.length === 0) return;
  sentMessages.set(id, message);
  while (sentMessages.size > OUTGOING_MESSAGE_CACHE_MAX) {
    const oldest = sentMessages.keys().next().value;
    sentMessages.delete(oldest);
  }
}

/** The stored message for a retry, or `undefined` (Baileys then cannot resend). */
export function messageForRetry(id) {
  return sentMessages.get(id);
}

/**
 * A `Map`-backed stand-in for Baileys' `msgRetryCounterCache`.
 *
 * Baileys wants an object with `get`/`set`/`del`/`flushAll`. The counter it keeps
 * is consulted on every retry, so it belongs with `getMessage` above — and one
 * Map costs nothing next to a dependency on a phone.
 */
export function createCacheStore() {
  const store = new Map();
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    del: (key) => {
      store.delete(key);
    },
    flushAll: () => {
      store.clear();
    },
  };
}

const msgRetryCounterCache = createCacheStore();

/**
 * Group metadata by JID.
 *
 * A group send builds its encryption envelope from the participant list, and
 * without this cache Baileys asks WhatsApp for that list on EVERY send — which
 * upstream calls "one of the most common causes of group message failures". A
 * miss, or an entry past the TTL, returns `undefined`: that is Baileys'
 * documented fallback, and it does the live fetch itself.
 */
const groupMetadataCache = new Map();

function readCachedGroupMetadata(jid) {
  const hit = groupMetadataCache.get(jid);
  if (!hit) return undefined;
  return Date.now() - hit.at < GROUP_METADATA_TTL_MS ? hit.meta : undefined;
}

/** Refresh one group's metadata. Best-effort — a failure only costs a live fetch later. */
async function warmGroupMetadata(sock, jid) {
  if (!jid) return;
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta) groupMetadataCache.set(jid, { meta, at: Date.now() });
  } catch (err) {
    log("warn", `could not cache group metadata for ${jid}: ${String(err?.message ?? err).slice(0, 120)}`);
  }
}

/* ------------------------------------------------------------- Baileys ------ */

async function loadBaileys() {
  try {
    return await import("@whiskeysockets/baileys");
  } catch (err) {
    log("error", `cannot load @whiskeysockets/baileys: ${err.message}`);
    log("error", "run `npm install --legacy-peer-deps` in this directory (see README.md)");
    process.exit(EXIT.CONFIG);
  }
}

function isLoggedOut(update) {
  const status = update?.lastDisconnect?.error?.output?.statusCode;
  return status === 401;
}

/**
 * Create the socket and hand back its lifecycle as promises.
 *
 * `opened` rejects on a 401 close (WhatsApp unlinked the device) after logging a
 * greppable RE-LINK line — a silent retry loop against an invalidated session
 * looks identical to a healthy agent from the outside, which is the worst
 * failure mode available here (plan §5.3). `closed` resolves on any other close
 * so the caller can reconnect with backoff.
 */
async function openSocket({ onQr, groupJid = null }) {
  const { default: makeWASocket, useMultiFileAuthState } = await loadBaileys();
  // `useMultiFileAuthState` is Baileys' own API name, not a React hook — the
  // `use` prefix trips `react-hooks/rules-of-hooks` in a repo that lints .mjs.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const auth = await useMultiFileAuthState(AUTH_DIR);
  // `state` in current releases, `authState` in older ones — accept either.
  const creds = auth.state ?? auth.authState;
  const saveCreds = auth.saveCreds;

  const sock = makeWASocket({
    auth: creds,
    logger: baileysLogger,
    browser: BAILEYS_BROWSER,
    syncFullHistory: false,
    // Retry support. WhatsApp's redelivery path needs the original message back
    // and the counter cache is the other half of the same handshake; without
    // both, a failed delivery is indistinguishable from a delivered one — see
    // `rememberMessage` above.
    getMessage: async (key) => messageForRetry(key?.id),
    msgRetryCounterCache,
    // A group send would otherwise re-fetch the participant list from WhatsApp
    // every time (see `groupMetadataCache`).
    cachedGroupMetadata: async (jid) => readCachedGroupMetadata(jid),
    // Never `printQRInTerminal`: a QR shown on this phone cannot be scanned by
    // this phone (plan §1.1).
  });
  sock.ev.on("creds.update", saveCreds);

  let resolveOpen;
  let rejectOpen;
  let resolveClose;
  const opened = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  const closed = new Promise((resolve) => {
    resolveClose = resolve;
  });

  // Keep the cached metadata honest: a membership change is exactly when a stale
  // participant list would produce an envelope WhatsApp cannot deliver.
  sock.ev.on("groups.update", ([event]) => {
    if (groupJid && event?.id === groupJid) void warmGroupMetadata(sock, groupJid);
  });
  sock.ev.on("group-participants.update", (event) => {
    if (groupJid && event?.id === groupJid) void warmGroupMetadata(sock, groupJid);
  });

  sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      // Used purely as a TRIGGER for requestPairingCode — the string is never
      // rendered (plan §3.7).
      onQr?.();
    }
    if (update.connection === "open") {
      log("info", `connected as ${maskPhone(sock.user?.id?.split(":")[0] ?? "")}`);
      // Warm the cache for the one group this agent posts to, so the 22:00 send
      // does not pay for a live participant fetch.
      void warmGroupMetadata(sock, groupJid);
      resolveOpen();
      return;
    }
    if (update.connection === "close") {
      if (isLoggedOut(update)) {
        log("error", "RE-LINK REQUIRED: run 'node agent.mjs --link'");
        process.exit(EXIT.RELINK);
      }
      // 403 is the close WhatsApp uses when it refuses the session outright —
      // the restriction risk the plan accepts for Dad's primary number. It is
      // deliberately NOT terminal (upstream: "any other error is safe to
      // retry", and only a 401 means the device was unlinked), so the reconnect
      // loop stays; but it must be greppable, because a restricted number is not
      // a flaky network and the two need different fixes.
      if (update.lastDisconnect?.error?.output?.statusCode === 403) {
        log(
          "error",
          "WhatsApp REFUSED the session (403 forbidden) — the linked number may be restricted. Retrying, but this is not a network problem.",
        );
      }
      log("warn", `socket closed (${update.lastDisconnect?.error?.message ?? "unknown reason"})`);
      rejectOpen(new Error("socket closed before it opened"));
      resolveClose();
    }
  });

  return { sock, saveCreds, opened, closed };
}

/* ----------------------------------------------------------------- HTTP ----- */

/**
 * `GET /api/digest/day` (§5.4). Returns a discriminated result instead of
 * throwing, because the four outcomes need four different responses and only one
 * of them feeds the retry ladder.
 */
async function fetchDigest(cfg, now, useAt) {
  const url = new URL("/api/digest/day", cfg.apiUrl);
  if (useAt) url.searchParams.set("at", now.toISOString());
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 200) {
    try {
      return { kind: "ok", body: await res.json() };
    } catch {
      return { kind: "transient", status: 200, detail: "unparseable JSON body" };
    }
  }
  if (res.status === 401 || res.status === 503) return { kind: "auth", status: res.status };
  if (res.status >= 500) return { kind: "transient", status: res.status };
  return { kind: "fatal", status: res.status };
}

/**
 * The confirmation POST (§5.6). Best-effort by design: if it fails, the message
 * still went out, and the 22:15 fallback push will fire because the server has
 * no record. One unnecessary nudge is strictly better than double-posting the
 * ledger into the family group.
 */
async function confirm(cfg, key, status, detail) {
  try {
    const res = await fetch(new URL("/api/digest/day", cfg.apiUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ windowKey: key, status, detail }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) log("info", `confirmed window=${key}`);
    else log("warn", `confirmation rejected (${res.status}) for window=${key} — the fallback push may fire`);
  } catch (err) {
    log("warn", `confirmation failed for window=${key}: ${err.message} — not re-sending`);
  }
}

/* ------------------------------------------------------------- the ladder --- */

function recordFailure(key, now, err) {
  const previous = loadRetryState();
  const base = previous && previous.key === key ? previous : freshState(key);
  const next = advanceLadder(base, now);
  saveRetryState(next);
  const why = err ? `: ${String(err.message ?? err).slice(0, 160)}` : "";
  if (next.exhausted) {
    log("warn", `attempt ${next.attempts} failed${why} — ladder exhausted, no further attempts tonight`);
  } else {
    log("warn", `attempt ${next.attempts} failed${why} — next attempt ${istStamp(next.nextAttemptAt)} IST`);
  }
  return next;
}

/* ------------------------------------------------------------------ tick ---- */

let lastQuietReason = null;

/**
 * One evaluation of "should I post right now?". The whole scheduler is this
 * function plus a timer (plan §6.1).
 */
async function tick(ctx, { dryRun = false } = {}) {
  const now = ctx.fixedNow ?? new Date();
  const key = windowKeyFor(lastBoundary(now));
  const hasMarker = hasLocalMarker(key);
  const gate = gateFor({ key, state: loadRetryState(), hasMarker, now });

  if (!gate.run) {
    // Log the decision once per (key, reason) so the log shows a live agent
    // without writing a line every minute.
    const tag = `${key}:${gate.reason}`;
    if (tag !== lastQuietReason) {
      lastQuietReason = tag;
      log("info", `tick window=${key} — ${gate.reason}, nothing to do`);
    }
    return;
  }
  lastQuietReason = null;

  log("info", `tick window=${key}`);
  let body;
  try {
    const result = await fetchDigest(ctx.cfg, now, ctx.useAt);
    if (result.kind === "auth") {
      log("error", `API auth failure (${result.status}) — the token is wrong or missing on the server`);
      process.exit(EXIT.AUTH);
    }
    if (result.kind === "fatal") {
      log("error", `unexpected API status ${result.status}`);
      process.exit(EXIT.FATAL);
    }
    if (result.kind === "transient") {
      log("warn", `transient API failure (${result.status}${result.detail ? ` — ${result.detail}` : ""})`);
      return recordFailure(key, now);
    }
    body = result.body;
  } catch (err) {
    // A thrown fetch is the failure the ladder was written for: it must reach
    // recordFailure, never an early return.
    return recordFailure(key, now, err);
  }

  if (body?.window?.key && body.window.key !== key) {
    log("error", `WINDOW KEY MISMATCH server=${body.window.key} local=${key} — the idempotency contract is broken`);
  }

  const counts = body?.counts ?? {};
  log("info", `fetch ok added=${counts.added ?? "?"} edited=${counts.edited ?? "?"} deleted=${counts.deleted ?? "?"}`);

  /**
   * Mark this window finished, then drop the ladder.
   *
   * The plan's `tick()` called `clearState()` alone for these outcomes. Doing
   * only that re-arms the gate: with no marker and no ladder the next 60 s tick
   * fetches again, all evening — the fetch storm §6.1 forbids, and the opposite
   * of the same paragraph's "re-fetching it all evening is pointless".
   *
   * A marker is safe here because a window is FROZEN once it has ended: the feed
   * is selected on `created_at`, so anything entered later belongs to the NEXT
   * window. Marking therefore suppresses nothing that could still be posted.
   */
  const finish = (reason) => {
    if (dryRun) return;
    writeLocalMarker(key, { outcome: reason });
    clearState(key);
  };

  if (body?.alreadySent) {
    log("info", `already recorded by the server — nothing to do window=${key}`);
    return finish("already-sent");
  }
  if (body?.disabled) {
    log("info", `feed is switched off in Settings — nothing to do window=${key}`);
    return finish("disabled");
  }
  if (body?.stale) {
    log("warn", `stale, not posting window=${key}`);
    return finish("stale");
  }
  if (body?.empty || !body?.text) {
    log("info", `nothing changed in this window — nothing to post window=${key}`);
    return finish("empty");
  }

  if (dryRun) {
    log("info", "dry run — printing the message and sending nothing");
    console.log("\n----- MESSAGE -----\n");
    console.log(body.text);
    console.log("\n----- END -----\n");
    return;
  }

  if (!ctx.cfg.groupJid) {
    log("error", "groupJid is empty in config.json — run `node agent.mjs --groups` and paste the JID in");
    process.exit(EXIT.CONFIG);
  }
  if (!ctx.sock || !ctx.isOpen?.()) {
    log("warn", "socket is not connected — treating the send as a transient failure");
    return recordFailure(key, now);
  }

  try {
    // Remember it BEFORE confirming: a retry request can arrive while this tick
    // is still in flight, and whether the message can be re-sent must not depend
    // on the confirmation below having finished.
    rememberMessage(await ctx.sock.sendMessage(ctx.cfg.groupJid, { text: body.text }));
  } catch (err) {
    // No marker on a failed send: that would suppress both the remaining retries
    // and the fallback push.
    return recordFailure(key, now, err);
  }

  log("info", `posted window=${key}`);
  writeLocalMarker(key, { outcome: "posted" });
  await confirm(ctx.cfg, key, "sent");
  clearState(key);
}

/* ------------------------------------------------------------- one-shot ----- */

async function runOnce(cfg, args) {
  const fixedNow = args.at ? new Date(args.at) : new Date();
  const ctx = { cfg, fixedNow, useAt: Boolean(args.at), sock: null, isOpen: () => false };

  if (args.dryRun) {
    // Nothing to send, and nothing must be mutated.
    await tick(ctx, { dryRun: true });
    return EXIT.OK;
  }

  const conn = await openSocket({ groupJid: cfg.groupJid });
  try {
    await conn.opened;
  } catch {
    return EXIT.FATAL;
  }
  ctx.sock = conn.sock;
  ctx.isOpen = () => true;
  await tick(ctx);
  try {
    conn.sock.end(undefined);
  } catch {
    // Best effort; process.exit is next.
  }
  return EXIT.OK;
}

/**
 * `--link` — pairing code only, and the ORDER matters (plan §3.7).
 *
 * Calling `requestPairingCode()` straight after `makeWASocket` is the single
 * most common way linking fails, with a `Connection Closed` error that looks
 * like a WhatsApp-side problem. The first `qr` event is the trigger.
 */
async function runLink(cfg, phone) {
  if (!DIGITS_RE.test(phone ?? "")) {
    log("error", "a valid E.164 phone number is required for --link (digits only, no \"+\")");
    return EXIT.CONFIG;
  }

  let qrSeen = false;
  let signalQr;
  const firstQr = new Promise((resolve) => {
    signalQr = resolve;
  });
  const conn = await openSocket({
    onQr: () => {
      if (qrSeen) return;
      qrSeen = true;
      signalQr();
    },
  });

  const registered = conn.sock.authState?.creds?.registered === true;
  if (registered) {
    // Guards the common case of re-running --link out of habit: requesting a new
    // pairing code for an already-registered session is not possible.
    log("info", "this session is already linked — waiting for the connection to open");
  } else {
    log("info", `requesting a pairing code for ${maskPhone(phone)}…`);
    const triggered = await Promise.race([firstQr.then(() => true), sleep(LINK_QR_TIMEOUT_MS).then(() => false)]);
    if (!triggered) {
      log("error", `no pairing handshake within ${LINK_QR_TIMEOUT_MS / 1000}s — re-run 'node agent.mjs --link'`);
      return EXIT.LINK_TIMEOUT;
    }
    let code;
    try {
      code = await conn.sock.requestPairingCode(phone);
    } catch (err) {
      log("error", `requestPairingCode failed: ${err.message} — re-run 'node agent.mjs --link'`);
      return EXIT.LINK_TIMEOUT;
    }
    log("info", "enter this code on the phone: WhatsApp → Settings → Linked devices → Link a device → \"Link with phone number instead\"");
    console.log(`\n    PAIRING CODE:  ${code}\n    FOR NUMBER:    ${maskPhone(phone)}\n`);
  }

  const opened = await Promise.race([conn.opened.then(() => true).catch(() => false), sleep(LINK_OPEN_TIMEOUT_MS).then(() => false)]);
  if (!opened) {
    log("error", "the code was never confirmed — re-run 'node agent.mjs --link'; if the code was already used, check WhatsApp → Linked devices");
    return EXIT.LINK_TIMEOUT;
  }
  log("info", "linked — the session is stored in auth/ and survives restarts");
  try {
    conn.sock.end(undefined);
  } catch {
    // Best effort.
  }
  return EXIT.OK;
}

/**
 * `--groups` — print every participating group, name first, JID last so the JID
 * is easy to copy. Exits 0; it is not a long-running mode and never sends.
 */
async function runListGroups() {
  const conn = await openSocket({});
  try {
    await conn.opened;
  } catch {
    return EXIT.FATAL;
  }
  let groups;
  try {
    groups = await conn.sock.groupFetchAllParticipating();
  } catch (err) {
    log("error", `could not read the group list: ${err.message}`);
    return EXIT.FATAL;
  }
  const rows = Object.values(groups ?? {})
    .map((g) => ({ name: String(g.subject ?? "(unnamed)"), jid: String(g.id ?? "") }))
    .filter((r) => r.jid)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n${rows.length} group(s):\n`);
  for (const row of rows) console.log(`  ${row.name.padEnd(30)} ${row.jid}`);
  if (rows.length === 0) {
    console.log("  (none yet — right after a first link WhatsApp is still syncing; wait ~30 s and re-run)\n");
  }
  console.log("\nPaste the intended JID into config.json as `groupJid`.\n");
  try {
    conn.sock.end(undefined);
  } catch {
    // Best effort.
  }
  return EXIT.OK;
}

/* ------------------------------------------------------------ the scheduler - */

/**
 * Keep a socket alive, forever: reconnect with exponential backoff on any close
 * that is not a 401 (a 401 exits `3` from inside `openSocket`).
 */
async function maintainSocket(ctx) {
  let attempt = 0;
  for (;;) {
    try {
      const conn = await openSocket({ groupJid: ctx.cfg.groupJid });
      ctx.sock = conn.sock;
      await conn.opened;
      ctx.isOpen = () => true;
      attempt = 0;
      await conn.closed;
    } catch (err) {
      if (attempt === 0) log("warn", `connection attempt failed: ${String(err.message ?? err).slice(0, 160)}`);
    }
    ctx.isOpen = () => false;
    ctx.sock = null;
    const delay = Math.min(5_000 * 2 ** attempt, 5 * 60_000);
    attempt = Math.min(attempt + 1, 6);
    log("warn", `reconnecting in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}

/**
 * The 22:00 IST scheduler: a precise timer plus a 60 s self-healing tick.
 *
 * Both triggers exist on purpose. Android may suspend timers while the device
 * dozes, so the interval notices "it is past 22:00 and there is no marker" on
 * wake; the timer exists so the normal case fires within a second of 22:00
 * rather than within a minute (plan §6.1).
 */
function runScheduler(ctx) {
  let busy = false;
  let timer = null;

  const armTimer = () => {
    const boundary = nextBoundary(new Date());
    const ms = boundary.getTime() - Date.now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void runTick();
    }, ms + 1_000);
    log("info", `next boundary ${istStamp(boundary)} IST (in ${Math.round(ms / 60_000)} min)`);
  };

  const runTick = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(ctx);
    } catch (err) {
      log("error", `tick failed: ${String(err?.stack ?? err).slice(0, 400)}`);
    } finally {
      busy = false;
      armTimer();
    }
  };

  void maintainSocket(ctx);
  armTimer();
  setInterval(() => {
    void runTick();
  }, 60_000).unref?.();
  log("info", "scheduler started — waiting for the 22:00 IST boundary");
}

/* -------------------------------------------------------------------- CLI --- */

const USAGE = `Usage: node agent.mjs [mode]

  (no mode)            run the scheduler — the production path
  --link               link this device with a pairing code, then exit
  --groups             print the group JIDs, then exit
  --now                run one evaluation at the real wall clock, then exit
  --at <ISO instant>   run one evaluation as if 'now' were that instant, then exit
  --dry-run            with --now/--at: print the message, send nothing, write nothing
  --phone <E164>       number for --link (default: config.json's phone)

Exit codes: 0 ok · 1 crash · 2 bad config/args · 3 re-link required · 4 bad token · 7 another instance · 8 --link timeout
`;

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Parse argv. Pure, so the flag conflicts are testable. */
export function parseArgs(argv) {
  const args = { mode: "scheduler", at: null, phone: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--link" || flag === "--groups" || flag === "--now") {
      if (args.mode !== "scheduler") return { error: "choose only one of --link, --groups, --now, --at" };
      args.mode = flag.slice(2);
    } else if (flag === "--at") {
      if (args.mode !== "scheduler") return { error: "choose only one of --link, --groups, --now, --at" };
      const value = argv[i + 1];
      if (!value) return { error: "--at needs an ISO instant with an offset" };
      if (!ISO_INSTANT_RE.test(value) || Number.isNaN(Date.parse(value))) {
        return { error: "--at must be an ISO instant WITH an offset, e.g. 2026-09-17T16:30:00.000Z" };
      }
      args.mode = "at";
      args.at = value;
      i += 1;
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--phone") {
      const value = argv[i + 1];
      if (!value) return { error: "--phone needs an E.164 number" };
      args.phone = value;
      i += 1;
    } else {
      return { error: `unknown argument: ${flag}` };
    }
  }
  // --dry-run only means something with an explicit instant, otherwise it would
  // silently look like the real one-shot path.
  if (args.dryRun && args.mode !== "now" && args.mode !== "at") {
    return { error: "--dry-run must be combined with --now or --at" };
  }
  return args;
}

/* ------------------------------------------------------------------- main --- */

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) {
    log("error", args.error);
    process.stderr.write(USAGE);
    return EXIT.CONFIG;
  }

  acquireLock();
  process.on("exit", releaseLock);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      log("info", `received ${signal} — shutting down`);
      releaseLock();
      process.exit(EXIT.OK);
    });
  }

  const cfg = loadConfig();
  if (process.env.AGENT_LOG_LEVEL) currentLevel = process.env.AGENT_LOG_LEVEL;

  switch (args.mode) {
    case "link":
      return await runLink(cfg, args.phone ?? cfg.phone);
    case "groups":
      return await runListGroups();
    case "now":
    case "at":
      return await runOnce(cfg, args);
    default: {
      if (!cfg.groupJid) {
        log("warn", "groupJid is empty — the agent will refuse to post until it is set (see README.md)");
      }
      const ctx = { cfg, fixedNow: null, useAt: false, sock: null, isOpen: () => false, isOpenRef: null };
      runScheduler(ctx);
      // Keep the process alive; the timer and the socket maintainer do the work.
      await new Promise(() => {});
      return EXIT.OK;
    }
  }
}

/* Importing this module for tests must not run anything. */
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main()
    .then((code) => process.exit(code ?? EXIT.OK))
    .catch((err) => {
      log("error", `unhandled: ${String(err?.stack ?? err).slice(0, 600)}`);
      process.exit(EXIT.FATAL);
    });
}

#!/usr/bin/env node
/**
 * Laptop rehearsal — `node tools/whatsapp-agent/rehearse.mjs` (or
 * `npm run rehearse:whatsapp-agent` from the repository root).
 *
 * Runs the **real agent**, unmodified, against a **local stub server**, so every
 * decision the agent makes can be watched before anyone touches Dad's phone. It
 * needs no WhatsApp account, no network and no Baileys install.
 *
 * ---------------------------------------------------------------------------
 * What this CAN prove
 * ---------------------------------------------------------------------------
 *
 *   · config validation and argument parsing produce the documented exit codes
 *   · the API status handling: 401/503 are fatal (`4`), 500 is transient and
 *     feeds the retry ladder instead of exiting
 *   · the ladder persists across a process boundary, which is what makes
 *     `start.sh`'s restart safe
 *   · the gate's outcomes — empty, disabled, stale, already-recorded — are
 *     distinguished, and each writes no marker under `--dry-run`
 *   · `--dry-run` really is inert: no marker file, no confirmation POST
 *   · a window-key mismatch is logged loudly rather than posted silently
 *   · the single-instance lock refuses a second process with exit `7`
 *   · the token never reaches a log line
 *
 * ---------------------------------------------------------------------------
 * What it CANNOT prove, and no local test can
 * ---------------------------------------------------------------------------
 *
 * Linking, delivery, the socket 401 path and the boot hook all need a real
 * WhatsApp session. Those are the plan's §7 acceptance tests on the device.
 *
 * This harness also does not validate the *server's* behaviour: the stub answers
 * with fixed bodies. The window CONTRACT is checked in two other places that
 * matter more — `agent-test.ts` compares the agent's key math against the
 * server's real implementation, and `verify:digest-feed` checks the deployed
 * route. The stub here recomputes the boundary on its own (fixed +05:30), so a
 * gross error in the agent's math would still surface as a logged
 * `WINDOW KEY MISMATCH`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SOURCE = path.join(HERE, "agent.mjs");

/** The token the sandbox config carries. Deliberately recognisable, so the
 *  "never logged" check has something unambiguous to look for. */
const TOKEN = "rehearsal-token-do-not-log-me-0123456789abcdef";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------- independent boundary arithmetic -- */

/**
 * The most recent 22:00 IST instant at or before `instant`.
 *
 * Written out independently of the agent (which is the point — a copy of the
 * agent's own function would agree with it no matter what it did). The verifier
 * script uses the same approach.
 */
function lastBoundary(instant) {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const boundaryIst = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    22,
    0,
    0,
    0,
  );
  const boundary = boundaryIst - IST_OFFSET_MS;
  return new Date(boundary <= instant.getTime() ? boundary : boundary - DAY_MS);
}

/** `${startDateIst}..${endDateIst}` for the 24 h window ending at `end`. */
function keyFor(end) {
  const istDate = (date) => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  return `${istDate(new Date(end.getTime() - DAY_MS))}..${istDate(end)}`;
}

/* ---------------------------------------------------------------- the stub --- */

const MESSAGE = [
  "*Ledger changes* — 22:00 to 22:00",
  "",
  "*Added (2)* · Entered in this window ₹450.00",
  "🍔 Dining Out · ₹450.00 · 20:14 · note: dinner",
  "⛽ Fuel · ₹2,000.00 · 18:02",
  "",
  "_Nothing else changed in this window._",
].join("\n");

/**
 * Serve `/api/digest/day`. The response is driven entirely by `mode`, and the
 * stub records what it was asked for so a scenario can assert on it.
 */
function startStub() {
  const counters = { gets: 0, posts: 0, lastAt: null, confirmations: [] };
  const state = { mode: "ok", delayMs: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname !== "/api/digest/day") {
      return send(404, { ok: false, error: "not found" });
    }

    const respond = () => {
      if (req.method === "POST") {
        counters.posts += 1;
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          try {
            counters.confirmations.push(JSON.parse(raw));
          } catch {
            counters.confirmations.push({ unparseable: raw });
          }
          // A failed post records nothing, exactly as the real route does.
          send(200, { ok: true, recorded: false, sentAt: null });
        });
        return;
      }

      counters.gets += 1;
      counters.lastAt = url.searchParams.get("at");

      if (state.mode === "401") return send(401, { ok: false, error: "Unauthorized" });
      if (state.mode === "503") {
        return send(503, { ok: false, error: "DIGEST_AGENT_TOKEN is not configured on the server" });
      }
      if (state.mode === "500") return send(500, { ok: false, error: "boom" });

      const at = counters.lastAt ? new Date(counters.lastAt) : new Date();
      const end = lastBoundary(at);
      const key = keyFor(end);

      const base = {
        ok: true,
        window: {
          startIso: new Date(end.getTime() - DAY_MS).toISOString(),
          endIso: end.toISOString(),
          startDateIst: key.slice(0, 10),
          endDateIst: key.slice(11),
          key,
          label: "22:00 to 22:00",
          stale: false,
        },
        counts: { added: 2, edited: 0, deleted: 0, merges: 0 },
        empty: false,
        disabled: false,
        alreadySent: false,
        sentAt: null,
        stale: false,
        text: MESSAGE,
      };

      if (state.mode === "empty") {
        return send(200, { ...base, counts: { added: 0, edited: 0, deleted: 0, merges: 0 }, empty: true, text: null });
      }
      if (state.mode === "disabled") return send(200, { ...base, disabled: true });
      if (state.mode === "stale") return send(200, { ...base, stale: true, window: { ...base.window, stale: true } });
      if (state.mode === "alreadySent") {
        return send(200, { ...base, alreadySent: true, sentAt: new Date().toISOString() });
      }
      // A key for a completely different window: the agent must complain rather
      // than post it as if it were the right one.
      if (state.mode === "mismatch") {
        return send(200, { ...base, window: { ...base.window, key: "2000-01-01..2000-01-02" } });
      }
      return send(200, base);
    };

    if (state.delayMs > 0) setTimeout(respond, state.delayMs);
    else respond();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, counters, state, base: `http://127.0.0.1:${port}` });
    });
  });
}

/* ----------------------------------------------------------------- sandbox --- */

/**
 * A throwaway copy of the agent's directory.
 *
 * `agent.mjs` imports only Node built-ins, so a lone copy runs standalone — which
 * is exactly why it can be copied to the phone without the rest of the repo. Each
 * scenario gets a FRESH sandbox, so `sent/`, `agent.log` and the lock cannot leak
 * between them.
 */
function makeSandbox(apiUrl, { config = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-rehearse-"));
  fs.copyFileSync(AGENT_SOURCE, path.join(dir, "agent.mjs"));
  if (config) {
    const configPath = path.join(dir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          apiUrl,
          token: TOKEN,
          phone: "919876543210",
          groupJid: "120363012345678901@g.us",
          sendAt: "22:00",
          timezone: "Asia/Kolkata",
        },
        null,
        2,
      ),
    );
  }
  return dir;
}

/** Run the agent once and resolve with its exit code, output and log. */
function runAgent(dir, args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, "agent.mjs"), ...args], {
      cwd: dir,
      env: { ...process.env, AGENT_LOG_LEVEL: "debug" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agent did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const logPath = path.join(dir, "agent.log");
      resolve({
        code,
        stdout,
        stderr,
        all: `${stdout}\n${stderr}`,
        log: fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "",
        dir,
      });
    });
  });
}

const markerFile = (dir, key) => path.join(dir, "sent", `${key}.json`);
const lockFile = (dir) => path.join(dir, "sent", "agent.lock");
const retryFile = (dir) => path.join(dir, "sent", "retry-state.json");

/* ------------------------------------------------------------------- checks -- */

let failures = 0;
let checks = 0;
function check(cond, msg) {
  checks += 1;
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

async function scenario(title, fn) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`  ✗ threw: ${String(err?.message ?? err)}`);
  }
}

/** An ISO instant (with an offset, as `--at` requires) and its window key. */
function pastInstant() {
  const at = lastBoundary(new Date(Date.now() - DAY_MS));
  return { iso: at.toISOString(), key: keyFor(at) };
}

/* --------------------------------------------------------------------- run --- */

const stub = await startStub();
console.log(`Rehearsing the WhatsApp agent against a local stub at ${stub.base}\n(no WhatsApp, no network, no Baileys)`);

try {
  const { iso, key } = pastInstant();

  await scenario("Config and arguments (no network at all)", async () => {
    const noConfig = makeSandbox(stub.base, { config: false });
    const missing = await runAgent(noConfig, ["--at", iso, "--dry-run"]);
    check(missing.code === 2, `a missing config.json exits 2 (got ${missing.code})`);
    check(/config/i.test(missing.all), "and says so, rather than dumping a stack trace");
    check(stub.counters.gets === 0, "nothing was fetched");

    const badPhone = makeSandbox(stub.base);
    const cfgPath = path.join(badPhone, "config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, phone: "+91 98765 43210" }, null, 2));
    const rejected = await runAgent(badPhone, ["--at", iso, "--dry-run"]);
    check(rejected.code === 2, `a phone with "+" and spaces exits 2 (got ${rejected.code})`);
    check(/digits only/.test(rejected.all), "the message names the rule, not just the field");

    const badArgs = makeSandbox(stub.base);
    const argless = await runAgent(badArgs, ["--at", "2026-09-17T22:00:00"]);
    check(argless.code === 2, `--at without an offset exits 2 (got ${argless.code})`);
    check(/WITH an offset/.test(argless.all), "and explains what an acceptable instant looks like");
  });

  await scenario("Fatal API states (exit 4, never a retry loop)", async () => {
    stub.state.mode = "401";
    const d401 = makeSandbox(stub.base);
    const r401 = await runAgent(d401, ["--at", iso, "--dry-run"]);
    check(r401.code === 4, `a 401 exits 4 (got ${r401.code})`);
    check(/API auth failure \(401\)/.test(r401.log), "the log names the status");
    check(!fs.existsSync(retryFile(d401)), "a wrong token is NOT fed to the retry ladder — it cannot fix itself");

    stub.state.mode = "503";
    const d503 = makeSandbox(stub.base);
    const r503 = await runAgent(d503, ["--at", iso, "--dry-run"]);
    check(r503.code === 4, `a 503 exits 4 (got ${r503.code})`);
    check(r503.log.includes("503"), "and is reported as its own diagnosis, not as a bad token");

    stub.state.mode = "ok";
  });

  await scenario("Transient failure feeds the persisted ladder", async () => {
    stub.state.mode = "500";
    const dir = makeSandbox(stub.base);
    const before = stub.counters.gets;
    const first = await runAgent(dir, ["--at", iso, "--dry-run"]);
    check(first.code === 0, `a 500 does not exit — it is retried (got ${first.code})`);
    const state = JSON.parse(fs.readFileSync(retryFile(dir), "utf8"));
    check(state.attempts === 1, `the ladder recorded attempt 1 (got ${state.attempts})`);
    check(Boolean(state.nextAttemptAt), "with a next attempt time");
    check(state.key === key, `keyed to the window it belongs to (${state.key})`);

    // The whole point of persistence: a restart must NOT re-arm the ladder.
    const second = await runAgent(dir, ["--at", iso, "--dry-run"]);
    check(second.code === 0, "a second process exits cleanly");
    check(
      JSON.parse(fs.readFileSync(retryFile(dir), "utf8")).attempts === 1,
      "and does NOT re-arm the ladder — it waits for nextAttemptAt",
    );
    check(/waiting/.test(second.log), "the log says it is waiting rather than fetching");
    check(
      stub.counters.gets === before + 1,
      `exactly one fetch across both runs (${stub.counters.gets - before}) — no fetch storm`,
    );
    stub.state.mode = "ok";
  });

  await scenario("Gate outcomes are distinguished, and --dry-run writes nothing", async () => {
    const cases = [
      { mode: "empty", expect: /nothing changed in this window/ },
      { mode: "disabled", expect: /switched off in Settings/ },
      { mode: "stale", expect: /stale, not posting/ },
      { mode: "alreadySent", expect: /already recorded by the server/ },
    ];
    for (const { mode, expect } of cases) {
      stub.state.mode = mode;
      const dir = makeSandbox(stub.base);
      const result = await runAgent(dir, ["--at", iso, "--dry-run"]);
      check(result.code === 0, `${mode}: exits 0 (got ${result.code})`);
      check(expect.test(result.log), `${mode}: ${expect.source}`);
      check(!fs.existsSync(markerFile(dir, key)), `${mode}: no marker written under --dry-run`);
      check(!result.stdout.includes("----- MESSAGE -----"), `${mode}: prints no message`);
    }
    stub.state.mode = "ok";
  });

  await scenario("A dry run renders but sends nothing", async () => {
    const dir = makeSandbox(stub.base);
    const result = await runAgent(dir, ["--at", iso, "--dry-run"]);
    check(result.code === 0, `exits 0 (got ${result.code})`);
    check(result.stdout.includes("----- MESSAGE -----"), "prints the rendered message");
    check(result.stdout.includes("Ledger changes"), "which is the server's text, delivered verbatim");
    check(/dry run — printing the message and sending nothing/.test(result.log), "the log says it was a dry run");
    check(!fs.existsSync(markerFile(dir, key)), "no marker — otherwise it would suppress tonight's real post");
    check(stub.counters.posts === 0, "no confirmation POST was sent");
    check(!fs.existsSync(lockFile(dir)), "the lock was released on exit");
    check(!result.log.includes(TOKEN) && !result.all.includes(TOKEN), "the token never appears in a log line");
  });

  await scenario("A window-key mismatch is loud, not silent", async () => {
    stub.state.mode = "mismatch";
    const dir = makeSandbox(stub.base);
    const result = await runAgent(dir, ["--at", iso, "--dry-run"]);
    check(/WINDOW KEY MISMATCH/.test(result.log), "the mismatch is logged");
    check(result.log.includes("server=2000-01-01..2000-01-02"), "and names both keys, so it is diagnosable");
    stub.state.mode = "ok";
  });

  await scenario("One instance at a time", async () => {
    // Hold the lock open with a slow response in the first process, then try a
    // second. Without the lock both would evaluate the same window and could both
    // post — and two processes sharing one auth/ directory corrupt the session.
    stub.state.mode = "ok";
    stub.state.delayMs = 2500;
    const dir = makeSandbox(stub.base);
    const first = runAgent(dir, ["--at", iso, "--dry-run"], { timeoutMs: 20_000 });

    const deadline = Date.now() + 5000;
    while (!fs.existsSync(lockFile(dir)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    check(fs.existsSync(lockFile(dir)), "the first process took the lock");

    const second = await runAgent(dir, ["--at", iso, "--dry-run"]);
    check(second.code === 7, `a second process exits 7 (got ${second.code})`);
    check(/another instance is running/.test(second.log), "and says why");

    const firstResult = await first;
    check(firstResult.code === 0, `the first process still finishes cleanly (got ${firstResult.code})`);
    check(!fs.existsSync(lockFile(dir)), "and releases the lock, so the agent can be restarted");
    stub.state.delayMs = 0;
  });
} finally {
  stub.server.close();
}

/* ------------------------------------------------------------------ summary --- */

console.log(
  failures === 0
    ? `\nAll ${checks} rehearsal checks passed.\n` +
        "The agent's plumbing is sound. Linking and delivery still need the phone:\n" +
        "docs/plans/whatsapp-agent-termux.md §7.\n"
    : `\n${failures} of ${checks} rehearsal checks failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

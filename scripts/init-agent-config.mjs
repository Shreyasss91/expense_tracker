/**
 * Generate `tools/whatsapp-agent/config.json` from `.env.local` —
 * `npm run init:whatsapp-agent-config`.
 *
 * **Why this exists.** `config.json` lives on the PHONE, in Termux's home
 * directory, which nothing on this laptop can write to: `adb` runs as the
 * `shell` user and cannot reach `/data/data/com.termux` without root. So the file
 * must be generated here and pushed (see docs/PHONE_SETUP_CHECKLIST.md). Before
 * this script that meant hand-typing a 64-character token and a phone number on
 * a phone keyboard — which is where the two failures this project fears most
 * come from:
 *
 *   - a silently mangled phone number — `--link` then requests a pairing code
 *     for a DIFFERENT phone, which can succeed and link the wrong account;
 *   - a token pasted with a stray character — which reads as "production
 *     rejects us" and sends the investigation to Vercel instead of the config.
 *
 * Generating from `.env.local` removes the keyboard from both.
 *
 * **It generates the file; it does not decide the group.** `groupJid` is
 * discovered on the phone with `node agent.mjs --groups`, and an existing value
 * is PRESERVED here rather than regenerated — no formula derives a JID from a
 * group name, and an invented one can only fail at 22:00.
 *
 * Env (`.env.local`, loaded by `loadLiveEnv`, which refuses to let the shell
 * silently shadow it — a stale exported `PROD_URL` would otherwise generate a
 * config aimed at the wrong deployment):
 *   PROD_URL              the deployment the agent posts to (default below)
 *   DIGEST_AGENT_TOKEN    the same value set on Vercel — required
 *   DIGEST_AGENT_PHONE    the SENDING phone's number, E.164 digits — required
 *
 * The token is never printed. The phone number appears only in the same masked
 * form the agent prints at `--link`, so the two can be compared by eye.
 *
 * Flags: `--force` overwrites an existing config.json that would otherwise change.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildAgentConfig, maskPhone } from "../tools/whatsapp-agent/agent.mjs";
import { loadLiveEnv } from "./lib/live.mjs";

loadLiveEnv();

const CONFIG_PATH = path.join("tools", "whatsapp-agent", "config.json");
/** Same path, always with forward slashes — the messages are read on Windows and the
 * push command is pasted into a shell that does not take backslashes. */
const SHOWN = CONFIG_PATH.replace(/\\/g, "/");

/** Mirrors `verify:digest-feed`'s default, so the two scripts cannot disagree. */
const DEFAULT_PROD_URL = "https://tokenscript.vercel.app";

/** The six fields, in the order `config.example.json` lists them. */
const FIELDS = ["apiUrl", "token", "phone", "groupJid", "sendAt", "timezone"];

const force = process.argv.includes("--force");

function fail(...lines) {
  console.error(`✗ ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(line);
  process.exit(1);
}

/* --------------------------------------------------------------- the inputs - */

const fromEnvUrl = (process.env.PROD_URL ?? "").trim();
const prodUrl = fromEnvUrl || DEFAULT_PROD_URL;

// `PHONE_NUMBER` is accepted because it is what a first attempt tends to reach
// for, but it is a dangerously generic name for a global env file — anything
// else in the stack is free to claim it. Prefer the scoped name.
const phoneVar = process.env.DIGEST_AGENT_PHONE
  ? "DIGEST_AGENT_PHONE"
  : process.env.PHONE_NUMBER
    ? "PHONE_NUMBER"
    : null;
const phone = phoneVar ? process.env[phoneVar] : "";
const token = process.env.DIGEST_AGENT_TOKEN ?? "";

if (phoneVar === "PHONE_NUMBER") {
  console.log(
    "⚠ using PHONE_NUMBER — rename it to DIGEST_AGENT_PHONE in .env.local (and delete the " +
      "old name from Vercel: the server reads neither).",
  );
}

/* ---------------------------------------------------- preserve an existing one */

let previous = null;
if (existsSync(CONFIG_PATH)) {
  try {
    previous = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    fail(
      `${SHOWN} exists but is not valid JSON.`,
      "  Fix or delete it, then re-run — refusing to overwrite a file a human may have hand-edited.",
    );
  }
}

/* ------------------------------------------------------------------- build --- */

// `previous` is passed whole: which of its fields may survive a regenerate — the
// JID, and only the JID — is a rule of the config format, so it lives in the
// builder where it can be tested, not here where it cannot.
const built = buildAgentConfig({ prodUrl, token, phone, previous });

if (!built.ok) {
  // Name the variable each rejection came from: the errors describe the config,
  // but the human needs to know which line of which file to edit.
  const origin = (error) => {
    if (error.includes("token")) return "→ set DIGEST_AGENT_TOKEN in .env.local (openssl rand -hex 32)";
    if (error.includes("phone")) {
      return `→ set DIGEST_AGENT_PHONE in .env.local${phoneVar ? ` (currently read from ${phoneVar})` : " — it is not set"}`;
    }
    if (error.includes("apiUrl")) return "→ set PROD_URL in .env.local to the deployment URL";
    if (error.includes("groupJid")) return "→ the groupJid already in config.json is malformed; clear it and re-run";
    return "→ this should be unreachable: sendAt and timezone are constants in buildAgentConfig, never parameters";
  };

  fail(
    `cannot build ${SHOWN}:`,
    ...built.errors.map((error) => `  · ${error}\n    ${origin(error)}`),
    "",
    "  Nothing was written.",
  );
}

const next = built.config;

/* ------------------------------------------------- would this change anything? */

const changed = previous
  ? FIELDS.filter((field) => (previous[field] ?? "") !== next[field])
  : FIELDS;

if (previous && changed.length === 0) {
  console.log(`✓ ${SHOWN} already matches .env.local — nothing to do.`);
  process.exit(0);
}

if (previous && !force) {
  fail(
    `${SHOWN} exists and these fields would change: ${changed.join(", ")}`,
    "  Re-run with --force to overwrite. (The token is a credential; a silent",
    "  rewrite of a working config is how a phone setup breaks with no diff to read.)",
  );
}

/* ------------------------------------------------------------------- write --- */

writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
try {
  // `mode` above applies only on CREATE. An existing file keeps its old
  // permissions, so tighten explicitly. Best effort: irrelevant on Windows,
  // load-bearing on the phone.
  chmodSync(CONFIG_PATH, 0o600);
} catch {
  /* best effort */
}

/* ------------------------------------------------------------------ report --- */

const urlNote = fromEnvUrl ? "from PROD_URL" : `DEFAULT — set PROD_URL in .env.local if this is not your deployment`;

console.log(`✓ wrote ${SHOWN} (0600)`);
console.log("");
console.log(`  apiUrl    ${next.apiUrl}   (${urlNote})`);
console.log(`  token     set, ${next.token.length} chars   (DIGEST_AGENT_TOKEN — never printed)`);
console.log(`  phone     ${maskPhone(next.phone)}   (${phoneVar ?? "unset"})`);
console.log(`  groupJid  ${next.groupJid || "(empty — discovered on the phone with `node agent.mjs --groups`)"}`);
console.log("");
console.log("  Compare that masked number with the one `node agent.mjs --link` prints");
console.log(`  ("Connected as ${maskPhone(next.phone)}"). If they differ, the pairing code`);
console.log("  went to the wrong phone. Nothing else can catch that.");

if (!next.groupJid) {
  console.log("");
  console.log("  groupJid is still empty HERE: the agent will refuse to post until one is set. Run");
  console.log("  `node agent.mjs --link`, then `--groups` on the phone, then keep that JID in THIS");
  console.log("  file and push again. This is the copy `--force` reads, so a JID that exists only");
  console.log("  on the phone is one changed field away from being blanked by the next push.");
}

console.log("");
console.log("Next — push it to the phone, then remove the copy from shared storage");
console.log("(anything in /sdcard is readable by other apps, and this file holds a token):");
console.log("");
console.log(`  adb push ${SHOWN} /sdcard/Download/config.json`);
console.log("  # in Termux:");
console.log(`  #   cp /sdcard/Download/config.json ~/expense_tracker/tools/whatsapp-agent/`);
console.log("  #   chmod 600 config.json");
console.log("  adb shell rm /sdcard/Download/config.json");

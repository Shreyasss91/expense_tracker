/**
 * `POST /api/digest/day` — the `windowKey` validation, against the real
 * `app_settings` table — `npm run test:digest-day-post`.
 *
 * The endpoint the phone agent calls to record a confirmed send. Its rules are
 * tested as pure functions (`parseFeedKey`, `feedKeyHasEnded`), and the live
 * verifier probes them over HTTP — but **neither can see the thing the rules
 * exist to protect**: that a rejected key leaves the `app_settings` marker
 * table untouched, and an accepted one writes exactly one row that
 * `getFeedSentAt` reads back. That marker is the gate the agent AND the 22:15
 * fallback both consult, so a marker written under a bad key suppresses a
 * night's post; this suite is where that is pinned against the real table.
 *
 * It drives the **real route handler**, so the validation order is exercised as
 * shipped: shape → real dates → adjacency → has-the-window-ended → status.
 *
 * Two things shape the design:
 *
 *   1. **The fixture key is a window far in the past, never tonight's.** Writing
 *      a marker for the current window would tell the agent tonight's feed was
 *      already sent and silence it — a test that breaks the feature it tests.
 *      The key is asserted to differ from the current window's, and the whole
 *      `digest_sent:whatsapp_feed:` row count is compared before and after.
 *   2. **`revalidatePath` needs Next's request store.** Called from a bare Node
 *      process it throws, so the *accepted* path writes its row and then fails
 *      at the cache refresh — the route's own catch turns that into a 500. The
 *      write happens first and is what matters, so the accepted case asserts the
 *      ROW and not the status; the `failed` case, which never reaches
 *      revalidation, asserts both.
 *
 * `--conditions=react-server` because the route imports `@/lib/ledger-feed` and
 * `@/db`, both `server-only`; `./load-env` must stay the FIRST import so
 * `DATABASE_URL` is set before the neon client is constructed.
 *
 * Needs a seeded database and `.env.local`. Restores the exact `app_settings`
 * state it found in `finally`, and the marker row count is asserted afterwards.
 */
import "./load-env";
import { assertNotProductionDb } from "./test-db-guard";

assertNotProductionDb("digest-day-post-test");

import { eq, like } from "drizzle-orm";
import { POST } from "@/app/api/digest/day/route";
import { setAppSetting } from "@/db/app-settings-mutations";
import { db } from "@/db";
import {
  feedKeyHasEnded,
  FEED_SENT_KEY_PREFIX,
  feedSentKey,
  feedWindowForInstant,
  getFeedSentAt,
  parseFeedKey,
} from "@/lib/ledger-feed";
import { appSettings } from "./schema";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}
const DAY_MS = 24 * 60 * 60 * 1000;

/** A dummy credential — the route compares against whatever the process holds. */
const TOKEN = "zz-test-digest-agent-token-0123456789";

/**
 * A fresh client address per run. The route throttles *presented-but-wrong*
 * credentials at 20 per 5 minutes per client, so a fixed address would make
 * repeated local runs inherit the previous run's failures and start answering
 * `429` where the test expects `401`.
 */
const CLIENT_IP = `192.0.2.${1 + Math.floor(Math.random() * 253)}`;

async function callPost(body: string, authorization?: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": CLIENT_IP,
  };
  if (authorization) headers.authorization = authorization;
  const response = await POST(
    new Request("https://example.test/api/digest/day", { method: "POST", headers, body }),
  );
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body is one of the cases under test.
  }
  return { status: response.status, json };
}

const postJson = (body: unknown, authorization: string | null = `Bearer ${TOKEN}`) =>
  callPost(JSON.stringify(body), authorization);

/** The marker row for a key, or `null`. Read directly: `getAppSetting` uses LIMIT 1. */
async function markerRow(key: string) {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, feedSentKey(key)));
  return rows[0] ?? null;
}

async function feedMarkerRows() {
  return db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(like(appSettings.key, `${FEED_SENT_KEY_PREFIX}%`));
}

async function main() {
  const originalToken = process.env.DIGEST_AGENT_TOKEN;
  process.env.DIGEST_AGENT_TOKEN = TOKEN;

  const now = new Date();
  const currentWindow = feedWindowForInstant(now);
  /** Forty days back: a window that has certainly ended, and certainly is not tonight's. */
  const acceptedKey = feedWindowForInstant(new Date(now.getTime() - 40 * DAY_MS)).key;
  const failedKey = feedWindowForInstant(new Date(now.getTime() - 41 * DAY_MS)).key;
  /** The *next* window: a well-formed, adjacent key whose window has not ended. */
  const unendedKey = feedWindowForInstant(new Date(now.getTime() + DAY_MS)).key;

  const before = await feedMarkerRows();
  const priorRow = before.find((row) => row.key === feedSentKey(acceptedKey));

  try {
    check(
      acceptedKey !== currentWindow.key && failedKey !== currentWindow.key,
      `the fixture windows are not tonight's (${acceptedKey} vs ${currentWindow.key})`,
    );

    // ------------------------------------------------ the future-window fixture
    // Assert the fixture is rejected for the RIGHT reason. A probe that fails
    // because it was malformed proves nothing about the ended-window rule — the
    // lesson the live verifier learned when its hard-coded key became a future
    // window on the day it ran.
    const parsedUnended = parseFeedKey(unendedKey);
    check(
      parsedUnended !== null && !feedKeyHasEnded(parsedUnended, now),
      `${unendedKey} is a well-formed window that simply has not ended yet`,
    );

    // ------------------------------------------------------------- rejections
    const rejections: Array<[string, string]> = [
      ["not `<date>..<date>`", "not-a-key"],
      ["an impossible date", "9999-99-99..9999-99-99"],
      ["a day that never existed (30 Feb)", "2026-02-30..2026-03-01"],
      ["two dates that run backwards", "2026-03-02..2026-03-01"],
      ["a range spanning months, not 24 h", "2026-01-01..2026-12-31"],
      ["a window that has not ended", unendedKey],
    ];
    for (const [label, key] of rejections) {
      const result = await postJson({ windowKey: key, status: "sent" });
      const row = await markerRow(key);
      check(
        result.status === 400 && row === null,
        `${label} → 400 and NO marker (${key})`,
      );
    }

    // -------------------------------------------------------- the other fields
    const noStatus = await postJson({ windowKey: acceptedKey });
    check(noStatus.status === 400 && (await markerRow(acceptedKey)) === null, "a missing status → 400, no marker");
    const badStatus = await postJson({ windowKey: acceptedKey, status: "ok" });
    check(badStatus.status === 400 && (await markerRow(acceptedKey)) === null, "an unknown status → 400, no marker");
    const badJson = await callPost("{not json", `Bearer ${TOKEN}`);
    check(badJson.status === 400, "a body that is not JSON → 400");

    // -------------------------------------------------------------- acceptance
    // `revalidatePath` cannot run in a bare Node process (no request store), which
    // is precisely the condition the route must survive: the record is the
    // contract, so the caller must still be told it succeeded — and the cache
    // failure must reach the log rather than being swallowed by the hardening.
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    let accepted: { status: number; json: Record<string, unknown> };
    try {
      accepted = await postJson({ windowKey: acceptedKey, status: "sent" });
    } finally {
      console.warn = originalWarn;
    }

    check(
      accepted.status === 200 && accepted.json.recorded === true,
      `a recorded send is reported as recorded even though the cache refresh cannot run (got ${accepted.status})`,
    );
    const written = await markerRow(acceptedKey);
    check(written !== null, "a key that is real, adjacent and ended writes its marker row");
    check(
      typeof written?.value === "string" && !Number.isNaN(Date.parse(written.value)),
      "and the value is the ISO instant the agent and the fallback both read",
    );
    check(
      (await getFeedSentAt(acceptedKey)) === written?.value,
      "getFeedSentAt reads it back — this is the gate that suppresses a second post",
    );
    check(
      warnings.some((line) => line.includes("revalidation failed")),
      "the cache failure is logged, not swallowed — hardening must not hide it",
    );

    await postJson({ windowKey: acceptedKey, status: "sent" });
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, feedSentKey(acceptedKey)));
    check(rows.length === 1, "a repeated confirmation upserts — still exactly one row");

    // ------------------------------------------------------------ failed sends
    const failed = await postJson({ windowKey: failedKey, status: "failed", detail: "io error\nINFO forged line" });
    check(
      failed.status === 200 && failed.json.recorded === false,
      "status=failed answers 200 with recorded:false",
    );
    check(
      (await markerRow(failedKey)) === null,
      "and writes NOTHING — which is what keeps the 22:15 fallback armed",
    );

    // ------------------------------------------------------------------- auth
    const wrongToken = await postJson({ windowKey: acceptedKey, status: "sent" }, "Bearer not-the-token");
    check(wrongToken.status === 401, "a presented-but-wrong token → 401");
    const noToken = await postJson({ windowKey: acceptedKey, status: "sent" }, null);
    check(noToken.status === 401, "no credential at all → 401");

    delete process.env.DIGEST_AGENT_TOKEN;
    const unconfigured = await postJson({ windowKey: acceptedKey, status: "sent" });
    check(
      unconfigured.status === 503,
      "an unconfigured deployment → 503, a different diagnosis from 401 by design",
    );
  } finally {
    if (priorRow) await setAppSetting(db, priorRow.key, priorRow.value);
    else await db.delete(appSettings).where(eq(appSettings.key, feedSentKey(acceptedKey)));
    if (originalToken === undefined) delete process.env.DIGEST_AGENT_TOKEN;
    else process.env.DIGEST_AGENT_TOKEN = originalToken;
  }

  // The safety property, asserted rather than assumed: this suite must leave the
  // marker table exactly as it found it. A stray row here is a suppressed post.
  const after = await feedMarkerRows();
  check(
    after.length === before.length,
    `the feed-marker rows are exactly as before (${before.length} → ${after.length})`,
  );
  check(
    after.every((row) => before.some((r) => r.key === row.key && r.value === row.value)),
    "and every pre-existing marker still holds its original value",
  );

  if (failures > 0) {
    console.error(`✗ digest/day POST test FAILED (${failures} check(s) failed)`);
    process.exit(1);
  }
  console.log("✓ digest/day POST OK — a rejected windowKey writes nothing, an accepted one writes one marker.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

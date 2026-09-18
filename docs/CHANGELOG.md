# Changelog — Family Ledger Specification

All amendments to `SPEC.md` are recorded here. The spec is frozen; entries below exist
only because the user explicitly authorized each change.

Superseded entries are **annotated, never rewritten** — the audit trail is the point.

---

## Daily ledger-change feed to a private WhatsApp group — 18 September 2026 (owner request)

**Status — app side IMPLEMENTED and verified 18 September 2026; phone side pending.** The
service half of the contract below is built (see the implementation block at the end of this
entry). The Termux + Baileys agent on Dad's phone is **not** — see
`docs/PLAN_WHATSAPP_AGENT_TERMUX.md`. The complete hand-off specification is
**`docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md`**; this entry is its summary.

Owner request: every night at **10 PM IST**, post one message into a **new private WhatsApp
group containing only Dad, Mom and Son**, listing (1) every transaction **added** in the
preceding 24 hours, (2) every **edit** made in that window rendered as *before → after*, and
(3) every **deletion** made in that window. Nothing is posted on a day with no changes.

- **Window (normative):** the rolling 24 h `[yesterday 22:00, today 22:00)` IST, snapped to
  the canonical boundary so a late run resolves the **same** window as an on-time one.
  Membership is decided by **`transactions.created_at`** — the audit instant — **not** by the
  transaction's business `date`/`time`. Consequence: a backdated expense appears in the window
  in which it was *entered*, and the closing total is labelled **"Entered in this window"**.
  It is never a "today's spend" figure.
- **New audit action `update_transaction` — edits were not journaled at all.** `transactions`
  has no `updated_at` column, and `activity_log` received only `delete_transaction`,
  `delete_transactions`, `restore_transactions`, `merge_categories` and
  `skip_template_month`. `updateTransaction`, `setTransactionAssignment`,
  `setTransactionsAssignment` and `assignCategory` (all `src/actions/transactions.ts`) each
  gain a pre-image read plus a best-effort `logActivity` call carrying
  `{ before, after, changed, via }`. A no-op edit logs nothing. Ids are stored, never names —
  category and member names are mutable display labels (§3.2.2, §5.3) and are resolved at
  render time.
- **`restore_transactions` payload gains `ids`** (`src/actions/activity.ts`) so a delete
  followed by an Undo inside one window **nets out** — neither event is reported. Entries
  written before this change are handled through a fallback to the originating delete entry.
- **`merge_categories` renders as one summary line** ("Merged X into Y · n entries moved"),
  not as n per-row edits, even though a merge does re-point history.
- **New endpoints `GET` / `POST /api/digest/day`.** `src/middleware.ts` excludes every `api`
  route from its matcher, so the route authenticates itself with a bearer
  `DIGEST_AGENT_TOKEN` compared via `timingSafeStringEqual` (§1.8): a missing env var is
  `503`, a wrong token is `401`. **GET returns the finished message string**, so the format
  lives on the server and the poster holds no formatting logic; POST records the confirmed
  send.
- **New env var `DIGEST_AGENT_TOKEN`.**
- **Secret path hardened ahead of implementation (done 18 Sept 2026).** `.env.example` now
  carries a `DIGEST_AGENT_TOKEN` placeholder with a per-feature comment — §9.1 requires every
  optional variable to be recorded there and to fail loudly when absent — and that file's
  stale note claiming *"WhatsApp digest needs NO env vars"* was corrected: it is true of the
  weekly/monthly Click-to-Chat digest, but not of this daily feed, which is the one WhatsApp
  surface that does need a secret. `.gitignore` now excludes
  `tools/whatsapp-agent/config.json`, `tools/whatsapp-agent/auth/` and
  `tools/whatsapp-agent/sent/`, so the bearer token and a live WhatsApp linked-device session
  cannot be committed by accident.
- **New cron job** `/api/cron/digest-fallback` at `45 16 * * *` (22:15 IST) — a web-push
  safety net that fires only when no send is recorded for the window. It is a **separate job
  rather than a second run of `/api/cron/digest`**, because Vercel's Hobby plan permits at
  most one run per job per day (while allowing up to 100 jobs per project).
- **New `app_settings` keys:** `digest_sent:whatsapp_feed:<windowKey>` (confirmed send +
  last-sent history), `digest_fallback_pinged:<windowKey>` (at-most-once nag) and
  `whatsapp_feed_enabled` (master switch; a missing row means on).
- **The Settings/dashboard digest card gains a third channel** — `whatsapp_feed`, rendered
  "WhatsApp feed" — so `getRecentDigestSends()` (§6.8) must test that prefix **before**
  `whatsapp:`, and the two channel ternaries in `src/components/digest/digest-card.tsx`
  become a channel→label map.
- **Settings → History is deliberately left unchanged.** `listActivity()` **filters
  `update_transaction` out**, so §6.5's surface — *"every delete and merge with who/when"* —
  stays literally true instead of silently widening to every action. `restoreActivityEntry`
  already refuses any action other than the two delete actions, so Restore is unaffected.
- **No new table and no new column.** `activity_log.payload` is already `jsonb`; the only
  schema-adjacent change is a new *value* for an existing `text` column.
- **No §11 conflict.** The digest bullet in the exclusion list was already struck out, and
  nothing in the remaining list applies — **§11 needs no amendment**.
- **One recorded deviation from §7, authorized by the owner on 18 September 2026:**
  `POST /api/digest/day` is a **mutating route handler**, while §7 describes the
  routes alongside the Server Actions as *"read streams and crons, **not mutations**"*. A
  Server Action is impossible here — the poster is an external, non-browser client holding no
  NextAuth session cookie — and the pattern matches the existing bearer-authenticated
  `/api/cron/*` routes (and `POST /api/import`, which is itself a mutation). Without the POST
  a confirmed send could not be recorded, which would also make the 22:15 fallback ping fire
  every night even after a successful post. Full clause-by-clause analysis in
  `docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md` §15.
  **Owner authorization — granted 18 September 2026.** The deviation was presented with both
  the reason a Server Action cannot serve here (the poster is an external, non-browser client
  with no session cookie) and the cost of avoiding it (D11 record lost, and a fallback push
  every night after a successful post). The owner **authorized** the mutating route, so it may
  be implemented as specified. **`docs/SPEC.md` is still not amended** — the frozen document
  remains frozen, and this entry plus spec §15.1 are the record.
- **Transport is a decision, not an implementation detail.** No free official route into a
  WhatsApp group exists: Meta's Groups API requires an **Official Business Account**, caps
  groups at 8 participants and exposes no add-participant endpoint; and Vercel's serverless
  runtime cannot hold a WhatsApp session. The owner therefore authorized a **Termux + Node +
  Baileys companion-device agent on Dad's Android phone**, posting from Dad's own number —
  which is also the lowest-ban-risk form of an unofficial session, since it behaves as an
  ordinary linked device from a residential IP rather than from a datacenter.
- **Phone-side plan and runbook:** `docs/PLAN_WHATSAPP_AGENT_TERMUX.md`. Three binding
  decisions were taken while planning the device: linking uses a **pairing code, never a QR**
  (a QR rendered by Termux on Dad's phone cannot be scanned by that same phone — this
  **supersedes** the earlier "prefer QR by default" wording); **Termux:Boot is installed** so a
  reboot or overnight update cannot silently stop the feed; and a transient send failure
  retries at **≈2 / 5 / 15 / 30 minutes, then stops for the night** (the ladder is **persisted**
  to `sent/retry-state.json`, so a crash-restart cannot re-arm it), while a `401` or `503` is
  never retried. The target is Dad's **Samsung** (One UI), which needs more than a
  battery-optimisation exemption: Unrestricted battery, absent from *Sleeping apps*, exempt
  from *Put unused apps to sleep*, and kept open from the Recents card.
- **Phone-agent plan hardened after a cold re-read — 18 September 2026 (plan docs only, no
  app code).** Re-reading `docs/PLAN_WHATSAPP_AGENT_TERMUX.md` the way a fresh implementer would
  surfaced **four things that could not have been built as written**, and each was fixed in the
  plan rather than in prose:
  1. **The retry ladder contradicted the wrapper.** It was described as living "in memory"
     while `start.sh` restarts on exit `1` — so exhaustion reset the ladder and the ≈2/5/15/30
     schedule ran again, forever: an outage that should have cost four retries would have
     polled the API all night behind a busy-looking log. The ladder is now **persisted** and
     **exhaustion is a state, not an exit** (exit `1` no longer means "ladder exhausted").
  2. **The ladder was never reached for the failure it existed for.** `tick()` started with the
     fetch and consulted the retry schedule afterwards, so a *thrown* fetch — the canonical
     transient failure — skipped it entirely. The gate (local window key, marker, exhaustion,
     `nextAttemptAt`) is now evaluated **before any network call**, which also stops the 60 s
     tick from polling a database-backed endpoint ~1,440 times a day.
  3. **`--link` failed as specified.** It called `requestPairingCode()` straight after creating
     the socket, which Baileys rejects with `Connection Closed`; the call must be triggered by
     the **first `qr` event** (used only as a trigger — the QR string is still never rendered),
     and gated on `creds.registered` so a second `--link` requests nothing.
  4. **The acceptance tests had no runnable procedure.** `FEED_GRACE_MS` makes the target window
     **stale for 18 hours of every day**, so a real-send rehearsal was only possible between
     22:00 and 04:00. A new `--at <ISO>` flag pins the evaluation instant (forwarded to the
     endpoint's `at` parameter), so every test runs at any hour.
  Also closed in the same pass: a **single-instance lock** (`sent/agent.lock`, exit `7`) and
  **atomic marker writes** so a `--now` rehearsal cannot race the live scheduler into a double
  post or corrupt `auth/`; the **package name is stated** rather than deferred to "verify at
  install time" — `@whiskeysockets/baileys`, Node **≥ 20**, and **no** optional peer dependency
  (`sharp` being exactly the native dependency that would break a Termux install); and `phone`
  is **normative** in `config.json` because `--link` cannot work without it.
- **Missed windows are never back-filled.** A window that has gone stale is still rendered
  and returned (so it stays debuggable and curl-testable) but the agent refuses to post it;
  the 22:15 push is what surfaces the miss.
- **Accepted risk, on the record:** Baileys drives the undocumented WhatsApp Web protocol and
  the linked number could be restricted. The owner chose Dad's primary number over a spare
  one, accepting that residual risk.
- `docs/SPEC.md` is **not amended** by this feature. The existing weekly/monthly aggregate
  digest (§6.8) — Telegram auto-send plus WhatsApp Click-to-Chat — is **untouched**; the two
  messages are different shapes on different triggers, and both fire on the
  7th/14th/21st/28th and month-end.

### Implementation — 18 September 2026

New files:

- `src/lib/ledger-feed-window.ts` (pure) — `feedWindowForInstant`, `windowKeyLabel`,
  `FEED_KEY_RE`, `FEED_HOUR_IST`, `FEED_GRACE_MS`. The boundary is built through
  `date-fns-tz`'s `fromZonedTime` against `APP_TIMEZONE`, never by adding `19800` seconds
  (§5.7).
- `src/lib/transaction-diff.ts` (pure) — `TransactionSnapshot`, `TRACKED_FIELDS`,
  `toSnapshot`, `diffSnapshots`. Amounts compare **numerically** (so `450.00` → `450.0` is not
  a change) and `splitWith` compares as a **set** (so reordering the assigned members is not a
  change either) — both were the difference between a useful journal and a noisy one.
- `src/lib/ledger-feed-format.ts` (pure) — the feed types, `sanitizeWhatsAppText`,
  `buildFeedChanges` and `buildLedgerFeedMessage`.
- `src/lib/ledger-feed.ts` (`server-only`) — `getLedgerFeed`, the three `app_settings` keys and
  their helpers, re-exporting both pure modules.
- `src/lib/ledger-feed-test.ts` + the `test:ledger-feed` npm script — **68 assertions**.
- `src/app/api/digest/day/route.ts` — `GET` (the finished message) + `POST` (the send record,
  the §15.1 deviation the owner authorized).
- `src/app/api/cron/digest-fallback/route.ts` + the `vercel.json` entry `45 16 * * *` (= 22:15
  IST) — the safety net, gated in this order: `whatsapp_feed_enabled`, then the send marker,
  then an at-most-once ping marker.
- `src/lib/push-dispatch.ts` — the web-push fan-out (including the 404/410 stale-endpoint
  purge) **extracted** from `pingDigestReady()`, which now calls it. One delivery loop, two
  callers; no second implementation to drift.

Changed files:

- `src/actions/transactions.ts` — `readSnapshots()` + `logTransactionEdits()` on the four
  writers: `updateTransaction` (`edit_sheet`), `setTransactionAssignment` (`assignment`),
  `setTransactionsAssignment` (`bulk_assignment`), `assignCategory` (`bulk_category`). A no-op
  edit writes **nothing**, and the pre-image read that `updateTransaction` already performed
  for its Review-queue note comparison was generalized rather than duplicated.
- `src/actions/activity.ts` — `restoreActivityEntry` now records `ids` (D6 netting), and
  `listActivity()` **excludes** `update_transaction` so §6.5's History surface is not widened
  by accident. Excluded rather than allowlisted deliberately: an allowlist would also have
  dropped the `restore_transactions` and `skip_template_month` rows that surface shows today,
  which would have been a silent behaviour change this feature has no business making.
- `src/lib/digest.ts` + `src/components/digest/digest-card.tsx` — the third `whatsapp_feed`
  channel, tested **before** `whatsapp:` in the key scan, and rendered "WhatsApp feed" through
  a channel→label map that replaced both `channel === "telegram" ? … : "WhatsApp"` ternaries.

Three implementation decisions worth recording:

1. **The builder is a separate pure module.** The spec puts `getLedgerFeed` and
   `buildLedgerFeedMessage` in one `server-only` file, but `server-only` throws when imported
   outside a React Server Component — which would leave the message builder untestable under
   `tsx`. It therefore lives in `ledger-feed-format.ts` and is re-exported from `ledger-feed.ts`,
   exactly as `digest.ts` re-exports `digest-format.ts`. Same import surface, and the builder is
   now covered by the suite.
2. **Money uses `formatINR()`**, so rows render `₹450.00` rather than the spec sample's `₹450`.
   §5.4.6 names `formatINR` as *"the only formatter that may be used"*, so this follows the
   letter at the cost of the sample's whole-rupee look; swapping to `formatINRWhole()` is a
   one-word change if the owner prefers the tighter rendering.
3. **Ambiguous change fields carry readable prefixes** from one constant (`CHANGE_PREFIX` in
   `ledger-feed-format.ts`): `note:`, `when:` (date/time), `for:` (member), `assigned:`
   (assignment). `amount`, `categoryId` and `tag` stay unprefixed, which is what produces the
   sample's compact `🍔 Dining Out · ₹450 → ₹500` line.

**Still outstanding on the service side:** `DIGEST_AGENT_TOKEN` must be set on Vercel and
redeployed — without it `GET`/`POST /api/digest/day` answer `503` by design ("not
configured" is deliberately a different diagnosis from `401` "wrong token").

**Verified:** `npm run typecheck`, `npm run lint`, `npm run test:ledger-feed` (68/68) and
`npm run test:digest` (38/38) — all green. The DB-backed paths (netting, the SQL total, the
fallback gates) are exercised by the spec's §8 curl commands against a real deployment.

**Landed as five commits, `064ed3a`…`984418e`, pushed 18 September 2026** — the pure layer
(window, diff, builder, 68 assertions) first, then the edit journal, then the read/record
endpoints, then the 22:15 fallback cron, then the card's third channel. The order is the
dependency order — the journal and the endpoints both build on the pure layer, and the fallback
cron on the endpoints — so every commit typechecks on its own as it lands.

### Follow-up — 18 September 2026: the master switch, and a runnable verifier

Two gaps this feature left behind, closed in commits `bc74c71`…`77e880c`.

**The master switch was unreachable.** §5.6 described `whatsapp_feed_enabled` as letting the
owner silence the feed during a holiday "without touching the phone", and edge case E18
described disabling it mid-month — but nothing in the app ever *wrote* that key. `isFeedEnabled()`
is read by the endpoint and by the fallback cron, so the switch half worked; there was simply no
way to flip it except inserting a row into `app_settings` by hand, which is precisely what the
spec promised the owner would not have to do. It was found while reconciling the implementation
against the spec, and it is the reason E18 had no user-facing procedure.

Now: `setFeedEnabled()` writes the key, `saveFeedEnabled()` (a Server Action in
`src/actions/digest.ts`) authenticates and validates it, and `DigestSettingsCard` renders a
**Switch** seeded from the Settings page. It keeps its own component state, separate from the
weekly digest's *"Automatic weekly digest"* switch, so neither delivery can mask the other's
failure. Off silences the nightly post **and** the 22:15 fallback ping — a switch the owner
flipped on purpose must not generate a nag.

**The verification block became a script.** `npm run verify:digest-feed`
(`scripts/digest-feed-check.mjs`) replaces the hand-run curls and adds what a person would not
do by hand: the 22:00 IST boundary arithmetic is recomputed **independently** in the script and
compared exactly at six pinned instants — exact boundary, one second before it, a late fire, 7 h
late, month rollover and year rollover — plus the message contract, `?at` validation, `?dryRun`
and the write-free POST paths.

It deliberately **never POSTs `status: "sent"`**: that is the real confirmation path, and against
a live window it would write the send marker, suppress that night's post and disable the
fallback, with no delete endpoint to undo it. The `failed` branch is exercised instead, and its
no-write guarantee is proved by reading `alreadySent`/`sentAt` before and after.

A `503` is reported as its own diagnosis — *"the deployment has no `DIGEST_AGENT_TOKEN`"* —
rather than as a bad token, which is the reason the route tells the two apart at all.

**Verified:** `npm run typecheck`, `npm run lint`, `npm run test:ledger-feed` (68/68) and
`npm run test:digest` (38/38) all green. The verifier was exercised against a stub built on the
app's real `feedWindowForInstant`: **150 checks pass**, while a shifted window, an unbalanced
markdown marker and an unconfigured token each fail with exit 1 and the offending check named.
That rehearsal caught two bugs **in the script itself** — `Intl` renders September as `Sept`
where date-fns' `MMM` gives `Sep` (four letters against three, so the label check failed on every
September window), and `process.exit(1)` called while a fetch socket is still closing trips a
libuv assertion on Windows (`UV_HANDLE_CLOSING`), aborting with exit 127 instead of 1.

**Still outstanding:** a deployment that actually contains the routes (see the next section — the
verifier cannot even reach the token check yet) and the phone agent
(`docs/PLAN_WHATSAPP_AGENT_TERMUX.md`).

### Incident + hardening — 18 September 2026

**Every deployment had been failing, and the cause was mine.** Running the verifier reported
`404` from `/api/digest/day` rather than the expected `401`/`503`, and the Vercel API (read-only,
with the `VERCEL_TOKEN` already in `.env.local`) showed why: every deployment from `984418e`
onward was `ERROR` with `INVALID_VERCEL_CONFIG`:

```
Invalid vercel.json - `crons[1]` should NOT have additional property `comment`. Please remove it.
```

The human-readable `"comment"` field I added to the new cron object is not part of the cron
schema, which allows only `path` and `schedule`. Config validation runs **before** the build, so
the deploy failed outright and Vercel kept serving the previous one — the last `READY` was
`ee082c5`, which predates the feature entirely. That is why `/api/digest/day` and
`/api/cron/digest-fallback` answered `404` while the older `/api/cron/*` routes answered `401`,
and why the feed was never live despite five green local commits. It also explains the two
docs-only commits that failed: they cannot break a build, but they *can* break a deploy through
`vercel.json` — a signal I misread as "unrelated" before checking the log.

Fixed by deleting the property. The file is now validated against the authoritative schema at
`openapi.vercel.sh/vercel.json` (cron items allow exactly `schedule` and `path`).

**Lesson worth keeping:** a green `npm run build` proves nothing about whether a deployment
succeeds, because config validation happens before the build. Verify by deployment state, not by
local build.

**Two `windowKey` findings from the auth review, now fixed** (§5.5.3):

- The key was validated for **shape only**. `FEED_KEY_RE` accepts `9999-99-99..9999-99-99`,
  `2026-02-30..2026-03-01`, non-24-hour ranges and reversed ones. A marker written under such a
  key is permanent, and because `getRecentDigestSends()` keeps the newest value per channel it
  would also surface on the Settings card as the feed's last send. `parseFeedKey()` now requires
  the shape, **real calendar dates** (re-formatted and compared, so February 30 is rejected
  rather than rolled over) and **adjacency**.
- A **future** window could be recorded. `feedKeyHasEnded()` now gates the write: marking a night
  that has not happened would make the agent see `alreadySent`, post nothing, and leave the
  22:15 fallback silent too, because it also treats an existing marker as handled. One bad client
  become one silently unreported night — the exact failure this feature exists to prevent. The
  route still *returns* a future window from `GET at=<future>`; it only refuses to record one.

Deliberately **not** added: an age bound on the key. Only the token holder can write one, its
only effect is a confusing card row, and rejecting a legitimately late post is the worse failure.

**Verifier improvements, and a bug it caught in itself:**

- A `404` is now its own diagnosis — the script stops at the first call and says the deployment
  predates the route, instead of printing "got 404" four times and dumping minified HTML.
- Three new `POST` probes cover the hardened rules. They send `status: "failed"` deliberately,
  because that is the one status that records nothing: run against a build predating the
  hardening, a `sent` probe would have left a junk marker behind.
- The rehearsal caught a real bug in those very probes: the pre-existing `failed` probe used the
  hard-coded key `2026-09-17..2026-09-18`, which is a **future** window on the day it runs — the
  hardened validator correctly rejected it, so the probe failed for the wrong reason. The probes
  now derive their key from the server's own current window.

**Verified:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:digest` (38/38)
and `npm run test:ledger-feed` (**85 checks**, up from 68 — 17 for the new validation) all green.
The verifier was re-run against a stub built on the app's real `parseFeedKey`/`feedKeyHasEnded`:
**154 checks pass, 0 failures**, while the same script against a 404 stub stops with the clear
deployment diagnosis. A live production run must follow the deploy.

**Reviewed at the same time and still open** (recorded so they are decisions, not oversights):
no throttling on the token endpoint though `RateLimiter` exists for the password login; the auth
scheme is matched case-sensitively, so `bearer <token>` is refused; a `503` before auth discloses
whether the secret is configured (intended, and how this incident was diagnosed); the POST
`detail` string reaches `console.warn` unvalidated and unbounded; and the token reads **any**
24-hour window through `at`, so it is a read capability over all history rather than "today".

---

## Master-password change retires existing sessions — 13 September 2026 (owner request)

Owner report: after changing `FAMILY_MASTER_PASSWORD` on the deployment platform
and redeploying, an already-signed-in device still opened the app straight to the
homepage instead of being asked for the password again.

- **Cause:** the session is a **stateless JWT signed with `AUTH_SECRET`** (§1.8).
The password was read *only* in `authorize()`, so changing it did not alter the
signing key — the old cookie kept verifying until `maxAge`, and `updateAge`
rolled an active holder forward indefinitely.
- **§3.1 point 5 added (normative):** the `jwt` callback pins an HMAC-SHA-256
fingerprint of `FAMILY_MASTER_PASSWORD` — keyed by `AUTH_SECRET`, via
`masterPasswordFingerprint()` in `src/lib/secure-compare.ts` — into the token at
sign-in, and re-derives it on every request; on mismatch the `session` callback
drops `user`, so middleware redirects to `/login` and every `!session?.user`
Server Action / route-handler guard fails closed. Env var + redeploy remains the
whole mechanism: no credentials table, no in-app password change and no
deployment-control architecture (§6.5). §6.5 now states the revocation
consequence explicitly.
- `src/app/(app)/layout.tsx` tightened from `!session` to `!session?.user` so the
layout redirects a retired session exactly like a logged-out one.
- **Upgrade effect:** tokens issued before this change carry no fingerprint and
are treated as signed out, so the first deploy signs every device out once.
- Verified: `tsc --noEmit`, eslint and `npm run test:password-session` (15
assertions over the real `jwt` / `session` / `authorized` callbacks) green.

---

## Assignment follow-ups — bulk assign, filter & totals — 11 September 2026 (owner follow-up)

Owner follow-up to the per-expense assignment: act on many entries at once,
query by assignee, and see the split.

- **Bulk assign:** the selection bar's **Assign** button is now a menu
  (**Category…** / **For members…**); the member sheet applies one assignment
  to the whole selection via new `setTransactionsAssignment(ids, memberIds)`,
  optimistically, with per-row undo.
- **Ledger filter by assignee:** `assignee=<member id>` (or `assignee=unassigned`)
  flows through the URL, `buildWhere` (`split_with @>` / empty array), saved
  searches and the filter bar — distinct from the existing "who entered it"
  member pills.
- **Assignee totals:** collapsed **For whom?** section in the ledger summary
  card — spend per assignment combination and **per member** (shared spend
  counts for each member it is for), via `getAssigneeBreakdown` over the same
  `WHERE` as the list.
- Verified: `tsc --noEmit`, eslint and the pure unit tests (ledger-url,
  validation, export-format, csv, xlsx, web-push, digest) green.

---

## Per-expense "who is this for?" assignment — 11 September 2026 (owner request)

Owner request: *"Just because a transaction has been entered by MA, that doesn't
mean that expense was made for MA. Assigning the expense to a member or a couple
of members or all three is a separate input."* The §2.2 `shared` toggle is
replaced by an explicit, optional **multi-member assignment**, wholly
independent of who entered the expense.

- **`MemberAssignmentPicker`** (`src/components/transactions/member-assignment.tsx`,
  new) replaces `shared-toggle.tsx`: member chips, no switch, **unassigned by
default**. Shown in Quick Add and the edit sheet.
- **Ledger/Review inline chip** (`transaction-item.tsx`): every row carries a
  compact `For?` chip; tapping it opens a multi-select menu to assign or clear
  without opening the editor. New `setTransactionAssignment(id, memberIds)`
  Server Action backs it, applied optimistically in both lists.
- **Model:** `transactions.split_with` now means "who this expense is for"
  (empty = not assigned). `shared` survives only as a derived flag
  (`splitWith.length > 0`) for the export/import format and is no longer client
  input (`transactionBaseSchema`).
- **Import:** a legacy backup carrying `shared = 1` with no explicit
  `split_with` expands to every member; otherwise the explicit list wins.
- **History:** migration `0017_clear_expense_assignments` clears every existing
  assignment (`split_with = '{}'`, `shared = false`) — expenses logged before
  this change start unassigned, as requested.
- Verified: `tsc --noEmit`, eslint, `test:validation`, `test:export-format` and
  the migration journal guard green.

---

## Collapsible settings sections + Expand all / Collapse all — 10 September 2026 (owner follow-up)

Owner request: *"the whole page is too long"* — the Settings page now renders every
card behind a **collapsible header** (title + description + chevron), so the page is
nothing but compact headers until a section is opened. Follow-ups added page-level
Expand all / Collapse all controls and a smooth height animation.

- **`src/components/ui/collapsible.tsx`** (new): shadcn-style wrapper around the
  `radix-ui` Collapsible primitive; its content animates height via the
  `tw-animate-css` `collapsible-down`/`collapsible-up` keyframes (driven by the
  height Radix measures on the content element) instead of popping.
- **`src/components/settings/settings-section.tsx`** (new): a collapsible card whose
  whole header is the toggle (keyboard-accessible button). Each section remembers
  its open/closed state per device in `localStorage` (`settings:section:<id>`), and
  a URL hash like `#whatsapp-digest` / `#offline-entries` opens that section on load
  so deep links still land on the content.
- **Every settings card is now a section** — Members, Templates, Categories,
  Budgets, History, WhatsApp & Telegram digest (first pass), then Offline entries,
  Notifications and Password (follow-up). All default to collapsed; the two
  deep-link ids are preserved on their cards.
- **`src/components/settings/settings-section-controls.tsx`** (new): **Expand all**
  and **Collapse all** outline buttons beside the Settings heading. Each section
  listens for the broadcast window events and persists the result like a manual
  toggle.
- Verified: `tsc --noEmit`, eslint (no new warnings) and a full `next build` green.

---

## Digest last-sent history — 7 September 2026 (owner follow-up)

The digest cards now show **when each channel last sent a digest and for which
period**. The per-(channel, period) idempotency marker was unified into a single
`digest_sent:<channel>:<start>..<end>` record (ISO timestamp) written on EVERY
successful send — cron AND manual — so the automatic gate and the displayed
history can never disagree. Telegram writes it in `sendTelegramDigest`;
WhatsApp writes it in the manual action (`recordWhatsAppDigestSent`) and in the
cron's ping (its former ping gate). `getRecentDigestSends()` returns the latest
send per channel; `periodKeyLabel()` reconstructs the display label
("1–7 Sep", "September 2026") from the stored key — compact range labels
(day–day + month) landed in the digest headers too. Settings shows a "Last
sent" block per channel; the dashboard card shows a compact one-line summary.
`test:digest` grew to 39 checks (label reconstruction + compact ranges).

---

## Weekly + monthly digest on Telegram and WhatsApp — 7 September 2026

Owner request: send a **weekly digest** to a WhatsApp number configured in Settings, plus a manual
"send now" (month-wise, and this month 1st → today). Owner decisions during the design discussion:

- **WhatsApp channel = Click-to-Chat (wa.me), not the Cloud API.** No Meta account, no message-
  template approval, no per-message cost. "Sending" opens WhatsApp with the digest pre-filled and
  the household taps Send — the owner explicitly accepted the manual Send tap.
- **Schedule = the 7th, 14th, 21st, 28th (weekly) and the last day of the month (monthly), at
  10:00 PM IST.** When a date is both (e.g. 28 February) the monthly digest wins — it already
  spans that week. Weekly periods are month-anchored ranges: 1–7, 8–14, 15–22, 22–28.
- **Telegram and WhatsApp run in parallel** ("mirror implementation of features for both"); the
  old 1st-of-month Telegram monthly cron is superseded by the unified schedule. The Telegram CSV
  backup cron is untouched.
- **Manual send buttons live in Settings (full) and on the dashboard (compact).**

### Engine (new shared layer)

- **`src/lib/digest-format.ts`** (pure, DB-free, unit-tested): period math (`digestPeriodForDate`,
  `monthPeriod`, `monthToDatePeriod` — the cron and the UI derive from one function so they can
  never disagree), both message formatters (Telegram HTML, WhatsApp `*markdown*`), phone
  normalization (`+91 98765 43210` / `09876543210` / 10-digit → E.164 digits) and the wa.me link
  builder.
- **`src/lib/digest.ts`** (server-only): `getDigestData(start, end)` — the old monthly digest's SQL
  aggregates generalized to any date range (totals + per-tag split, top 5 categories, per-member
  spend), plus re-exports of the pure layer. `previousMonthInIST` moved to `src/lib/dates.ts`
  (backup delivery import updated).
- **`src/lib/telegram-digest.ts`** now has an idempotent cron path (`sendTelegramDigestIdempotent`,
  per-period marker `telegram_digest_sent:<start>..<end>`) and a plain manual path — the old
  month-only `sendMonthlyTelegramDigest` is gone.
- **`src/lib/whatsapp-digest.ts`**: Settings storage (`whatsapp_digest_phone` E.164 digits +
  `whatsapp_digest_enabled` in `app_settings`), `buildWhatsAppDigestLink`, and the push ping
  (`pingDigestReady` — "digest ready — tap to send on WhatsApp", idempotent per period, same
  gate pattern as §2.11). No new env vars for WhatsApp.

### Surfaces

- **Cron:** `/api/cron/digest` runs daily at 16:30 UTC (22:00 IST) via `vercel.json` and checks
  the IST day-of-month in code (no last-day-of-month cron syntax needed). On a digest day it
  auto-sends Telegram (idempotent) and, when WhatsApp is enabled + configured, pings opted-in
  devices via Web Push. `?date=YYYY-MM-DD` backfills, `?dryRun=1` reports without sending.
  The old `/api/cron/telegram-digest` route is deleted.
- **Settings → "WhatsApp & Telegram digest" card** (`src/components/digest/digest-card.tsx`, full
  variant): number input + save, automatic-digest toggle, due-today banner, and manual sends —
  month picker (36-month window) + "This month (1st → today)", each with Telegram and WhatsApp
  buttons. Telegram sends post immediately; WhatsApp opens the wa.me draft in a new tab.
- **Dashboard digest card** (compact variant): due-today "Send on WhatsApp" one-tap banner (the
  wa.me link is built server-side), quick this-month sends, and a Configure link.
- **Actions:** `saveWhatsAppDigest` + `sendDigestManual` (`src/actions/digest.ts`), zod-validated,
  auth-guarded; manual sends bypass idempotency by design (user-initiated re-sends are allowed).

### Verification

- `npm run test:digest` — 34 checks: every period branch, the February 28th collision, 31-day
  months, period-key uniqueness, both formatters (incl. HTML escaping), phone normalization,
  wa.me encoding.
- `tsc --noEmit`, `eslint` (no new warnings) and a full `next build` are green; `/api/cron/digest`
  is registered in the build output.

---

## Quick Add — the note field opens empty — 5 September 2026

Owner request: *"every time i open add transaction, note field is prefilled with last time entered notes.. i don't want it.. i want note field to be empty when i open a new add transaction."*

The §6.2 "repeat entries" memory (`quick-add:last-entry`, shipped in the 25-Aug UX pass) restored
the last committed **tag + note** on every open and after every multi-entry reset — so the Note
field came up pre-filled with the previous transaction's text. Per the owner decision the note no
longer repeats.

- **The last-entry memory is now tag-only.** `loadLastEntry`/`saveLastEntry` in
  `src/components/quick-add/quick-add-sheet.tsx` carry just the tag; `reset()` sets the Note field
  to `""`, so every open (and every Add-another) starts with an empty Note field. Old
  `quick-add:last-entry` payloads in users' localStorage still parse — the stray `note` key is
  simply ignored on read and dropped on the next save.
- **What deliberately stays:** the one-tap "recent notes" chips (`quick-add:recent-notes`, UX pass
  A3) still render **while the field is empty**, so repeat notes (recharges, EMIs) remain a single
  tap away — opt-in instead of pre-filled. Tag memory, amount/date/time reset, multi-entry mode
  and template prefills are all unchanged.

---

## SPEC sync — the September 2026 audit-remediation wave recorded — 3 September 2026

Owner request: "update spec doc to have all the features that have been implemented."
`SPEC.md` had recorded everything through the 25–26 August passes but **none** of the
2–3 September audit-remediation work (commits `6f8f2be`…`a666bb2`, 33 commits). This
entry records that sync. No normative rule changed today — this documents what shipped.

- **§2 stack table:** added Vercel Blob (§2.9), Web Push/VAPID (§2.11), and the PWA row
  (`sw.js` + manifest + IndexedDB offline-add queue).
- **§4 schema:** 5 → 8 tables (`saved_searches`, `attachments`, `push_subscriptions`,
  `activity_log`); `categories.parent_id` hierarchy summary; `transactions.shared` /
  `split_with`; `budgets.group_id`; template controls (`is_paused`, `is_variable`,
  `skip_month`) + the 25 Aug recurring fields (`auto_day`, `last_auto_key`,
  `member_id`); the pg_trgm GIN + `reviewed_at` partial indexes; the full index list.
- **§6.5 Settings:** new cards recorded — Templates (with pause/skip/variable
  controls), Offline entries, Notifications, History; merge + move-between-groups
  added to the category management list; per-group budgets in the Budgets card.
- **§6.8 (new):** the September feature wave, one paragraph per audit item §2.1–§2.12
  (group budgets, shared ownership, split amount/percent, recurring detection, pacing
  headline, saved searches + amount/date ranges, insights, receipts, 4-format
  streaming export + import + monthly backup, Web Push, household operations) plus
  the security/integrity hardening and the CI migration-replay job.
- **§7.1:** the action list grew to the real set (bulk, templates, merge, saved
  searches, activity) and gained the normative `auth()` session guard as step 1.
- **§9.1:** optional feature env vars table (Blob, Telegram, Resend, VAPID, CRON_SECRET).
- **§11 exclusion list:** PWA/offline-first, automated recurring generation, receipt
  attachments and Telegram/email digest struck through with dated annotations —
  all four shipped (25 Aug, 2–3 Sept). Merchant auto-categorization stays excluded,
  with a note distinguishing it from the shipped *suggestions* (Amendment 8).
- **§6.3:** the Who-spent card's history (removed 24 Aug, reinstated 2 Sept, removed
  again 3 Sept) is now fully annotated.

---

## Export and backup — streaming export, JSON, XLSX, scheduled monthly backup, and an import path (§2.10) — 2 September 2026

The audit's §2.10: *"CSV is unbounded (§1.10) and 7-column. Add: streaming export, JSON (full
fidelity, including `reviewed_at` and attachments), XLSX for spreadsheet users, and a scheduled
monthly email/Telegram of the CSV — the Telegram digest foundation already exists (`c7c1fb6`).
Also an import path so a restore is possible; right now export is one-way."*

### Fixes

- **The export was unbounded and single-shot.** `exportCsv` ran one unbounded SELECT, joined the
  whole result into a JS string inside a Server Action, and had no ceiling. Replaced by
  `src/lib/export-rows.ts` — a keyset-curated, batched (500 rows/trip), capped (100k rows)
  async iterator — streamed by GET `/api/export` (`src/app/api/export/route.ts`). Peak memory is
  one batch, and truncation is reported in `x-export-rows` / `x-export-truncated` headers
  committed before the first byte.
- **The old `exportCsv` Server Action is deleted.** The ledger's Export button became a plain
  `<a href download>` menu (CSV full / CSV 7-column / JSON / XLSX), so the action had no client
  reference left, and `verify:export-live` (which located its action id inside live client
  chunks) would have failed on the first deploy after this change. The script now fetches
  `/api/export?format=csv&columns=canonical` directly and checks the same seed.csv equality.
- **`src/lib/csv.ts` gained `parseCsv`** — the read side of the RFC 4180 contract, kept
  textually aligned with `scripts/lib/csv.mjs` so the shipped importer and exporter agree
  byte for byte.

### Surfaces

- **Three new export shapes** (`src/lib/export-format.ts`): a 16-column extended CSV (ids, slugs,
  group, shared/split_with, `reviewed_at`, attachment locators), full-fidelity JSON with the
  `family-ledger-export@1` envelope (amounts as both rupee decimal and integer paise, ISO
  timestamps), and a real .xlsx (numbers as numeric cells, frozen bold header; hand-rolled
  ZIP/OPC writer in `src/lib/zip.ts` + `src/lib/xlsx.ts` — no spreadsheet dependency).
  The canonical 7-column CSV stays byte-identical to the pre-change format (§6.6/§8).
- **Import — the way back in** (`/api/import`, `src/lib/ledger-import.ts`, `src/lib/import-apply.ts`):
  accepts the JSON backup, the 16-column CSV and the 7-column CSV; `?mode=preview` reports
  before anything is written, `?mode=commit` inserts. Idempotent two ways — by primary key for
  id-bearing files, by (date, time, member, amount, note) fingerprint for the canonical CSV.
  Members/categories resolve by slug then display name, so renames between backup and restore
  still restore; unresolved members skip the row, unresolved categories import uncategorized
  (losing the label is better than losing the rupees). The ledger header gained an Import
  button with a two-step preview sheet (`src/components/transactions/import-dialog.tsx`).
- **Scheduled monthly backup** (`/api/cron/backup`, 1st at 04:00 IST in `vercel.json`):
  builds the canonical CSV of the previous month through the capped iterator and delivers it
  via Telegram `sendDocument` and/or Resend email (`src/lib/backup-delivery.ts`), idempotent
  per month through `app_settings`, failing loudly (503) when no channel is configured rather
  than silently doing nothing. Env vars documented in `.env.example`.

### Verification

- `npm run typecheck` → exit 0; `npm run lint` → clean (the three remaining warnings are
  pre-existing, in budget-mutations.ts / recurring-detection.ts).
- `npm run test:csv-parse` — 14 checks: writer → reader round-trip incl. embedded commas,
  quotes, newlines, CRLF, unterminated-quote rejection.
- `npm run test:export-format` — 49 checks: canonical line byte-identity, extended-CSV/JSON →
  `parseImportFile` round-trips, validation rejections, fingerprints, filenames/URLs, XLSX cells.
- `npm run test:xlsx` — 33 checks: CRC-32 against the standard check value, ZIP local/central/
  EOCD layout and offsets, all six OPC parts, inline strings, numeric cells, escaping,
  control-char stripping, frozen bold header, column names past Z.
- All three added to the CI `checks` job (DB-free).

### Runtime status

Code-complete, type-clean, lint-clean. The /api/export and /api/import routes are unit-verified
through the format layer but not yet exercised against the deployed app; `verify:export-live`
will do so once deployed. The backup cron needs `CRON_SECRET` plus at least one channel's env
vars (`TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` or `RESEND_API_KEY`+`BACKUP_EMAIL_TO`+`BACKUP_EMAIL_FROM`)
on Vercel. No schema change — the import path writes to the existing `transactions` table.

---


## Group-filter completion & pie drill-through — 26 August 2026 (owner follow-up to the nested-categories pass)

Recorded as defect fixes plus one additive surface on top of the 25-August hierarchy pass;
no §-semantics change. Audit of that pass found the server side fully correct (schema/migration
parity, leaf-only assignment guards, single group expansion, rollup math) but two new-surface
wiring gaps.

### Fixes

- **`?group=` was unreachable from the UI.** The ledger category filter rendered groups only
  as non-selectable section labels while its change handler (`g:` values), bound control value
  and active-group chip already spoke the group dialect — no code path could produce a real
  `groupId`, so the filter only worked via hand-typed URLs (and even then showed the "All
  categories" placeholder, since no option carried the bound value). Fix: each group section
  now offers a selectable `{emoji} {name} — all` item (`?group=<uuid>`) above its leaves;
  precedence (leaf > uncategorized > group) was already correct server-side.
- **`createCategoryGroup` skipped `revalidatePath("/transactions")`**, so new groups stayed
  invisible in the ledger filter and edit-dialog optgroups until an unrelated mutation fired.
  Now revalidates all three routes like every sibling action.

### Surfaces

- **Dashboard pie drill-through:** each top-level group row in the spending-by-category legend
  gains an ↗ link to `/transactions?group=<uuid>&month=<viewed month>` — one tap from a slice
  to row-level detail for the exact month shown. The legend row still expands in place; the
  link is a separate affordance. Uncategorized keeps no link (it has no backing group).

### Verification

- `npm run test:hierarchy` — 7/7 against the real DB after re-running migrations (idempotent).
- `test:ledger-url` extended coverage confirmed green (25 checks: group serialization,
  mutual-exclusion precedence, invalid-UUID dropping) alongside `tsc --noEmit` and eslint.
- `smoke:prod` loss-detection baseline held after push (≥ seed counts and totals).

### Addendum (same day) — production had been un-deployable since the hierarchy pass

End-to-end verification of the drill-through on the live site found that **every production
deployment since `43a4289` (the nested-categories schema commit) had failed at build**, leaving
production serving the pre-hierarchy flat-category build while the database had already
migrated — which is why the whole pass appeared "not correctly implemented" from outside.

- **Root cause:** `src/actions/settings.ts` exported `OTHER_GROUP_SLUG`, a plain const, from a
  `"use server"` module. Next.js requires every runtime export of a server-action file to be an
  async function → `next build` exited 1 (`Only async functions are allowed to be exported in a
  "use server" file`). `tsc --noEmit` cannot catch this class of error; only a full build can.
- **Fix:** dropped the `export` keyword — the constant has no external importers and is used
  only by `createCategory`'s fallback path within the same file. All other `src/actions/*`
  files audited for value exports: none remain.
- **Deployed & verified:** commit `90dbd56` builds and reached READY on Vercel; the live
  dashboard serves the pie drill-through links, following one lands on the ledger with the
  active-group chip and month filter applied, and `smoke:prod` holds its baseline.
- **Process note:** nothing in the local check suite ran `next build`; consider wiring a
  production build into CI or a pre-push gate so server-action export regressions fail before
  deploy rather than after.

---
## Nested categories pass — 25 August 2026 (owner request: "too many categories"; two-level taxonomy, leaf-only assignment)

Recorded as a pass: additive schema + UX; existing §-semantics preserved (every rupee still
lives on exactly one category row; slugs immutable; uncategorized remains a state).

### Schema & invariants

- **Two-level hierarchy:** `categories.parent_id` (nullable self-FK), migration
  `drizzle/0008_category_hierarchy.sql` — idempotent, applied to production. NULL = a GROUP
  (rollup container, never assignable); non-NULL = a LEAF whose parent is a top-level row.
  Depth is capped at exactly 2 by the mutation actions, not by convention.
- **The seven household groups** (Getting Around / Food & Provisions / People & Care /
  Home & Bills / Wealth & Protection / Lifestyle & Giving / Other) parent the 19 former flat
  categories; group slugs carry a reserved `grp-` prefix and can never collide with user
  categories. Seed (`SEED_CATEGORY_GROUPS` + `CATEGORY_GROUP_OF_LEAF`) mirrors the migration,
  so fresh `db:setup` databases match migrated ones.
- **Leaf-only assignment is enforced server-side** via `isAssignableCategory()`:
  create/update/bulk-assign transaction, template create/update, and budget saves all reject
  group ids. Budgets remain leaf-only + total (owner decision) — a group's limit is the sum
  of its children, never a stored row.
- New actions: `createCategoryGroup`, `moveCategoryToGroup`, `reorderCategoryGroups`,
  `reorderCategoriesUnder`; inline `createCategory` now files new leaves into a chosen group
  (default: Other) so they are immediately assignable and roll up correctly.

### Surfaces

- **Dashboard pie:** renders GROUP slices (~7) with per-group MoM chips; tap a legend row to
  drill into its categories in place ("All groups" returns). Uncategorized stays its own
  explicit slice. Both levels aggregate client-side from one cached query (leaf rows now
  LEFT JOIN their parent's display fields).
- **Pickers** (edit dialog, bulk assign, review): accordion sections — headers expand/collapse
  and are never selectable; leaves inside keep budget hints/rename/add. One-tap chip rows on
  top: Suggested (note matches) and Recent (household's most-used, derived from the ledger,
  cached under the transactions tag). The selected leaf's group auto-expands.
- **Ledger filter:** `?group=<uuid>` deep link; picker shows groups as labelled sections with
  nested leaves; active group gets its own chip. Mutual exclusion with
  `?category=`/uncategorized is normative (leaf > uncategorized > group); expansion happens
  once via `expandGroupFilter()` so list, summary and CSV export always describe the same set.
  An empty group matches nothing (explicit FALSE), never everything.
- **Settings → Categories:** tree editor — rename/emoji/reorder groups, reorder leaves within
  a group, move a leaf between groups, add categories per group, create groups. Deletion
  still unavailable. Templates' selects, the split dialog's selects and the budget manager
  are leaves-only (budget manager renders grouped sections); the old flat
  `reorderCategories` action is deleted.

### Tests

- `npm run test:hierarchy` — round-trip against the real DB: group/leaf persistence,
  assignability matrix (leaf ✓ / group ✗ / unknown ✗), rollup join attribution, depth guard.
- `npm run test:ledger-url` extended for `?group=`: serialization, precedence rules,
  invalid-UUID dropping.
- `smoke:prod` baseline semantics changed from exact-equality to LOSS-detection (≥ seed):
  auto-recurring and real usage legitimately grow prod; falling under the seeded baseline is
  the failure.

---

## UX/PWA pass — 25 August 2026 (owner request: install fix, offline capture, pacing, deltas, splits, auto-recurring; no frozen-section rewrites)

Recorded as a pass rather than a numbered amendment: every change below is additive UX
or a bug fix; normative §-sections are unchanged except where noted.

### PWA installability — root cause fixed

- **Bug:** Chrome never offered "Add to Home Screen". Auth middleware intercepted
  `/manifest.webmanifest` and `/icon` — browsers fetch those WITHOUT cookies, received a
  307 → `/login` HTML body, and silently dropped install eligibility. The matcher now
  excludes the manifest, icon routes, `sw.js` and `/offline` (none carry user data).
- **Icon:** the text `₹` glyph required a build-time dynamic font download that fails on
  restricted networks and rendered a tofu box. Both icon routes are redrawn as pure-shape
  divs (ledger book on the brand gradient) — no font dependency. Manifest icon sizes
  corrected to the true 512×512 (a declared-vs-actual mismatch also rejects installability);
  art double-declared `any` + `maskable`; added `id`, `scope`, `orientation`, `categories`.
- **Service worker** (`public/sw.js`): navigations network-first with cached-copy →
  `/offline` fallback; `_next/static` + public assets cache-first; POSTs (Server Actions)
  untouched. Registered production-only. `/offline` is a logged-out fallback page.
- **InstallButton** renders in the header only while `beforeinstallprompt` is live
  (iOS Safari never fires it; Share → Add to Home Screen remains the iOS path).
- **Manifest shortcuts:** Android long-press offers "Add expense" (`/?new=1`, consumed by
  QuickAddProvider on mount to open the sheet) and "Ledger".

### Offline Quick Add

- Submitting with no network now queues the entry in IndexedDB
  (`src/lib/offline-queue.ts`) instead of failing; the ledger shows the row optimistically
  and the multi-entry flow continues unchanged. A sync manager
  (`offline-sync.tsx`) replays queued payloads through the same `createTransaction` action
  on mount / `online` / focus, with a header pill showing the waiting count.
- **Schema-adjacent behavior change (§6.2):** `createTransaction` now prefers the payload's
  `memberId` (when it names a real member) over the `active_member_id` cookie — an offline
  replay may run days later under a different active member, and the entry must land under
  who captured it. Online flow is unchanged (the sheet already sends the active member).
- Settings gains an **Offline entries** card: inspect queued entries, Sync now, Discard;
  the "needs attention" toast links to it.

### Dashboard insights

- **Budget pacing** (running month only): "₹X/day left · N days" plus an over/under-pace
  verdict vs the straight-line ideal; quiet within ₹50. Computed server-side in IST and
  passed as numbers (no hydration drift). The total-budget bar's overflow segment pulses
  once over budget.
- **Per-category month-over-month deltas** in the pie legend: ▲/▼% vs last month, "new"
  for first-time categories, hidden when nothing to compare. One extra cached SQL
  aggregate (previous month grouped by category, left join keeps uncategorized comparable).

### Ledger

- **Search race fix:** fast typing was clobbered by the in-flight debounced navigation
  landing with an older `?q=` (the URL-sync effect reset the field mid-typing — the
  "type it twice" bug). The sync now ignores URL values matching the last query this
  component pushed; only external URL changes (deep links, Clear all) rewrite the field.
- **Note-search index:** `?q=` runs `ILIKE '%term%'`; migration `0006_note_search_trgm`
  adds `pg_trgm` + a GIN index on `note` (idempotent; `db:push` users apply once via
  `npm run db:migrate` or the SQL console). Mirrored in `schema.ts`.

### Transactions

- **Split into parts** (edit dialog): one payment spanning several categories/notes becomes
  2–6 transactions sharing the original's date/time/tag/member; the original is deleted.
  Server-first with optimistic swap on the ledger bus, 5-second Undo (re-creates the
  original, deletes the parts). Exact-sum enforcement with a live "left to assign" meter.

### Recurring auto-entries

- Templates gain `auto_day` (1–28, NULL = manual), `last_auto_key` ("YYYY-MM" idempotency
  marker) and nullable `member_id` (NULL = first member) — migration
  `0007_recurring_auto_templates`. The daily cron (`/api/cron/recurring`, 06:00 IST via
  `vercel.json`, `CRON_SECRET` bearer auth) stamps due templates with today's IST date;
  the marker write makes re-runs no-ops. Settings → Templates exposes both controls.
  Same accepted non-atomic insert/marker window as the budgets path (§6.7).

### Guard rails & polish

- `smoke:prod` now asserts installability: `/manifest.webmanifest` returns 200
  `application/manifest*` JSON with name + icons, `/icon` serves a PNG unauthenticated,
  `/sw.js` is reachable — a middleware regression fails CI loudly instead of silently
  killing the install prompt.
- One-time FAB coach mark ("Tap + to log an expense", per-device, auto-dismissing);
  ledger empty state distinguishes filtered-vs-empty and offers an "Add an expense" CTA;
  Overview and Ledger got layout-matched loading skeletons.
- Verified: `tsc --noEmit`, eslint, production build green; PWA routes exercised on a
  local production server (manifest 200 JSON, icon 200 PNG, `/` still 307).

---

## v1.3 Amendment — 24 August 2026 (owner decision: capture-first workflow, bulk categorization, Review merged into Ledger)

### Amendment 20 — Optional categories: capture fast, categorize later; multi-select bulk actions; Review joins the Ledger (§4.2, §5.3, §6.2, §6.3, §6.4, §6.5, §6.6)

- **Decision:** the owner asked for a two-phase workflow — Quick Add stops asking for a
  category so entries take seconds, and categories get assigned afterwards per-row (edit
  dialog) or across many rows at once (multi-select). The Review tab merges into the
  Ledger page as a pinned queue.
- **Schema (§4.2):** `transactions.category_id` is now **nullable** (`DROP NOT NULL`,
  migration `drizzle/0005_gorgeous_speed.sql`). NULL is *uncategorized* — a transaction
  state, never a category row; no placeholder category exists anywhere. Apply with
  `npm run db:push`. All category joins in list/export/review/dashboard queries are now
  `LEFT JOIN`s.
- **§6.2 Quick Add:** the category grid, note-based suggestion UI, inline rename/create,
  budget hints and "Show all" link are removed from `quick-add-sheet.tsx`; the sticky CTA
  reads "Add ₹1,250" (no category suffix) and enables on amount alone. Templates still
  stamp their own category silently at commit. Tag + last-entry memory unchanged.
- **Edit dialog:** the category field is optional — uncategorized rows start unselected,
  a dashed **None** tile clears an existing category, and Save works without one.
- **Bulk actions (Ledger):** long-press a row (or tap the new **Select** control) to
  enter selection mode — checkboxes, count, and a sticky bottom bar with **Assign**
  and **Delete**. Assign opens `category-picker-sheet.tsx`: the shared `CategoryGrid`
  ordered by rank-weighted matches against the selected rows' notes ("smart grouping"),
  with **None** included. One batched Server Action each:
  `assignCategory(ids, categoryId | null)` (single `UPDATE … IN`) and
  `deleteTransactions(ids)`; both cap at 500 ids and revalidate normally. Bulk assign
  and bulk delete carry the §6.4.1 five-second Undo toast; undoing an assign restores
  each row's *previous* category (grouped server calls).
- **Uncategorized visibility:** the ledger filter gains an **❔ Uncategorized** option
  (`?category=uncategorized`); the summary card shows an amber "N uncategorized · ₹X —
  review →" deep link when the filtered set contains any; the dashboard pie renders an
  explicit gray Uncategorized slice while the **Top category** card ignores it;
  largest-spend handles uncategorized rows.
- **Review queue (§6.4) merged into the Ledger page:** `/review` redirects to
  `/transactions`, its nav slot is gone (the pending-count badge now rides the Ledger
  item), and a collapsible **Review** card sits between the summary and filters —
  full ledger rows inside: tap to edit/categorize (the dialog's save re-evaluates
  queue membership), swipe to delete, long-press to multi-select, plus the per-item
  **Done** acknowledgement. Collapse state persists per device.
- **`review-where.ts` fix:** the redundant-note clause became a self-contained `EXISTS`
  subquery — the badge count (`FROM transactions` alone) previously referenced
  `categories.name` without a join, which Postgres rejects; it also keeps working now
  that `category_id` can be NULL.
- **CSV export (§6.6):** uncategorized rows write an empty `category` cell; format and
  column order unchanged.
- Verified: `tsc --noEmit` and `eslint` pass clean.

### Amendment 20 follow-up pass — 24 August 2026

- **Live verification:** `smoke:prod` passes against the seeded baseline (1,157 entries,
  ₹23,96,855.39). Two script-side fixes were needed: `smoke-prod.mjs` still parsed the
  pre-expense-only **8-column** CSV layout (stale since the 17 Aug amendment; now 7
  columns, amount at index 4), and both live scripts defaulted to the retired
  **kharchubook.vercel.app** domain (now tokenscript.vercel.app). `verify:export-live`
  passes structurally (row count, header, formats); it reports exactly one data-vs-seed
  divergence — row 1055's note was edited in-app ("Airtel recharge" → "Mobile
  Recharge"), i.e. genuine usage drift, not a code regression.
- **drizzle/meta snapshots tracked:** `.gitignore` no longer excludes `drizzle/meta/`.
  The missing per-migration snapshots are why migration 0005 bundled unrelated drift;
  future generates diff against the true latest snapshot.
- **Dead code sweep:** orphaned `updateReviewNote` action removed (its only caller died
  with review-client.tsx; note edits flow through the edit dialog's updateTransaction);
  vestigial `categories` prop chain removed from QuickAddSheet/QuickAddProvider/layout
  (layout no longer fetches categories solely to pass them down).
- **UX polish from the owner follow-up list:** uncategorized count badge on the Ledger
  nav item (amber, via new `getUncategorizedCount` + `useUncategorizedCount`, shown when
  no review items pend); "All/Clear" select-all for loaded rows in the bulk bar; Esc
  exits selection mode on desktop; "Acknowledge all" batch button on the Review queue
  backed by a new `acknowledgeTransactionsReview(ids)` action (no undo toast —
  acknowledgement is reversible by design, §6.4).
- **Tests:** new DB-backed `test:categorize-roundtrip` (NULL insert, IS NULL filter,
  LEFT-JOIN null shape, batched IN assign/clear, missing-FROM regression on
  pendingReviewWhere, empty CSV cell); validation-test covers the optional-category
  schema branch. All suites green against the live database.

### Layout pass — 24 August 2026 (owner decision: six UI layout improvements)

- **Ledger chrome collapsed to one slim card:** the spent-vs-budget bar moved inside
  `LedgerSummaryHeader` (below the totals + uncategorized warning), eliminating a whole
  stacked block; first transaction row now reaches the opening viewport on mobile.
- **Filter bar:** member chips, tag chips and the category select share ONE scrollable
  row (the "All members"/"All tags" reset pills are gone — tapping an active chip
  toggles it off); active filters render as dismissible chips in a second row that only
  appears while something is set, carrying the category rename pencil and "Clear all".
- **Review queue:** its collapsed state is now a thin amber-tinted banner (notification,
  not section); expanded state unchanged.
- **Day-group totals:** ledger date headers show the group's summed spend right-aligned
  ("Yesterday …… ₹1,240"), computed over exactly the rows in the group.
- **Dashboard:** the orphaned 2×3 summary grid became a full-width **Expense hero**
  (largest spend folded in as a drill-down subline) plus a compact 3-up row
  (Top category · Bills · Lifestyle); card order is now money-state-first — Budget →
  Tag breakdown → Spending by category → Trend → Who spent.
- **Desktop (≥lg):** the edit-transaction dialog and bulk category picker dock as
  RIGHT-side sheets (`useMediaQuery` hook), keeping the ledger visible beside them;
  mobile keeps bottom sheets. Quick Add intentionally unchanged.

### UX pass — 24 August 2026 (owner decision: ten refinements)

- **Toasts clear the bottom nav:** global Sonner `offset` lifts every toast above the
  Dashboard/+ /Ledger bar and the iOS home indicator. Later switched to
  `position="top-center"` (owner request: toasts must sit on top of the Add-transaction
  sheet) with `expand` + `visibleToasts={4}` so simultaneous toasts stack fully visible,
  one above another, instead of Sonner's default collapsed pile.
- **Quick Add:** uncategorized saves offer a **"Categorize"** action on the success
  toast (jumps to `category=uncategorized`); recent distinct notes render as one-tap
  chips while the Note field is empty (`quick-add:recent-notes`, max 5, per device).
- **Filtered CSV export:** `exportCsv(filters)` builds its WHERE with the same
  `buildWhere()` as the list; the Ledger button passes the active filter set and the
  filename reflects scope (`ledger-june-all-2026-08-24.csv`). No args = all-time.
- **Custom date range:** `from`/`to` URL params (validated calendar dates) thread
  through `TransactionListFilters`/`buildWhere`/summary; a Dates chip opens an inline
  From–To panel, and the range appears as a dismissible active chip.
- **Insights:** the dashboard Expense hero shows a month-over-month percentage vs the
  previous month (from the existing trend series, red up / green down); the ledger
  budget strip adds mid-month pacing for the current month ("≈ ₹X/day safe · N days
  left", or over-budget in red).
- **PWA:** web manifest + ImageResponse-generated `/icon` and `/apple-icon` PNGs +
  `appleWebApp` metadata — installable to the phone home screen without binary assets.
- **Polish:** the + FAB hides (scale-out) whenever a bulk-selection bar is open, via a
  new `ledger:selection` window event emitted by both selection surfaces; the
  dashboard's embedded TransactionsList opts out of bulk tooling entirely
  (`enableSelection={false}`). Month-strip auto-centering of the selected month was
  verified to already exist.

### Multi-entry Quick Add — 24 August 2026 (owner decision: A1 from the UX list)

- **Decision:** the highest-impact remaining capture friction — logging a grocery run
  of five items cost five full open→save→reopen cycles. After a successful save the
  sheet now STAYS OPEN.
- **`quick-add-sheet.tsx`:** on commit the form resets exactly as before (tag/note
  last-entry memory, template stamp cleared, date/time back to IST defaults) but the
  sheet remains mounted and a confirmation banner takes over the footer:
  **"✓ Added ₹50 · 3 this trip"** with **Done** (outline) and **Add another**
  (primary, refocuses the amount field). The header pill flips to **Done** in this
  state, and simply typing a new amount dismisses the banner and resumes the form —
  Enter-to-add keeps working without tapping anything first. Swipe-down/backdrop
  close always discards the banner state safely.
- Verified: `tsc --noEmit` and `eslint` pass clean.

---

## v1.2 Amendment — 19 August 2026 (owner decision: edit sheet parity with Quick Add)

### Amendment 12 — Edit sheet matches Quick Add's shell; header CTA styled as a button (§6.2, §6.4)

- **Decision:** the Add-transaction UI pass continues with the edit-transaction surface —
  make editing an existing row feel like the same page as adding one, and make the Quick
  Add header control visibly read as a button rather than underlined text.
- **`quick-add-sheet.tsx`:** the header **"Add transaction"** control (made clickable in
  Amendment 11) is now a filled, `rounded-full` `Button` (`size="sm"`) instead of
  underlined text, so it visibly reads as a button rather than a link.
- **`transaction-edit-dialog.tsx` — rewritten from a centered `Dialog` into a bottom
  `Sheet`** with the same shell as Quick Add: a grip handle, a header row with a
  clickable **"Edit transaction"** pill button (saves — same path as the sticky footer
  CTA) plus a **member dropdown chip**, the same field order as Quick Add (Date/Time →
  Amount+Tag row → Note → Category, §6.2) inside a scrollable body, and a sticky footer
  with a dynamic **"Save ₹1,250 · Dining Out"** CTA matching Quick Add's label logic
  (§6.2 Amendment 10). The member chip **reassigns this transaction's member** — a
  local, validated form field — rather than the app-wide `active_member_id` cookie that
  Quick Add's chip switches (§3.2.1); this distinction is unchanged from
  `SPEC_AMENDMENT_7_MEMBER_REASSIGNMENT.md`, only its location moved. **Delete** moves
  to a small icon button beside the sticky Save button; the standalone "Member" select
  row from the 18 Aug layout is gone now that member selection lives in the header.
- **§6.4 (Transactions List View):** the "tap to edit" interaction now opens this bottom
  sheet rather than a centered modal — recorded as a normative supersession.
- Verified: `tsc --noEmit` and `eslint` pass clean on both touched files.
- **Supersedes:** the centered `Dialog` presentation of the edit-transaction form used
  since Amendment 7 (18 Aug 2026), and the plain underlined-text rendering of the Quick
  Add header CTA introduced in Amendment 11.

---

## v1.2 Amendment — 19 August 2026 (owner decision: fix header link and cross-device Date/Time mismatch)

### Amendment 11 — Header CTA wired to submit; Date/Time collapse no longer persists (§6.2)

- **Decision:** two defects surfaced after Amendment 10 — the new "Add transaction"
  header text didn't actually submit the form, and the collapsed/expanded state of the
  Date/Time row was drifting between devices.
- **`quick-add-sheet.tsx`:** the **"Add transaction" header text is now a real button**
  that calls the same `submit()` as the bottom sticky CTA — same validation, same
  optimistic create. (Amendment 12, immediately after, restyles this button as a filled
  pill; functionally it has submitted since this amendment.)
- **Date/Time collapse no longer persists (Quick Add + edit dialog):** the
  collapsed/expanded choice was being remembered per device in `localStorage`
  (`quick-add:date-time-expanded`, introduced in Amendment 10), so a browser where it
  was toggled open once — e.g. a phone used for earlier testing — kept opening
  pre-expanded while other devices/browsers stayed collapsed. **It now always starts
  collapsed with today's date and the current time on every open, on every device**,
  and only stays expanded for the rest of that tab's session if the user taps it open.
  `src/lib/date-time-expanded.ts` (added in Amendment 10) is removed as now-unused.
- Verified: `tsc --noEmit` and `eslint` pass clean on all touched files.
- **Supersedes:** the §6.2 Amendment 10 wording that the Date/Time collapsed/expanded
  choice "persists per device" — it no longer does, by design, effective this
  amendment.

---

## v1.2 Amendment — 19 August 2026 (owner decision: Add-transaction UI restructure)

### Amendment 10 — Amount+Tag row, member-switch chip, dynamic sticky CTA (§6.2)

- **Decision:** restructure the Quick Add / edit-transaction fields for a tighter,
  more scannable single page — merge Amount and Tag into one row, let the sheet's
  member chip actually switch the active member, and make the submit CTA reflect what
  it's about to do.
- **`transaction-fields.tsx` — new `AmountTagRow`:** a single `flex h-14` row — the
  Amount input (`flex-1`, ₹ prefix rendered inside the field, sanitized on every
  keystroke via `sanitizeAmountInput` so the value always fits `NUMERIC(12,2)`: digits
  and at most one decimal separator, at most 2 decimal digits, at most 10 integer
  digits) beside a **Tag cluster** — a 2×2 grid where the selected tag fills a big
  display-only button in column 1 (row-span-2) and the other two tags sit stacked as
  small tap-to-swap buttons in column 2; tapping an alternative swaps it into the big
  slot. A live `≈ ₹` preview, or "Enter a valid amount" once a submit was attempted
  with none, renders under the row. `DateTimeField`'s collapsed summary now shows
  Today/Yesterday/the full date (`d MMM yyyy`) instead of always the raw date. The
  `CategoryGrid` hint row and budget-hint pills switch to a "·" separator.
- **`quick-add-sheet.tsx`:** `AmountField` + `TagSelector` are replaced by the shared
  `AmountTagRow`; **Note becomes a single-line, 140-character `Input`** (previously
  multi-line); the **member chip becomes a real dropdown** that switches the app-wide
  `active_member_id` via the existing `updateActiveMember` Server Action — applied
  optimistically, reverted on failure; the **sticky CTA label goes dynamic** — "Add
  ₹1,250 · Dining Out" (`formatINRWhole` — whole rupees, no decimals) once valid,
  "Add transaction" plus a small missing-field helper line when not.
- **`transaction-edit-dialog.tsx`:** field order now matches Quick Add (Member →
  collapsible Date/Time → `AmountTagRow` → Note → Category); the Date/Time collapse
  state is shared with Quick Add via a new `date-time-expanded.ts` persistence helper
  (removed the next day — Amendment 11); Save is disabled until the form is valid.
- **`money.ts`:** new `formatINRWhole()` for the no-decimals CTA amount.
- Verified: `tsc --noEmit` and `eslint` pass clean on all touched files.
- **Supersedes:** the stacked `AmountField` + `TagSelector` layout and the
  non-interactive member badge from Amendment 7/8 (18 Aug 2026); the single-line Note
  supersedes the multi-line Note field and its `Cmd/Ctrl+Enter` submit carve-out from
  Amendment 7.

---

## v1.2 Amendment — 18 August 2026 (owner decision: category UI refinement)

### Amendment 9 — Name-only category chips and "Show all" expansion (§6.2)

- **Decision:** the owner asked to remove emoji icons from category displays and add a
  way to expand note-based suggestions to the full category list.
- **§6.2 Quick Add category grid:** categories now render as **compact pill/chip buttons**
  with just the name (no emoji icon). The grid layout changed from a fixed 3-column
  grid to a flexible wrap layout. Selected state uses a filled primary background
  instead of a ring. The `＋ Add category` tile is also simplified to a small pill.
- **§6.2 "Show all categories" button:** when note-based suggestions are active and
  there are more categories than shown, a **"Show all categories"** link appears next to
  the hint text. Clicking it expands the grid to show all categories. The link resets
  automatically when the note changes, so fresh input shows suggestions again.
- **Edit dialog consistency:** the emoji icon is removed from the edit-transaction
  dialog title (now just "Edit transaction" without the category emoji).
- **Settings categories-manager:** the "Recently created" strip chips and category rows
  no longer display or require emoji input — category rows now have only the name input
  field with reorder/save buttons.
- **Supersedes:** the §6.2 category grid emoji-tile rendering and the "＋ Add category"
  tile layout from Amendment 8.

---

## v1.2 Amendment — 18 August 2026 (owner decision: single-page Quick Add)

### Amendment 7 — Quick Add is a single page (§6.2)

- **Decision:** the owner asked to reduce the Quick Add flow to **one page** ("can we
  reduce it to 1 page"). The three-step sequence **Amount → Details → Category** is
  collapsed into a single scrollable bottom sheet: amount text input, tag chips,
  date/time, note, category grid (tap to **select**), and a single **Add transaction**
  button pinned at the bottom. The category tap no longer commits; the button does.
- **§6.2** rewritten to the single-page flow; the 15 Aug 2026 normative-sequence
  blockquote is annotated as superseded in place (audit trail preserved). The header
  summary blockquote gains an 18 Aug 2026 entry, and the §6.7 Quick Add hints wording
  drops the now-stale "committing step" phrasing.
- **Removed with the multi-step flow:** the **full-screen numpad** (replaced by a plain
  amount text input — owner choice) and the 16 Aug 2026 one-tap **"It's a bill"**
  shortcut, whose purpose was to skip the Details step that no longer exists — the tag
  chips are visible on the same page.
- **Retained:** the optimistic create (tempId → confirm/revert), per-category
  remaining-budget hints (§6.7, fetched against the chosen date's month), inline
  category rename, and default date/time in `Asia/Kolkata` (§5.7). The Server Action,
  schema, and `createTransaction` contract are unchanged.
- **Edit dialog aligned + Enter-to-submit (same day):** the edit-transaction dialog
  now shares the Quick Add form treatment — a large amount input with a live `≈ ₹`
  preview, check-mark tag chips, a tap-to-select category grid with the same §6.7
  remaining-budget hints (debounced `getCategoryBudgetStatus`), and a real `<form>`
  in both sheets so **Enter** submits from any field (`Cmd/Ctrl+Enter` in the note).
  Member remains a dropdown in edit, since editing may reassign the member (§6.4).
- **Field order (same day, owner request):** the Quick Add sheet's **Date/Time**
  inputs moved from the middle to the very top — their defaults are rarely changed,
  so the frequently edited fields stay together below them in the order
  **Amount → Tag → Note → Category**. A small "press Enter to add/save" hint under
  each form's action button makes the Enter-to-submit shortcut discoverable.
- **Collapsible Date/Time + edit-dialog reorder (same day):** the Quick Add sheet's
  Date/Time row now collapses behind a compact summary („Today · 14:32“ with a
  pencil); tapping it reveals the pickers and a Done button collapses it again
  (collapsed on close). The edit-transaction dialog mirrors the Date/Time-first
  order, and both rows are rendered by the shared `DateTimeField` in
  `transaction-fields.tsx`.
- **Last-entry memory (same day):** the Quick Add sheet remembers the last committed
  **tag and note** in `localStorage` (`quick-add:last-entry`) and pre-fills them on
  the next open, so repeat entries (recharges, EMIs, rent) start already filled in.
  Hydrated after mount so server-rendered defaults stay consistent; updated only on
  a successful commit; amount, category, date and time are never remembered.
- **Recently used categories float to the top (same day):** the Quick Add grid
  records a per-category "last used" timestamp in `localStorage`
  (`quick-add:category-usage`) on each successful commit and re-orders the grid by
  recency, so the categories the family actually spends in are visible without
  scrolling. Never-used categories keep the manual `sortOrder` from Settings as the
  stable fallback (new `useCategoryUsage` hook in `src/lib/category-usage.ts`,
  hydrated after mount). The edit-transaction dialog's category grid orders the
  same way and records usage on each successful edit save, so "last used" reflects
  every entry path.
- **Date/Time collapsed choice persists (same day):** expanding the collapsed
  Date/Time summary (or collapsing it again) is remembered per device
  (`quick-add:date-time-expanded`), so the choice survives later visits.
- **Shared field components (same day):** the amount field, tag chips, and category
  grid are extracted into `src/components/transactions/transaction-fields.tsx`
  (`AmountField` / `TagSelector` / `CategoryGrid`), used by both the Quick Add sheet
  and the edit dialog so the two forms cannot drift apart; the inline category-rename
  mode remains Quick Add-only, behind optional `CategoryGrid` callbacks.
- **Supersedes:** Amendment 2's normative **Amount → Details → Category** sequence
  (category tap = commit) and the §6.2 one-tap bill shortcut wording from the 16 Aug
  2026 amendment.

## v1.2 Amendment — 18 August 2026 (owner decision: suggested + creatable categories)

### Amendment 8 — Note-based category suggestions and inline category creation (§6.2, §5.3, §6.5)

- **Decision:** the owner asked for Quick Add to show **suggested categories** based on
  the note ("what was it for?") instead of the full grid, plus an **option to add a new
  category** inline.
- **§6.2 step 6:** typing a note now narrows the grid to up to 6 suggestions scored
  from the note's words — a curated keyword map per seed category slug (`src/lib/
  category-suggestions.ts`) plus category-name word matching; the already-selected
  category stays pinned; clearing the note or a no-match note falls back to the full
  grid. A dashed **＋ Add category** tile at the end of the grid opens an inline
  emoji + name form (Enter saves, Escape cancels — never submits the transaction).
- **§6.5 / §5.3:** category **creation** is now permitted — previously "rename, emoji,
  reorder only". The new `createCategory` Server Action slugifies the name (deduped
  with a `-2`/`-3` suffix), picks a color deterministically from a palette, appends
  the category at the end of the order, and returns the row so the sheet can select
  it immediately; the slug stays immutable and unexposed, deletion remains out of
  scope, and re-seeding stays idempotent (`onConflictDoNothing` on the 19 literal
  slugs). Suggested categories work for user-created categories too (name-word
  matching); they just have no curated keywords.
- **Same-day additions:** the edit-transaction dialog offers the same **＋ Add
  category** tile via the shared `useCreateCategory` hook (`src/lib/
  use-create-category.ts`, which also owns the Quick Add flow), and Settings'
  category list **live-syncs** when the server-side category set changes (an
  id-set guard preserves in-progress name/emoji edits), so a category created
  inline from Quick Add appears there immediately without a remount.
- **Settings „Recently created“ strip + budget sync (same day):** categories
  created inline are recorded per-device (`quick-add:recent-categories`,
  `src/lib/category-recents.ts`) and shown as NEW-badged chips in a small
  **„Recently created“** strip at the top of the Settings category list — a
  convenience hint; the authoritative list always comes from the server. The
  Budgets card's per-category list renders directly from the current category
  set (it needs no re-fetch beyond the existing `revalidateTag("categories")` +
  refresh), and its per-category input state now id-set-syncs so a new category
  gets a clean input row without a remount.
- **Supersedes:** the §6.5 "rename, emoji, reorder only" wording (annotated in place)
  and any earlier reading of §5.3 that fixed the category set at exactly 19 rows.

---

## v1.2 Amendment — 15 August 2026 (owner decisions)

The Phase-0 v1.2 compliance audit (15 Aug 2026) returned **PHASE 0 — NOT CLEARED** with
three owner-level decisions required. The user has now made all three; this entry records
them as **specification amendments**. **No application code, schema, migration, or
`seed.csv` was changed** — the repository's implementation was already the user's intended
state; this entry reconciles the frozen spec with it.

### Amendment 1 — Dark mode permitted (§6.1, §11)

- **Decision:** keep the existing dark-mode implementation. It is an explicit v1.2 feature
  (user-requested during development), not a scope violation.
- **§6.1** theme wording updated: light remains the default; dark mode is supported via a
  header sun/moon toggle; the first visit defaults to the user's **system preference**;
  the choice persists locally. Implementation is class-based `next-themes` with a `.dark`
  variable block in `globals.css`. No theme-system redesign is authorized.
- **§11** exclusion list: the *"Dark mode"* bullet is **removed** and annotated in place.
- **Supersedes:** the v1.2 "Unchanged" clause listing dark mode as out of scope, and the
  Phase-0 findings F-01 / §6.1-R3 / §11-R1 (all FAIL).

### Amendment 2 — Quick Add sequence Amount → Details → Category (§6.2)

- **Decision:** keep the implemented sequence **Amount → Details → Category** — category
  selection is the final, tap-to-commit step. This is the authoritative v1.2 sequence;
  the earlier "Amount → Category → Details" wording is superseded.
- **§6.2** steps renumbered (1 Trigger, 2 Amount, 3 Details, 4 Category, 5 Submit) with an
  explicit note that the category tap is the committing action; surrounding wording kept
  internally consistent.
- **Supersedes:** the v1.2 "Unchanged" clause stating the Quick Add flow is unchanged, and
  the Phase-0 finding F-02 / §6.2-R1 (FAIL).

### Amendment 3 — Family password is environment-managed (§6.5, §9)

- **Decision:** no credentials table, password database, password-management subsystem, or
  deployment-control architecture. `FAMILY_MASTER_PASSWORD` remains the single,
  environment-managed secret used for authentication (§3.1, §9).
- **§6.5** no longer requires "Change family password". The application provides **no
  in-app password-change facility in v1.2**; changing the password is an
  **environment/deployment administration operation** (update the env var on the
  deployment platform and redeploy).
- **Resolves SPEC-CONFLICT-1** (§6.5 password change vs §9 env-only secrets): the clauses
  no longer conflict because §6.5 no longer mandates an in-app change facility.
- **Supersedes:** the Phase-0 finding F-03 / §6.5-R3 (MISSING) — the requirement is
  **removed** by owner decision, not deferred.

### Effect on the Phase-0 finding counts

- **Pre-amendment corrected counts:** FAIL **3** (the executive summary mis-stated FAIL 0;
  the requirement matrix actually carried three FAIL rows — §6.1-R3, §6.2-R1, §11-R1),
  MISSING 1, SPEC-CONFLICT 1, scope violations 1, PARTIAL 4, UNVERIFIED 6.
- **Post-amendment:** FAIL **0** · MISSING **0** · SPEC-CONFLICT **0** · scope violations
  **0**. PARTIAL (4) and UNVERIFIED (6) are unchanged — the P2/P3 findings remain open per
  the owner's instruction ("do not fix the P2/P3 findings yet").

---

## v1.2 Amendment — 16 August 2026 (owner decisions: budgets; ledger reconciliation)

### Amendment 4 — Monthly budgets (total + per-category) added (§4.2, §6.5, §6.7, §11)

- **Decision:** the owner explicitly requested a **Budget feature** on 16 Aug 2026 — monthly
  spending limits, both **per-month** and **per-category**, with a "remaining vs budget"
  view on the Overview. This entry records the specification amendment; implementation
  accompanied the decision (schema migration `0001`, Settings card, dashboard Budget card).
- **§11** exclusion list: the *"Budget limits + over-budget alerts"* bullet is **removed**
  and annotated in place. All other §11 exclusions stand.
- **New §4.2 table `budgets`:** one row per **(month, category)** scope — `month`
  (`'yyyy-MM'`, or `NULL` = every-month default), `categoryId` (`NULL` = total budget,
  else a per-category limit), `amount` (`NUMERIC(12,2)` per §5.8), enforced unique by
  `budgets_scope_unique` (a COALESCE index so NULLs don't defeat uniqueness).
- **New §6.7 Budgets:** effective-budget resolution (exact month wins, else the default);
  the Settings Budgets card (one scope at a time, total + per-category inputs, empty = no
  limit, save replaces the scope by delete-then-insert as plain statements); the dashboard Budget card (spent vs
  budget bar, "₹X left / ₹X over", "Set one in Settings" empty state, §6.3.1
  zero-denominator safety, a deep green→deep red gradient fill whose band shrinks to fit
  a deep-red overflow segment when over budget, and a tick marking the 100% budget point);
  per-category budget bars inside the **Spending by category**
  card; an **over-budget toast** on create/edit when the post-write month or category total
  exceeds the effective budget (client-side, in-app only — no email/telegram alerts); an
  **inline edit/clear shortcut** on the dashboard Budget card (`setTotalBudget` — total row
  for the exact month only); a **spent-vs-budget bar** under the ledger's month strip when a
  month is selected (`getMonthBudgetStatus` — month total vs effective total budget,
  month-scoped, hidden when no total budget is set); **remaining-per-category hints** on the Quick Add category grid
  (`getCategoryBudgetStatus`, resolved against the chosen date's month); and the
  `saveBudgets` Server Action (Zod-validated, delete-then-insert as plain statements — the
  neon-http driver has no transaction support, so the scope is replaced by delete-then-insert
  via `replaceBudgetScope`/`replaceTotalBudgetRow` in `src/db/budget-mutations.ts`,
  `revalidatePath('/')` + `revalidateTag('transactions')`).
- **§6.5 Settings** gains the Budgets card bullet.
- **§6.7 exclude-bills toggle (owner decision):** a **global** "Exclude bills from budgets"
  switch in the Settings Budgets card (stored in a new `app_settings` key-value table,
  migration `0002`, key `exclude_bills_from_budget` as `'1'`/`'0'`). When on, **total**
  budget comparisons — dashboard Budget card, ledger month strip, over-budget toast —
  subtract the month's recurring-tagged spend and show an "excluding ₹X in bills" note.
  **Per-category budgets are unaffected** (owner decision): the exclusion applies to the
  total budget only. The recurring tag (§5.2) and the tag-breakdown "Bills" row already
  identified bills; this toggle decides whether they count against the total limit.
- **§6.2 one-tap bill shortcut:** the Quick Add amount step gains an **"It's a bill"**
  toggle that pre-selects the `recurring` tag in one tap (recharges, EMIs, rent — no trip
  through Details); the Details tag selector can still change it.
- **§6.3 Bills summary card:** the Overview summary strip gains a **Bills** card — the
  month's `recurring`-tagged total in purple with its entry count, linking to the Ledger
  filtered to `tag=recurring`. The same correction updates §6.3's stale "Total Income ·
  Total Expense · Net Savings" summary-card wording to the implemented expense-focused
  set (Expense · Top category · Lifestyle spend · Bills · Largest spend, all drilling into
  the filtered Ledger).
- **Supersedes:** the v1 §11 exclusion of budget limits/over-budget alerts. Scope note:
  budgets are fully in scope, and a client-side, in-app over-budget **toast** on expense
  create/edit is included; over-budget alerts as a *notification* feature (email/telegram
  digest) remain out of scope.

### Amendment 5 — Ledger page reconciliation (§6.3, §6.4, §6.7)

- **Decision:** on 16 Aug 2026 the owner asked that the specification be brought in line
  with the implemented ledger/dashboard features ("include all the features i asked you
  to include"). This entry records the resulting spec reconciliation; the features were
  already implemented and committed.
- **§6.4 Transactions List View** now documents the **month strip** (last 36 months in
  IST + "All", URL-driven `?month=yyyy-MM`, preserves other filters), the
  **expense-focused summary header** (Expense · Lifestyle spend · Largest spend + entry
  count over exactly the filtered set, computed by one SQL pass sharing the list's
  `WHERE`), and the **`type=income|expense` URL filter** alongside member/category/tag/
  month/search.
- **§6.7** cross-reference corrected: the spent-vs-budget bar under the month strip is
  now referenced as "Ledger month strip (§6.4)" — it previously pointed at §7.3
  (pagination).
- **§6.3** reconciled: the "Income vs Expense: Net savings visualization" bullet now
  states that the standalone income/net cards were **removed** (16 Aug expense-focused
  iteration) and income vs expense is visible as the gap between the 6-month trend's
  expense and income lines; §6.3.1's Total Income / Net Savings rows are annotated
  accordingly and retained for the record.
- **Supersedes:** nothing frozen — this entry documents implemented behaviour, it does
  not remove any exclusion. The v1 §11 exclusion list stands apart from the budget
  bullet already amended.

---

## v1.2 Amendment — 16 August 2026 (owner decision: Phase-2 remediation)

### Amendment 6 — Phase-2 audit remediation (correctness, tests, CI, spec erratum)

- **Decision:** on 16 Aug 2026 the owner asked that the issues found in the Phase-2
  compliance re-audit be fixed. All owner-authorized, spec-affecting corrections are
  recorded here; code/test/CI changes accompanied the decision.
- **F2-07 (correctness):** `updateTransaction()` now rejects a **valid UUID that matches
  no transaction** — the UPDATE affects zero rows, so the action returns
  `{ ok: false, error: "Transaction not found" }` instead of reporting success. (§7.1
  applies to nonexistent ids, not only malformed ones.)
- **F2-08 (P3 cleanup):** the stale `changePasswordSchema` was removed from
  `validations.ts` — Amendment 3 removed the in-app password-change facility, so the
  schema was dead residue.
- **F2-01 (spec erratum):** §4's table-count line corrected — the schema implements
  **5 tables** (3 core + `budgets` + `app_settings`), not "6 tables / 4 core" as the
  previous wording claimed. Owner-authorized correction of the frozen-spec wording.
- **F2-02 (documented reliability characteristic):** §6.7 now states explicitly that
  budget-scope replacement is **intentionally non-atomic** under the neon-http driver
  (delete-then-insert; a failed insert leaves the scope empty, never half-written;
  duplicates are impossible by index). Accepted, not redesigned — no architectural
  change.
- **F2-04 / F2-06 (tests):** new `test:budget-semantics` (`src/db/budget-semantics-test.ts`)
  drives the production helpers against a real DB — exclude-bills OFF/ON total math,
  category budgets never excluding bills, exact-month-over-default precedence and its
  fallback, total-alert-over-category precedence, and the "It's a bill" chain
  (schema → recurring row → over-budget classification → dashboard Bills aggregate).
- **F2-05 (tests):** new `test:ledger-url` (`src/lib/ledger-url-test.ts`) covers the
  normative §6.4 URL-filter composition — changing one filter preserves the rest,
  clearing the month preserves the rest, clearing all yields `/transactions`, invalid
  values are dropped, and parse ∘ build round-trips. The pure `buildLedgerUrl` /
  `parseLedgerSearchParams` logic was extracted to `src/lib/ledger-url.ts` (shared by
  the filter bar, month strip and server page) to make it testable; the budgets
  helpers (`getMonthBudgetStatus`, `getBudgetAlert`, `budgetsForMonth`) were made
  db-first-argument to allow the same real-connection testing.
- **F2-03 (CI):** the DB job now runs `test:budget-roundtrip` and
  `test:budget-semantics` when a `DATABASE_URL` secret is present; the DB-free
  `test:csv-quoting` and `test:ledger-url` run unconditionally in the checks job.
- **F2-10 (owner action, not a repo change):** the CI database job is gated on a
  `DATABASE_URL` secret (a disposable Neon branch) that only the owner can configure in
  GitHub settings — the workflow is ready; the secret is not.
- **Supersedes:** nothing frozen. The §4 wording corrected above is the only
  frozen-document change, and it is owner-authorized as an erratum correction.

---

## v1.2 — 12 August 2026

Corrects a factual error introduced by the v1.1 audit, then hardens the specification with
**fifteen** architectural decisions approved by the user on 12 Aug 2026. Amendments 13 and
14 were raised by the v1.2 audit's own "remaining ambiguity" findings and approved in a
second review pass; amendment 15 is a security/environment clarification added in a third
pass. All are integrated into this same v1.2 entry.

**`seed.csv` was not changed.** It was audited read-only and found clean. Every discrepancy
resolved in this entry lay in `SPEC.md`, never in the data. The file remains the source of
truth established by v1.1, and remains immutable.

### Corrected — transaction count 1,156 → 1,157

**The v1.1 entry below is wrong where it calls 1,156 "the actual row count". It was not.
The correct count is 1,157, and it always was.**

Root cause: the v1.1 audit determined the count with `wc -l`, which counts newline
*characters*, not records. `seed.csv` has **no trailing newline**, so its final data row is
unterminated and was never counted:

```
1 header + 1,156 newline-terminated rows + 1 unterminated final row = 1,157 data rows
```

`wc -l` reported 1,157; subtracting one for the header yielded the erroneous 1,156. A record
counter (`awk 'END{print NR}'` → 1,158 lines incl. header) gives the correct figure.

There is a compounding irony worth recording: the v1.1 entry *itself* flagged the missing
trailing newline as a seed-script hazard, without noticing it had already eaten a row from
that same entry's count.

**No row was added to or removed from `seed.csv` after the v1.1 audit.** Proof: the category,
tag and member distributions measured on 12 Aug 2026 are byte-identical to those measured
during the v1.1 audit (categories 205/155/139/99/78/77/66/63/46/43/40/31/22/19/18/18/17/14/7;
tags 864 lifestyle / 170 one_time / 123 recurring; members 904 Dad / 253 Mom) — and each set
sums to 1,157, not 1,156. Only the reported total was ever wrong.

Updated in `SPEC.md`: the header Companion File row and §8. §8 also gains a permanent
counting caveat so the same mistake cannot recur.

### Audited — duplicate rows confirmed intentional (new §8.2)

The full-file audit found exactly **two pairs of byte-identical rows**:

| Lines | Row |
|---|---|
| 157 & 169 | `2024-09-16,21:49,Dad,expense,Mysore car parking,40,Travel & Trips,lifestyle` |
| 541 & 543 | `2025-08-06,19:19,Mom,expense,Fruits,100,Groceries & Household,lifestyle` |

Both are **intentional** and are now protected by spec §8.2 against any future
deduplication. Evidence: neither pair is adjacent — each is separated by other distinct
items inside the same timestamp block, the signature of transcription from one multi-item
WhatsApp message rather than a copy-paste error. The same Mysore block independently
contains `Mysore parking,30` and three `Mysore kanike` rows at ₹800/₹200/₹450. Timestamps
are message-log times, not spend times, so a shared timestamp is not evidence of duplication.

A third near-pair (`2025-05-13 Petrol ₹1,000` at 06:28 and 22:37) differs by time and was
already distinct.

Full audit result: 1,158 lines, 8 fields on every row, no quoting, no CRLF, ASCII only, no
empty or padded fields, sorted ascending with zero out-of-order rows, all amounts positive
and within `NUMERIC(12,2)`, all enum values valid, 19 distinct categories.

### Changed — seed idempotency claim replaced (§8, new §8.1, §8.1.1)

**v1.1 and earlier claimed `onConflictDoNothing()` made seeding "idempotent — safe to
re-run". That claim was false.** `transactions.id` used `defaultRandom()`, so every run
generated fresh UUIDs and nothing ever conflicted; a second run would have inserted a
complete duplicate copy of the history.

Replaced with **content-addressed deterministic identity**:

```
id = uuidv5(SEED_NAMESPACE, rawCsvLine + <U+001F> + "#" + occurrenceIndex)
```

where `rawCsvLine` is the verbatim source line, the separator is an ASCII Unit Separator
(U+001F, impossible in the ASCII-only data), and `occurrenceIndex` counts byte-identical
prior lines — `0` everywhere except the second member of each pair above.

`transactions.id` therefore **drops `defaultRandom()`**; every insert supplies its own UUID
(random v4 from Quick Add, deterministic v5 from the seed script). `onConflictDoNothing()`
now has a real conflict target: the primary key.

**Rejected design, recorded deliberately:** a UUIDv5 over `date+time+item+amount+member` was
proposed and **rejected by the user**. It would have merged the four rows above into two,
silently destroying real transactions whenever the family buys the same thing twice at the
same logged minute. The occurrence ordinal exists precisely to avoid this.

**Scope limitation, documented in §8.1.1 and accepted for v1:** the seed operation is
idempotent **for an unchanged canonical `seed.csv`**. It is **not** a synchronization
mechanism and does not detect edits to, or deletions of, previously seeded rows. If an
existing CSV row is later edited, its content-derived UUID changes, so a subsequent seed run
**inserts the corrected row while leaving the previous database row untouched** — both will
exist. This is acceptable because seeding is an explicit, controlled, developer-initiated
operation, not a pipeline. Per the user's instruction, **no `seed_origin` column, no import
batch table, and no other schema was added to solve this edge case.**

### Added — approved architectural decisions 4–12

- **§5.7 Business Timezone (normative).** `Asia/Kolkata` is the single business timezone, a
  hard-coded `APP_TIMEZONE` constant, never read from the runtime. Bare `new Date()` is
  prohibited for business-date decisions. Governs Quick Add defaults, Today/Yesterday,
  month boundaries, the dashboard month picker, all range queries and the 6-month trend.
  Vercel runs UTC, so an expense logged at 01:30 IST would otherwise be stamped to the
  previous day — and on the 1st, to the previous month. `date`/`time` remain naive IST
  values; `created_at` is UTC and may never derive a business date. Adds `date-fns-tz`.
- **§5.8 Monetary Representation (normative).** `NUMERIC(12,2)` is **kept** — it was never
  the defect. `pg` returns numeric as a *string*; the application converts to **integer
  paise** at the DB boundary, performs all arithmetic in paise, and formats only at the
  render edge. Integer paise is exact here (max 1.2×10⁸ paise vs `MAX_SAFE_INTEGER`
  9.007×10¹⁵), so no decimal library is warranted. SQL aggregates sum the `NUMERIC` column
  natively and convert once on read.
- **§5.3 + §4.2 immutable category identity.** `categories` gains `slug` (immutable, unique,
  never user-editable, absent from Settings); `name` loses its `UNIQUE` and becomes a purely
  mutable display label. All CSV ingestion resolves `category` → `slug` → UUID and **never
  joins on `name`**, so renaming "Dining Out" to "Restaurants & Food" leaves 205 historical
  transactions intact. The 19 slugs are fixed literals in a lookup table, not the output of a
  runtime slugify function that could drift. Category **deletion stays out of scope for v1**.
- **§3.2 + §3.2.1 active member state.** Ambiguous "cookie or Zustand" resolved to **a plain,
  client-readable cookie** `active_member_id` — readable by both RSC and Client Components,
  survives refresh, deterministic SSR, no state library. Explicitly documented as **not a
  security boundary**: authentication is the boundary; the cookie only records who holds the
  device. Server Actions must validate the member exists — for data integrity, never as
  authentication.
- **§5.2 + §4.2 tag invariant.** Enforced at four layers — UI, Zod discriminated union,
  Server Action re-validation, and a database `transactions_tag_invariant` CHECK constraint
  making `expense + NULL tag` and `income + tag` unrepresentable. Also recorded: **tag is
  never inferred from category** — 9 of 19 categories span multiple tags (e.g.
  `Property & Investments` is 17 `one_time` + 1 `recurring`, the Bhima EMI).
- **§7.2 SQL aggregation (normative).** All dashboard analytics computed with `SUM`/`COUNT`/
  `GROUP BY` in SQL; fetching transactions and reducing them in JavaScript is prohibited on
  client *and* server.
- **§7.3 + §4.2 keyset pagination (normative).** Cursor pagination on `date DESC,
  created_at DESC`, page size 50, infinite scroll, backed by a new composite index
  `transactions_list_cursor_idx`. `OFFSET` is prohibited — it degrades with history and can
  skip or repeat rows mid-scroll. `created_at` breaks ties because ~40 rows can share one
  `date` *and* one message-log `time`.
- **§6.4.1 delete with undo.** Swipe-left removes the row optimistically and shows a ~5s
  "Undo" toast; the Server Action fires only when the window lapses, and is flushed on
  navigation so a row can never look deleted while still in the database. Undo therefore
  restores nothing — no write ever happened. **No soft delete**: no `deleted_at`, no
  tombstones, no query filtering. A confirmation dialog was rejected as taxing every
  intentional delete to guard a rare accident, against the speed-first philosophy of §1.
- **§6.6 canonical CSV export.** Same 8 columns in the same order as `seed.csv`; `time` as
  `HH:MM`; amounts plain 2-dp decimals with no `₹` and no `en-IN` grouping; `tag` empty for
  income; UTF-8, LF, RFC 4180 quoting. Deliberately **not** described as re-seedable:
  the formats are structurally compatible, but importing remains an explicit controlled
  operation. Export emits *current* display names, which may since have been renamed — a
  further reason the round trip is not automatic.
- **§6.3.1 zero-state behavior.** With no income rows and no `Son` rows in the seed, these
  are the *default* first experience, not an edge case. Universal rule: a zero denominator
  renders `—` and holds the bar at 0%. Net Savings with zero income shows the negative
  expense total in red, never a percentage. Tag bars are denominated in **total expense**,
  not income. Zero members (incl. `Son`) render an explicit `₹0.00` row rather than being
  omitted. Trend months with no data plot as `0`, not a gap. `NaN%`, `Infinity%` and blank
  cards are defects.
- **§2 stack table** — adds `date-fns-tz` (§5.7) and `uuid` v5 (§8.1); the Currency row now
  names the full storage → paise → display chain (§5.8).
- **§8.3** — seed notes expanded with audited facts: 8 rows carry paise, total historical
  spend ₹23,96,855.39, ~40 rows can share a `date`+`time`, and `seed.csv` is immutable.

### Added — amendment 13: immutable member identity (§3.2.2, §4.2, §6.5, §8)

Members carried **exactly the same identity-vs-display-name defect** that amendment 6 fixed
for categories, and the original v1.2 pass left it open: §6.5 permits editing member names
while the §8 seed logic resolved the CSV's `'Dad'`/`'Mom'` strings **by name**. Renaming
`Dad` → `Appa` would therefore have broken a future seed lookup.

- `members` gains **`slug`** — `text().notNull().unique()`, immutable, assigned once at seed
  time, never editable, **not exposed in Settings**, never altered by a migration.
- `name` becomes a purely mutable display label. `emoji`, `color` and `sortOrder` stay
  editable exactly as before.
- **New §3.2.2** states the principle (*immutable identity ≠ mutable display label*, the same
  rule as §5.3) and fixes the three literal slugs: **`dad` (904 rows), `mom` (253 rows),
  `son` (0 rows — seeded, no history)**.
- **§8 seed step 2** now resolves `member` → `slug` → UUID through that literal map, with an
  explicit **"never join on `members.name`"**. Step 3 already did this for categories.
- **§6.5** now spells out that member name/emoji/colour/order are editable, the slug is not
  exposed, and member **deletion is not offered in v1** (the `transactions.member_id` FK must
  never dangle) — matching the category rule.
- **Guarantee recorded:** renaming `Dad` → `Appa` changes one display string and has zero
  effect on existing transactions (which hold the UUID) or on future seed identity (which
  resolves through `slug`). The `member` column of `seed.csv` never changes, so the
  CSV-string → slug map remains valid permanently.

### Changed — amendment 14: strictly unique keyset pagination (§7.3, §4.2, §5.7, §6.4, §8.3)

The v1.2 pagination cursor `(date DESC, created_at DESC)` was **not a strict total order**.
All 1,157 seeded rows are written by one bulk insert with near-identical `created_at`
values, and ~40 rows can share a single `date`+`time` — so two rows could compare equal at a
page boundary and be silently skipped or repeated.

- **Ordering is now four columns:** `date DESC, time DESC, created_at DESC, id DESC`.
- **Cursor is the complete tuple** `(date, time, created_at, id)`; a partial cursor is invalid.
- **Index `transactions_list_cursor_idx` updated** to `(date DESC, time DESC, created_at DESC,
  id DESC)`, matching the `ORDER BY` column for column and direction for direction.
- The same ordering is used identically by the list query and the cursor comparison (§6.4, §7.3).
- **Rationale recorded per column:** `date` is the business date; `time` is the recorded
  message-log/business time and participates in natural ordering; `created_at` distinguishes
  rows created at different real instants; `id` is the final guaranteed-unique tiebreaker —
  `id` is the primary key and therefore unique within the transactions table, so even rows
  identical in `date`, `time` and `created_at` retain a strict, stable order.

**Rejected design, recorded deliberately:** assigning deterministic/synthetic `created_at`
values to seeded rows was **proposed by the audit and rejected by the user**. `created_at`
must retain its meaning as the actual database creation/audit timestamp. §5.7 rule 5 is
strengthened accordingly: `created_at` values must never be manufactured, back-dated or
manipulated, and the column participates in ordering **as written**. Uniqueness comes from
adding `id` to the ordering, not from corrupting an audit column.

### Clarified — seed identity implementation requirement (§8.1)

The §8.1 raw-line identity design is unchanged and approved. Its **implementation** is now
explicit and normative: the loader must **preserve the verbatim raw CSV line before parsing**
and hash that exact source text. Parsing the CSV and then **reconstructing** a line for
hashing is **prohibited**.

Required pipeline: `raw source line → preserve exact raw line → parse CSV fields → compute
UUIDv5 from the preserved raw line + occurrenceIndex → insert parsed fields`.

Reason: §8.1 defines `rawCsvLine` as the verbatim source line. A re-serialized line is a
different artifact — any drift in spacing, quoting policy, decimal rendering (`100` vs
`100.00`) or parser trimming silently yields a different UUID and destroys the
"identical CSV → identical IDs" guarantee. §8 steps 1 and 5 now carry the same requirement.

### Added — amendment 15: secret management & development tooling (§9)

A **security/environment clarification only**. No application feature, no schema change, no
architectural change, and no implementation authorization.

§9 is retitled *Environment Variables & Secret Management* and gains five subsections:

- **§9.1 Required Environment Variables** — the same four variables, restated as
  **placeholders only** (`DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`,
  `FAMILY_MASTER_PASSWORD`). Restates that `APP_TIMEZONE` (§5.7) and `SEED_NAMESPACE` (§8.1)
  remain **hard-coded constants, not environment variables**, with the note that a
  configurable `SEED_NAMESPACE` could silently re-ID the entire transaction history.
- **§9.2 Secret Management (normative)** — the connection string is supplied *exclusively*
  through `DATABASE_URL`. Actual secret values must never be committed or documented in
  `SPEC.md`, `CHANGELOG.md`, `README.md`, `.env.example`, source code, generated
  documentation, or client-side code. Local development uses `.env.local`; Vercel receives
  secrets through the platform's environment configuration; `.env.example` may be committed
  but holds placeholders only. `FAMILY_MASTER_PASSWORD` follows the same rule as
  `DATABASE_URL` and `AUTH_SECRET`. Both are server-only — never `NEXT_PUBLIC_`, never in a
  Client Component, never returned from a Server Action.
- **§9.3 Environment File Convention** — `.env.local` holds real values and is gitignored;
  `.env.example` holds placeholders and is safe to commit; `.gitignore` must cover
  `.env.local` before any commit that could contain one.
- **§9.4 Neon CLI — Optional Development Tooling, Not an Architectural Dependency** —
  documents `npx neonctl@latest init` as the supported/preferred project-integration
  workflow, and project/branch linking as an additional development use. States the
  distinction normatively: **Neon PostgreSQL = required infrastructure; Neon CLI = optional
  development tooling; the application runtime does not depend on the CLI.** The running app
  connects only via `DATABASE_URL` through `@neondatabase/serverless`; `neonctl` is never a
  runtime dependency, never imported, never required by build or deploy, and provisioning
  through the Neon web console is fully supported.
- **§9.5 Secret Handling by AI Coding Agents (normative)** — credentials and secrets must
  never be copied into source files, documentation, prompts/instructions, generated
  artifacts, logs, or client-side code. Agents may *use* environment variables for authorized
  development operations but must never copy their values into tracked files or docs —
  including commit messages, comments, READMEs, test fixtures, debug logs and changelog
  entries. A secret observed anywhere is treated as **exposed** and reported for rotation,
  never propagated.

**No real credential values were written to any file.** Every value in §9 is a placeholder or
an angle-bracket descriptor. Credentials the user reports having exposed elsewhere are
treated as compromised and are to be rotated by the user; they appear in no project file and
are not reproduced in this changelog.

### Unchanged

> ⚠️ **PARTIALLY SUPERSEDED 15 Aug 2026 (amended 16 Aug 2026).** The clauses below stating
> that *"Quick Add flow"* is unchanged and that *"dark mode … stays out of scope"* are
> superseded by the **v1.2 Amendment — 15 August 2026** entry above (dark mode permitted;
> Quick Add sequence amended to Amount → Details → Category), and the *"budgets … stay out
> of scope"* clause is superseded by the **v1.2 Amendment — 16 August 2026** entry above
> (budgets added). All other clauses in this section remain valid.

- **The v1 exclusion list is untouched and remains frozen** — budgets, automated recurring
  generation, PWA/offline, receipt attachments, multi-currency, budget alerts, digests,
  merchant auto-categorization, voice input and dark mode all stay out of scope.
  *(Superseded 15 Aug 2026 with respect to **dark mode only**, and 16 Aug 2026 with
  respect to **budgets** — see the amendment entries above.)*
- All v1.1 decisions not explicitly amended above carry forward, including §5.6 time
  handling (CSV stays `HH:MM`, column stays Postgres `TIME`) and the 19 category names.
- Auth pattern, tag triad definitions, Quick Add flow, build milestones and environment
  variables are unchanged.
- **Explicitly held unchanged during the amendment 13/14 pass:** `seed.csv` (byte-identical,
  80,515 bytes); the 1,157 count; the two intentional duplicate pairs (no deduplication);
  no `seed_origin`/`source`/import-batch schema; `SEED_NAMESPACE` and `APP_TIMEZONE` remain
  hard-coded constants rather than environment variables; `NUMERIC(12,2)`; the integer-paise
  application representation; the v1 exclusion list.
- The `item`/`note` asymmetry (§6.6) was **not** turned into a schema requirement, and the
  §5.1/§5.7 month-cycle wording overlap was **not** treated as a separate architectural
  change — both remain as noted observations only.
- No application code was written, no migration was run, no project was created.
- The implementation trigger still stands: no code until the user says
  **"lets start the project"**.

---

## v1.1 — 12 August 2026

> ⚠️ **PARTIALLY SUPERSEDED BY v1.2.** The transaction count stated in this entry —
> **1,156** — is **incorrect**; the true count is **1,157**. The claim below that 1,156 was
> "the actual row count" was wrong, and resulted from running `wc -l` on a file with no
> trailing newline. This entry is preserved unaltered as an audit trail; see v1.2 for the
> correction. The category renames and the `Transport & Parking` addition recorded here
> remain valid.

Reconciles the spec with the real contents of `seed.csv`. Four mismatches were found by
auditing the CSV against the v1.0 text; all are resolved in favour of the data.

**Governing decision:** `seed.csv` is the source of truth. Where the spec's prose and the
CSV disagreed, the spec was amended — the CSV was not rewritten. Rationale: nothing has
been built against the spec yet, so changing it risks nothing, whereas mass-editing 1,156
rows of four-year expense history risks silent data loss.

### Changed

- **Transaction count** — `~640` → **1,156** (actual row count; range 23 Nov 2022 →
  12 Aug 2026). Affects the header table and §8.
- **Category names now match the CSV byte-for-byte** (§5.3):
  - `Trips & Travel` → `Travel & Trips`
  - `Clothing & Tailoring` → `Clothing`
  - `Dining Out & Bakery` → `Dining Out`
- **§5.3 retitled** *18 Defaults* → *19 Defaults*, with an explicit rule that the seeded
  category names must match the CSV's `category` column exactly, so the seed script's
  string → UUID lookup cannot miss.
- **§6.2 Quick Add** — category grid `18` → `19` tiles.
- **§4.2 schema comment** on `time` clarified: the column is a Postgres `TIME` that reads
  back as `HH:MM:SS`; it no longer implies the CSV supplies seconds.
- **§8 seed script step 4** — now states the `date` pass-through and the `HH:MM` → `HH:MM:00`
  normalization explicitly, instead of the vague "parse into Postgres formats".

### Added

- **Category `Transport & Parking` 🚌** as the 19th seed (§5.3), placed at sortOrder 18 so
  `Misc` remains last. It appears in 19 CSV rows and was absent from v1.0.
- **§5.6 Time Handling (Minute Precision)** — new section. The CSV keeps its `HH:MM` format;
  the database keeps a native `TIME` column; the two write boundaries (seed script and
  Quick Add Server Action) append `:00`, and display truncates back to `HH:MM`. Storing
  time as `text` was rejected as a stopgap that would lose ordering and range queries.
- **§8 seed notes** — three field-verified facts: every row is `type=expense`; only `Dad`
  and `Mom` appear (`Son` is seeded but has no history); `seed.csv` has no trailing
  newline, so the parser must still emit the final row.

### Unchanged

- Tech stack, auth pattern, table structure, tag triad, UI flows, and the v1 exclusion list
  are all untouched.
- The implementation trigger still stands: no code until the user says
  **"lets start the project"**.

---

## v1.0 — 12 August 2026

Initial frozen specification.

# Specification — Daily Ledger-Change Feed → Private WhatsApp Group

| | |
|---|---|
| **Document status** | 📝 DRAFT — owner-authorized feature, awaiting implementation |
| **Date** | 18 September 2026 |
| **Feature owner decision** | Yes — every clause below is an owner decision or a consequence of one |
| **Supersedes** | Nothing. This is **additive**; the existing weekly/monthly digest (§6.8) is untouched |
| **Audience** | AI code generators / LLMs / development agents. This document is written to be **self-sufficient** — a fresh agent should be able to implement the whole feature from this file plus the codebase |
| **Companion files** | `docs/SPEC.md` (frozen master spec), `docs/CHANGELOG.md` (amendment log), `docs/AUDIT-2026-09-17.md` |

> **Read this first.** `docs/SPEC.md` is **FROZEN**. Do not edit it. Every deviation this
> feature introduces is recorded in `docs/CHANGELOG.md`, per that file's stated governance
> rule ("the spec is frozen; entries below exist only because the user explicitly authorized
> each change"). See [§12 Documentation Obligations](#12--documentation-obligations).

---

## 1. Executive Summary

Tonight, and every night at **22:00 IST**, a single WhatsApp message is posted into a
private WhatsApp group containing only the three household members (Dad, Mom, Son). That
message is a **ledger-change feed** covering the 24 hours just ended:

1. every transaction **added** in the window,
2. every **edit** made in the window (rendered as *before → after*), and
3. every **deletion** made in the window (rendered from the audit-trail snapshot).

If nothing changed in the window, **nothing is posted**. If the poster fails to run, a
**web-push fallback** nags the household's devices fifteen minutes later so the digest is
never silently lost.

A concrete sample of the delivered message:

```text
*Family Ledger — daily changes*
_Wed 17 Sep 22:00 → Thu 18 Sep 22:00_

*Added (3)*
09:14 · ⛽ Fuel · ₹450
   Petrol at Shell
13:02 · 🛒 Groceries & Household · ₹1,850
21:40 · ❔ Uncategorized · ₹120

*Edited (1)*
🍔 Dining Out · ₹450 → ₹500

*Deleted (1)*
🚌 Transport & Parking · ₹60
   Auto to station

*Entered in this window: ₹2,420*
```

**Why this is not trivial, and why this document exists.** The app is hosted on Vercel
(serverless). It is architecturally impossible for Vercel to hold a WhatsApp session, and
Meta provides no free official way to post into a group (§3). The owner therefore chose to
run a small **sender agent on an Android phone** in Termux, linked to Dad's WhatsApp as a
companion device (exactly like WhatsApp Web). The phone fetches a **pre-rendered message
string** from the app and posts it. This document specifies both halves precisely.

---

## 2. Locked Owner Decisions

These are **normative**. Do not "improve" them without an explicit owner request.

| # | Decision | Value |
|---|---|---|
| D1 | Window | Rolling 24 h ending at **22:00 IST**: `[yesterday 22:00, today 22:00)` |
| D2 | Window basis | **`created_at`** (the ledger-change instant), *not* the transaction's business `date`/`time` |
| D3 | Added rows | Chronological · **note shown** on its own line · **no member name** · **no tag** |
| D4 | Edit rendering | **Before → after, per changed field** |
| D5 | Deletion rendering | From the `activity_log` row snapshot already written by the delete actions |
| D6 | Deleted-then-restored in one window | **Net out** — report neither the deletion nor a synthetic re-add |
| D7 | Empty window | **Nothing is posted at all** |
| D8 | Destination | A **new dedicated WhatsApp group** containing only Dad, Mom, Son |
| D9 | Sender identity | **Dad's WhatsApp number**, linked as a companion device via Baileys |
| D10 | Fallback | Web push to subscribed devices at **22:15 IST** if no post is recorded |
| D11 | Record-keeping | A confirmed post is recorded in `app_settings` and appears on the Settings digest card |
| D12 | Sender host | **Termux + Node + Baileys on Dad's Android phone** — no VPS, no paid API |
| D13 | Delivery time | **22:00 IST**, matching the existing digest cron |

### Consequence of D2 that every reader must internalise

The window is an **audit-instant** window, not a "what did we spend today" window. A
backdated expense entered tonight (for a purchase made three days ago) **appears in
tonight's message**, showing its original business date. The closing total is therefore
labelled **"Entered in this window"** — it is *not* a "today's spend" figure and must never
be labelled as one.

D2 also makes the message internally coherent with D4/D5: additions, edits and deletions
are all events that happened in the same 24 hours of wall-clock time.

---

## 3. Why Not The Alternatives (Design Rationale)

An agent asked to implement this will be tempted toward routes the owner already evaluated
and rejected. Recorded here so the analysis is not repeated.

### 3.1 Meta's official WhatsApp Group API — rejected

Meta does now expose a Groups API on the Cloud API. It is unusable for a household:

- it requires an **Official Business Account** (business verification through Meta);
- groups are capped at **8 participants** and the business number consumes a slot;
- there is **no add-participant endpoint** — members join only via an invite link that the
  business must approve;
- business-initiated messages are **billed per message**.

The result would be a family group that posts as a *business*, after a verification
process. Rejected.

### 3.2 Unofficial *hosted* APIs (Whapi.Cloud, Green API, Wasender, …) — rejected

They do work with groups, but they are **paid** (trial credits only), they route the
household's transaction data through a third party, and they are still unofficial
(same ban surface as Baileys).

### 3.3 Self-hosted WhatsApp bridge on a cloud VPS — rejected in favour of the phone

WAHA / Baileys on a VPS would work, but:

- a WhatsApp session driven from a **cloud datacenter IP** is the classic signature
  WhatsApp's anti-abuse systems flag; and
- it costs money and adds a host to maintain.

**The phone wins on both counts.** A companion-device session on a real phone over a
residential/mobile IP is exactly what ordinary WhatsApp Web usage looks like. It also
removes the Vercel session problem entirely and takes the schedule off Vercel's Hobby cron
limits.

### 3.4 A PWA / web page on the phone — impossible

A browser cannot send a WhatsApp message without user interaction. `wa.me` links and the
Web Share API can only open a **picker** — they **cannot target a specific group**. So a
web page can never post unattended. Only code running *on* the phone (Termux) or an
external bridge can.

### 3.5 Telegram — rejected for this feature

Telegram is free, official, reliable, and **already implemented** in this repo
(`src/lib/telegram-digest.ts`). It remains in use for the weekly/monthly digest. The owner
specifically wants the daily *change feed* in **WhatsApp**, so Telegram is out of scope
here.

---

## 4. Architecture

```text
                    ┌──────────────────────── Dad's Android phone ────────────────────────┐
                    │  Termux                                                            │
                    │   node tools/whatsapp-agent/agent.mjs                              │
                    │                                                                    │
                    │   • holds a Baileys session (WhatsApp companion device)             │
                    │   • fires at 22:00 IST                                             │
                    │   • local marker ./sent/<windowKey>.json (anti-double-post)         │
                    └───────┬───────────────────────────────────────────────┬────────────┘
                            │ 1. GET  /api/digest/day                       │ 3. POST /api/digest/day
                            │    Bearer DIGEST_AGENT_TOKEN                  │    { windowKey, status }
                            │    ← { text, window, counts, ... }            │
                            ▼                                               ▼
        ┌──────────────────────────────────────────────────────────────────────────────────┐
        │                              Vercel (Next.js 15)                                 │
        │                                                                                  │
        │  src/app/api/digest/day/route.ts        GET (render) + POST (confirm)            │
        │  src/lib/ledger-feed.ts                 queries + message builder                │
        │  src/lib/ledger-feed-window.ts          pure window math                         │
        │  src/app/api/cron/digest-fallback/      22:15 IST web-push safety net             │
        └───────────────┬──────────────────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────────────┐
        │  Neon Postgres (via Drizzle)              │
        │   • transactions                          │
        │   • activity_log   ← the change journal   │
        │   • app_settings   ← markers + history    │
        └────────────────────────────────────────────┘
```

**The crucial architectural idea:** the message is **rendered entirely server-side**. The
phone receives a finished string and hands it to WhatsApp. The phone knows nothing about
formatting, categories, money or timezones. This keeps the "predecided format" in one
versioned place, keeps the agent trivial, and means a format change ships with a normal
deploy.

### 4.1 Two independent delivery halves

The two halves are **independently shippable**:

- **App side** (Part A) can be built, deployed and curl-tested with **zero** phone setup.
- **Phone side** (Part B) needs only a URL and a token.

Build Part A first.

---

## 5. Part A — App Side

### 5.1 Window mathematics — `src/lib/ledger-feed-window.ts` (new, pure)

Pure module: **no DB access, no `server-only` import**, so it is unit-testable exactly like
`src/lib/digest-format.ts`.

```ts
export interface FeedWindow {
  /** Window start as a UTC instant, ISO 8601 — the SQL comparison bound. */
  startIso: string;
  /** Window end (exclusive) as a UTC instant, ISO 8601. */
  endIso: string;
  /** IST wall-clock rendering of the start, e.g. "2026-09-17 22:00". */
  startIst: string;
  /** IST wall-clock rendering of the end, e.g. "2026-09-18 22:00". */
  endIst: string;
  /** IST calendar date of the start, e.g. "2026-09-17". */
  startDateIst: string;
  /** IST calendar date of the end, e.g. "2026-09-18". */
  endDateIst: string;
  /** `${startDateIst}..${endDateIst}` — the stable idempotency key. */
  key: string;
  /** Human label, e.g. "Wed 17 Sep 22:00 → Thu 18 Sep 22:00". */
  label: string;
  /** True when the window ended more than STALE_AFTER_MS before `now`. */
  stale: boolean;
}

/** The canonical boundary hour, in IST. */
export const FEED_HOUR_IST = 22;

/** Grace period after the boundary before a window is considered "late" but still postable. */
export const FEED_GRACE_MS = 6 * 60 * 60 * 1000; // 6 h

export function feedWindowForInstant(now: Date): FeedWindow;
```

#### Algorithm — normative

1. Take `now` as an **instant**.
2. In `APP_TIMEZONE` (imported from `src/lib/constants.ts`; **never** hardcoded, **never**
   read from the environment), determine today's IST calendar date.
3. Form today's boundary instant: **today at 22:00 IST**.
   Use `date-fns-tz`'s `fromZonedTime` to convert the IST wall-clock string to a UTC
   instant. India has no DST, so the offset is a constant `+05:30` — **still compute it via
   `date-fns-tz`**, never by adding a magic `19800` seconds. This keeps the module correct
   if the timezone constant ever changes and satisfies SPEC §5.7.
4. **If `now >= today's boundary`** → `endIso` = today's boundary, and `startIso` =
   `endIso − 24 h`.
   **Else** → `endIso` = **yesterday's** boundary, and `startIso` = `endIso − 24 h`.
   In other words: *the most recent boundary that has already passed.*
5. `key` = `${IST date of startIso}..${IST date of endIso}`.
6. `stale` = `(now − endIso) > FEED_GRACE_MS`.

#### Why "most recent boundary ≤ now" and not "today's boundary"

If the agent fires **early** (say 21:30), this rule returns *yesterday's* window — the one
whose marker almost certainly already exists — so the endpoint reports `alreadySent: true`
and the agent posts nothing. **Early firing is therefore harmless by construction.** This
is a deliberate property; do not "fix" it by clamping forward to today's boundary, which
would let an early run post a partial window and then be skipped by the marker, silently
losing the rest of the day.

#### Why `stale` exists — and the specified behaviour

If the phone was off for two days, the same rule would return a *two-day-old* window and
the agent would post a stale digest into the group, which is confusing. Therefore:

> **Normative:** when `stale === true`, `GET /api/digest/day` still returns the window and
> the rendered text (so it is debuggable and curl-testable), but the **agent must not post
> it**. The agent logs the skip and exits. The 22:15 fallback push is what tells the
> household a digest was missed.

**Missed windows are never back-filled.** The feed's contract is "what changed in the last
24 h", and a two-day-old window is not that. *(Owner: flag if you would rather have the
agent post a clearly-labelled late feed instead — it is a one-line change in the agent.)*

#### Boundary edge cases to test

| Case | Expectation |
|---|---|
| `now` exactly at 22:00:00.000 IST | Window **ends** now; `endIso === now` |
| `now` at 21:59:59 IST | Window ends **yesterday** 22:00 |
| `now` at 22:15 IST, 30 s late | Same window as a 22:00 run — **identical `key`** |
| Month rollover (2 Oct 22:00) | `key` = `2026-10-01..2026-10-02`; label spans Sep→Oct correctly |
| Year rollover (1 Jan 22:00) | `key` = `2025-12-31..2026-01-01` |
| `now` 30 h after the boundary | `stale === true` |

#### Reuse, do not reinvent

Add a pure `windowKeyLabel(key)` helper (same file) that renders the delivered label
`"Wed 17 Sep 22:00 → Thu 18 Sep 22:00"` from a key, using `date-fns` `format`. This is the
mirror of `periodKeyLabel()` in `src/lib/digest-format.ts` and follows the same
reconstruct-from-key philosophy, so the Settings card can label a stored marker without
storing a label.

---

### 5.2 The audit journal — what exists, and the one gap

**Read this before writing the feed query.**

#### 5.2.1 What already exists

`activity_log` (`src/db/schema.ts`) is an append-only audit trail:

| column | notes |
|---|---|
| `id` | uuid |
| `action` | text — see the table below |
| `entity_type` | text — `"transaction"`, `"category"`, `"template"` |
| `entity_id` | text, nullable |
| `actor` | text, nullable — the `active_member_id` cookie value at write time (**advisory only**, §3.2.1) |
| `payload` | **jsonb**, nullable |
| `created_at` | UTC timestamp, `defaultNow()` |

Indexes: `activity_log(created_at DESC)` and `activity_log(action)`.

Written through `logActivity()` in `src/db/activity-log.ts`, which is **best-effort** —
callers must swallow its errors so a logging failure can never break the mutation it
records. Follow that convention.

Actions actually written today (verified by inspecting every `logActivity(` call site):

| action | written by | payload |
|---|---|---|
| `delete_transaction` | `deleteTransaction` (`src/actions/transactions.ts`) | `{ transactions: [rowSnapshot] }` |
| `delete_transactions` | `deleteTransactions` (same file) | `{ count, transactions: [rowSnapshot, …] }` |
| `restore_transactions` | `restoreActivityEntry` (`src/actions/activity.ts`) | `{ from: <logEntryId>, restored: <count> }` |
| `merge_categories` | `mergeCategories` (`src/actions/settings.ts`) | `{ sourceId, sourceName, … }` |
| `skip_template_month` | `skipTemplateMonth` (`src/actions/templates.ts`) | `{ skipMonth }` |

Deletion snapshots carry **the entire deleted row**, which is why D5 needs no new logging.

#### 5.2.2 The gap — edits are not logged at all

- `transactions` has **no `updated_at`** column. Its timestamps are `created_at` and
  `reviewed_at` only.
- `activity_log` receives **no** update action from anywhere.

So D4 ("before → after") is **not derivable from today's data**. It must be instrumented.
See [§5.3](#53-edit-instrumentation--the-only-schema-level-change).

#### 5.2.3 Why `activity_log` and not a new `updated_at` column

A new `transactions.updated_at` column was considered and **rejected**:

- it cannot say **what** changed, only that something did (failing D4);
- if a row is edited twice inside one window, it can only describe the final state;
- if the row is **later deleted**, the column is gone with it — while the activity-log entry
  survives, so edits to since-deleted rows remain reportable;
- it would require **every** writer to remember to stamp it, which is exactly the kind of
  scattered invariant that rots.

`activity_log.payload` is already `jsonb`, so the richer design needs **no schema
migration** — the only change is one new action value and the writers that emit it.

---

### 5.3 Edit instrumentation — the only schema-level change

#### 5.3.1 New action contract — normative

Add one action value: **`update_transaction`**. One log row per mutation call (not per
affected row), with this payload shape:

```ts
interface UpdateTransactionPayload {
  /** Pre-image, keyed by transaction id. Null when the row could not be read. */
  before: Record<string, TransactionSnapshot | null>;
  /** Post-image, keyed by transaction id. */
  after: Record<string, TransactionSnapshot>;
  /** Denormalised list of changed field names, per transaction id (cheap rendering). */
  changed: Record<string, string[]>;
  /** How the change was made — useful for rendering and for future filtering. */
  via: "edit_sheet" | "assignment" | "bulk_assignment" | "bulk_category";
  /** Set for bulk calls. */
  count?: number;
}

type TransactionSnapshot = {
  memberId: string;
  categoryId: string | null;
  tag: "one_time" | "recurring" | "lifestyle";
  amount: string;   // NUMERIC string, exactly as Drizzle returns it
  note: string | null;
  date: string;     // YYYY-MM-DD
  time: string;     // HH:MM:SS
  splitWith: string[];
};
```

**Store ids, not names.** Category and member names are mutable display labels
(SPEC §3.2.2, §5.3). Names are resolved **at read time** when rendering, with a fallback to
the raw id if the row no longer exists. This mirrors the codebase's immutable-identity
principle and means a category rename cannot retroactively corrupt history.

**Amounts are stored verbatim as the NUMERIC string** and converted to paise only at the
render edge, per SPEC §5.8. Never store a float, never store pre-formatted rupees.

#### 5.3.2 The writers to instrument

All in `src/actions/transactions.ts`. Each needs a **pre-image read before the write** — a
single extra `SELECT`, acceptable at household scale.

| Function | `via` | Fields that can change |
|---|---|---|
| `updateTransaction` | `edit_sheet` | `memberId`, `categoryId`, `tag`, `amount`, `note`, `date`, `time`, `splitWith` |
| `setTransactionAssignment` | `assignment` | `splitWith` |
| `setTransactionsAssignment` | `bulk_assignment` | `splitWith` (per row) |
| `assignCategory` | `bulk_category` | `categoryId` (per row) |

Plus `restoreActivityEntry` in `src/actions/activity.ts` — see §5.3.4.

#### 5.3.3 Implementation guidance

Introduce **one shared helper** rather than repeating the diff logic four times. Suggested
home: `src/actions/transactions.ts` locally, or `src/lib/transaction-diff.ts` if you prefer
it unit-testable (recommended — it is pure and worth a test).

```ts
/** The editable field set, in a stable order for deterministic rendering. */
const TRACKED_FIELDS = [
  "amount", "note", "categoryId", "tag", "date", "time", "memberId", "splitWith",
] as const;

function diffSnapshots(
  before: TransactionSnapshot | null,
  after: TransactionSnapshot,
): string[]; // changed field names, only those genuinely different
```

Then in each writer:

1. Read the pre-image (`SELECT` the snapshot columns for the affected ids) **before** the
   `UPDATE`.
2. Perform the existing update unchanged.
3. In a `try { … } catch { /* best-effort */ }` block, `logActivity({ action:
   "update_transaction", entityType: "transaction", payload: { before, after, changed, via
   [, count] }, actor })`.
4. **Skip logging entirely when `changed` is empty** — a no-op edit (the user re-saved the
   sheet without altering anything) must not appear in the feed.
5. For an update whose row was not found, do not log.

Read `actor` exactly as the existing delete actions do:

```ts
const cookieStore = await cookies();
const actor = cookieStore.get("active_member_id")?.value ?? null;
```

#### 5.3.4 Extending the restore payload — required for netting

D6 (net out a delete + restore inside one window) needs to know **which** transaction ids a
restore brought back. Today's payload is `{ from: <logEntryId>, restored: <count> }`, which
does not name them.

> **Normative change:** `restoreActivityEntry` must additionally record the restored ids:
> `{ from: entry.id, restored, ids: [<transactionId>, …] }`.

The feed builder must also handle **legacy** entries written before this change, for which
`ids` is absent: fall back to loading the *originating delete entry* via `payload.from` and
reading the ids out of that entry's `transactions[].id`. Documented again in §5.4.4.

#### 5.3.5 Effect on Settings → History — expected and handled

`listActivity()` in `src/actions/activity.ts` selects **all** `activity_log` rows with no
action filter, so the new `update_transaction` rows **will appear in the Settings → History
list**. This is accepted (it is arguably a feature). Two guards make it safe:

- `restoreActivityEntry` already **hard-refuses** any action other than
  `delete_transaction` / `delete_transactions` ("Only deleted transactions can be
  restored"). Adding a new action cannot break restore.
- The History **UI** should render the new action with a readable label and must not offer a
  Restore control for it. Ensure the client's action→label mapping has a default branch so an
  unrecognised action cannot crash the list.

---

### 5.4 The feed query — `src/lib/ledger-feed.ts` (new)

`server-only`. Mirrors the split already used by the digest engine: pure logic in one module,
DB access in another.

```ts
export interface LedgerFeed {
  window: FeedWindow;
  added: FeedAddedRow[];
  edited: FeedEditedRow[];
  deleted: FeedDeletedRow[];
  merges: FeedMergeSummary[];
  counts: { added: number; edited: number; deleted: number; merges: number };
  /** Integer paise — the sum of `added` only. Labelled "Entered in this window". */
  addedTotalPaise: number;
  /** True when there is nothing to say (all four counts are zero). */
  empty: boolean;
}

export async function getLedgerFeed(window: FeedWindow): Promise<LedgerFeed>;
export function buildLedgerFeedMessage(feed: LedgerFeed): string | null;
```

#### 5.4.1 Additions

```sql
SELECT … FROM transactions
WHERE created_at >= :startIso AND created_at < :endIso
ORDER BY created_at ASC
```

LEFT JOIN `categories` for the emoji + display name (the join **must** be a LEFT JOIN —
`category_id` is nullable by design, Amendment 20, and a NULL category is the
*Uncategorized* state, never a placeholder row).

LEFT JOIN `members` only if you end up wanting it — per D3 the member name is **not
rendered**, so prefer not selecting it at all.

**Do not** filter on `date`/`time`. That is D2, and getting it wrong is the single easiest
way to implement the wrong feature.

#### 5.4.2 Edits

```sql
SELECT … FROM activity_log
WHERE action = 'update_transaction'
  AND created_at >= :startIso AND created_at < :endIso
ORDER BY created_at ASC
```

Expand each payload into one `FeedEditedRow` per transaction id present in `changed`.
Resolve `categoryId` → name/emoji and `memberId` → name **at this point**, with an id
fallback. Rows whose `changed` list is empty are skipped defensively.

#### 5.4.3 Deletions

```sql
SELECT … FROM activity_log
WHERE action IN ('delete_transaction', 'delete_transactions')
  AND created_at >= :startIso AND created_at < :endIso
ORDER BY created_at ASC
```

Flatten `payload.transactions[]` into one `FeedDeletedRow` per snapshot. The snapshot
already carries everything needed to render (amount, note, categoryId, tag, date, time).

#### 5.4.4 Netting (D6) — algorithm, normative

1. Build `restoredIds`: the union of
   - `ids` from every in-window `restore_transactions` payload that has them, **plus**
   - the fallback path for legacy payloads: if `ids` is absent, load the `activity_log` row
     with id === `payload.from` and take `payload.transactions[].id`.
2. Drop from `deleted` every row whose id is in `restoredIds`.
3. **Do not** synthesise an "Added" row for a restore. A restored row appears in `added`
   **only if its own `created_at` falls inside the window** — legitimate, because it really
   was created in this window.
4. Decrement `counts.deleted` accordingly. If netting empties a section, the section is
   omitted from the message (and can make the whole window empty → D7).

#### 5.4.5 Merges — one summary line, not fake per-row edits

`merge_categories` **re-points transactions' `category_id`**, so a merge is technically a
bulk edit. Emitting hundreds of per-row edit lines would be noise.

> **Normative:** an in-window `merge_categories` produces **one** summary entry rendered as
> a single line, e.g. `🔀 Merged "Fuel" into "Transport & Parking" · 12 entries moved`.
> It does **not** appear in the Edited section.

#### 5.4.6 The message builder — `buildLedgerFeedMessage`

Returns `string | null` — **`null` when `feed.empty`** (D7).

##### Format — exact

- Header: `*Family Ledger — daily changes*` on line 1, then
  `_<window.label>_` as italic on line 2, then a blank line.
- Sections, in this order: **Added**, **Edited**, **Deleted**, then merges (if any), then
  the closing total.
- A section header is `*Added (3)*` — WhatsApp bold, with the count in parentheses.
- **A section with zero entries is omitted entirely** (never rendered as an empty list).
- Rows within a section are chronological (`created_at` ascending).

##### Added row

```text
HH:MM · <emoji> <category name> · ₹amount
   <note>
```

- `HH:MM` = the **transaction's own business time** (`time` truncated per
  `displayTime()` in `src/lib/dates.ts`), and its business `date` is the day the expense
  actually happened — which, per D2, may be earlier than the window. Render the date only
  when it differs from the window's end date, as `12 Sep 09:14` (never print a redundant
  date for today's rows).
- `<emoji> <category name>` — the **category's emoji and current display name**.
  Uncategorized renders exactly as `❔ Uncategorized`.
- Note line: **three leading spaces**, then the sanitised note. Omitted when the note is
  empty/NULL after trimming.
- Whole-rupee formatting is acceptable for the row amount, but **`formatINR` from
  `src/lib/money.ts` is the only formatter that may be used** — never a hand-rolled rupee
  string, never a float operation (SPEC §5.8). Convert with `rupeesToPaise()` first.

##### Edited row

```text
<emoji> <category name> · <change 1> · <change 2>
```

Change rendering per field, using `TRANSACTION_TAG_LABELS` from `src/lib/constants.ts` for
tags:

| field | rendering |
|---|---|
| `amount` | `₹450 → ₹500` |
| `note` | `"Petrol" → "Petrol at Shell"` (quoted so the arrow is unambiguous) |
| `categoryId` | `Uncategorized → Fuel` (old name → new name) |
| `tag` | `Lifestyle → Recurring` |
| `date` + `time` | single combined field: `12 Sep 14:32 → 12 Sep 15:10` |
| `memberId` | `Dad → Mom` |
| `splitWith` | `Nobody → Dad, Mom` (an empty array renders as `Nobody`) |

When only one field changed and it is the amount, the compact
`🍔 Dining Out · ₹450 → ₹500` from the sample is produced — i.e. do **not** print the field
name for `amount`, `categoryId` or `tag`; print `field: …` prefixes only when the field is
ambiguous (`note`, `date`/`time`, `memberId`, `splitWith`).

##### Deleted row

```text
<emoji> <category name> · ₹amount
   <note>
```

Same shape as an added row, minus the time.

##### Closing total

```text
*Entered in this window: ₹2,420*
```

**Additions only.** Integer paise accumulation over the `added` rows. It deliberately
excludes edits and deletions — the label says *entered*, so it must mean entered. When
`added` is empty but edits/deletions exist, **omit the total line** (a `₹0` total would be
misleading).

##### Sanitisation — mandatory

Notes are free user text and WhatsApp interprets `*`, `_`, `~` and `` ` `` as markup. A
stray asterisk in a note will bold the remainder of the message.

> **Normative:** pass every user-originated string through a
> `sanitizeWhatsAppText(value)` helper that (a) replaces the four WhatsApp markup
> characters with visually equivalent safe characters, (b) strips control characters,
> (c) collapses all whitespace runs — newlines included — to single spaces, and (d) trims.

The mapping is fixed. Use exactly these substitutions:

| input char | output | Unicode | rationale |
|---|---|---|---|
| `*` | `∗` | U+2217 ASTERISK OPERATOR | renders essentially identically, is not markup |
| `_` | `‐` | U+2010 HYPHEN | an underscore that cannot pair into italics |
| `~` | `∼` | U+223C TILDE OPERATOR | same glyph, no strikethrough |
| `` ` `` | `'` | — | no monospace |

Do not attempt clever pairing logic ("only escape an unpaired `_`"). WhatsApp's parser
rules are not documented and change; a **unconditional** substitution is the only
predictable behaviour. Notes containing these characters are rare, and a `‐` for `_` still
reads correctly.

Additionally:

- Truncate notes to **80 characters** with a trailing `…`.
- Category display names come from the database and are household-controlled, but sanitise
  them too — a rename can introduce an asterisk.

##### Length cap — mandatory

A pathological day (a bulk import, a merge, a 200-row cleanup) must not produce a wall of
text.

> **Normative:** cap each section at **40 rows**. When truncated, emit a final line in that
> section reading `… and N more`. The counts in the section header reflect the **true**
> total, not the rendered count.

Also guard on total length: if the assembled message exceeds ~50 000 characters, truncate
the Added section further (WhatsApp's hard message limit is 65 536, but readability is the
binding constraint, not the limit).

---

### 5.5 Endpoints

Both live in a new route file: **`src/app/api/digest/day/route.ts`**.

#### 5.5.1 Authentication — mandatory and self-contained

`src/middleware.ts` protects *everything except* `api` (its matcher is
`/((?!api|_next/static|…))`). **All `/api/*` routes are therefore unauthenticated by
default and must guard themselves.** Copy the existing cron pattern from
`src/app/api/cron/digest/route.ts`:

```ts
import { timingSafeStringEqual } from "@/lib/secure-compare";

const expected = process.env.DIGEST_AGENT_TOKEN;
const authorization = request.headers.get("authorization");
if (!expected || !authorization || !timingSafeStringEqual(authorization, `Bearer ${expected}`)) {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
```

Rules:

- **Constant-time compare only.** `timingSafeStringEqual` exists precisely so `===` is never
  used on a secret (SPEC §1.8, CWE-208).
- **Missing env var ⇒ `503`**, not `401` — "not configured" and "wrong token" are different
  diagnoses and the agent's logs must distinguish them.
- Never log the token or the comparison input.
- Optionally apply the existing `RateLimiter` from `src/lib/secure-compare.ts` on
  failed auth attempts, mirroring how it is used elsewhere.

#### 5.5.2 `GET /api/digest/day`

| param | meaning |
|---|---|
| `at` | optional ISO instant — overrides "now". **Test/backfill only.** Validate strictly. |
| `dryRun=1` | optional. `text` is still rendered; nothing is marked. (This route never writes anyway.) |

**Response `200`:**

```jsonc
{
  "ok": true,
  "window": {
    "startIso": "2026-09-17T16:30:00.000Z",
    "endIso":   "2026-09-18T16:30:00.000Z",
    "startIst": "2026-09-17 22:00",
    "endIst":   "2026-09-18 22:00",
    "startDateIst": "2026-09-17",
    "endDateIst":   "2026-09-18",
    "key": "2026-09-17..2026-09-18",
    "label": "Wed 17 Sep 22:00 → Thu 18 Sep 22:00",
    "stale": false
  },
  "counts": { "added": 3, "edited": 1, "deleted": 1, "merges": 0 },
  "empty": false,
  "disabled": false,
  "alreadySent": false,
  "sentAt": null,
  "stale": false,
  "text": "…the finished message…"
}
```

Behavioural rules:

- `text` is **`null`** when `empty === true`, when `disabled === true`, or when
  `alreadySent === true`. It is the *only* field the agent needs; everything else is
  diagnostics.
- `empty` uses the **post-netting** counts (D6 + D7).
- `alreadySent` / `sentAt` are derived from the `app_settings` marker (§5.6).
- `disabled` reflects `whatsapp_feed_enabled` (§5.6). When empty/disabled/already-sent, still
  return the full `window` object — the agent logs it.
- `stale` is surfaced at top level **as well as** inside `window`, purely so the agent can
  check one predictable place.
- Add `export const dynamic = "force-dynamic"` (the cron route does this) so the route is
  never statically cached.

**Errors:** `400` malformed `at`; `401` bad/missing token; `503` token not configured;
`500` unexpected, with a generic message (never leak a stack or SQL).

#### 5.5.3 `POST /api/digest/day`

The agent's confirmation, satisfying D11.

**Body:**

```jsonc
{ "windowKey": "2026-09-17..2026-09-18", "status": "sent", "detail": "optional" }
```

- Validate `windowKey` against the same `^(\\d{4}-\\d{2}-\\d{2})\\.\\.(\\d{4}-\\d{2}-\\d{2})$`
  shape the digest key logic uses. Reject anything else.
- On `status: "sent"`, write the marker (§5.6) with `new Date().toISOString()`.
- On `status: "failed"`, write **nothing** — a failed post must leave the window unmarked so
  the fallback push fires. Optionally log `detail` server-side.
- **Response:** `{ ok: true, recorded: boolean, sentAt: string | null }`.
- Idempotent: re-posting the same window simply refreshes the timestamp. That is fine and
  matches the existing digest-marker semantics ("written on EVERY successful send").

---

### 5.6 `app_settings` keys

Read/written through `getAppSetting` / `setAppSetting` from
`src/db/app-settings-mutations.ts` (upsert on conflict; a missing row means "off").

| key | value | purpose |
|---|---|---|
| `digest_sent:whatsapp_feed:<windowKey>` | ISO timestamp | The confirmed-post marker **and** the "last sent" history record. Doubles as the `alreadySent` gate. |
| `digest_fallback_pinged:<windowKey>` | ISO timestamp | Makes the 22:15 safety net fire **at most once** per window. |
| `whatsapp_feed_enabled` | `'1'` / `'0'` | Master switch for the daily feed. Absent = **enabled** (a fresh deploy works out of the box). Lets the owner silence the feed during a holiday without touching the phone. |

**Do not** reuse the existing `digest_sent:whatsapp:<periodKey>` namespace — that belongs to
the weekly/monthly digest and its keys are `start..end` **date** ranges. The daily feed uses
a distinct channel segment so the two histories cannot collide.

#### 5.6.1 Surfacing it on the digest card (D11)

`src/lib/digest.ts` currently exposes:

- `DIGEST_SENT_KEY_PREFIX = "digest_sent:"`;
- `getRecentDigestSends()`, which scans keys with that prefix and recognises **only**
  `telegram:` and `whatsapp:` channel segments, returning
  `channel: "telegram" | "whatsapp"` and a label from `periodKeyLabel(periodKey)`;
- `formatSentAtLabel(iso)` for the `"7 Sep, 9:41 PM"` IST rendering.

And `src/components/digest/digest-card.tsx` types its `lastSends` prop as
`channel: "telegram" | "whatsapp"`.

> **Normative:** extend the channel union with a third member — suggest
> **`"whatsapp_feed"`** — end to end:
>
> 1. `getRecentDigestSends()` recognises the `whatsapp_feed:` prefix (note it must be checked
>    **before** the `whatsapp:` prefix test, or the more specific one will never match).
> 2. The label for a feed key is produced by `windowKeyLabel()` (§5.1), not
>    `periodKeyLabel()` — the stored key is a pair of *dates* but the natural label is the
>    `Wed 17 Sep 22:00 → …` form. Branch on the channel.
> 3. `digest-card.tsx` renders it as **"WhatsApp feed"**. Its two render sites build the
>    label with `s.channel === "telegram" ? "Telegram" : "WhatsApp"` — those ternaries must
>    become a proper channel→label map, otherwise the feed will render as "WhatsApp" and be
>    indistinguishable from the weekly digest.
> 4. Both card variants (`DigestSettingsCard`, `DigestDashboardCard`) come along — they share
>    the same `lastSends` prop.

---

### 5.7 The fallback safety net (D10)

New route: **`src/app/api/cron/digest-fallback/route.ts`**
New `vercel.json` entry: `{ "path": "/api/cron/digest-fallback", "schedule": "45 16 * * *" }`
— 16:45 UTC = **22:15 IST**.

#### Why a separate cron job rather than a second run of the existing one

Vercel's Hobby plan runs any given cron job **at most once per day** (a `*/30 * * * *`
expression is rejected at deploy time). It does *not* cap the number of jobs — the repo
already declares four separate daily jobs in `vercel.json`, and Vercel permits up to 100
jobs per project on every plan. A **new job at a different time** is therefore legal;
re-running `/api/cron/digest` twice a day is not. Do not "simplify" by merging them.

#### Logic — normative

1. Authenticate with the existing `CRON_SECRET` bearer + `timingSafeStringEqual` pattern,
   identical to `src/app/api/cron/digest/route.ts`.
2. Compute the window ending at today's 22:00 IST via `feedWindowForInstant(new Date())`.
3. If `digest_sent:whatsapp_feed:<key>` exists → return
   `{ ok: true, date, skipped: "already_sent" }`. **Nothing is sent.**
4. If `digest_fallback_pinged:<key>` exists → return
   `{ ok: true, skipped: "already_pinged" }`. **At most one nag per window.**
5. Otherwise send a web push to **every** row in `push_subscriptions`, reusing the delivery
   loop already implemented in `pingDigestReady()` (`src/lib/whatsapp-digest.ts`) — including
   its **stale-endpoint purge** (`inArray` delete on `404`/`410` statuses). Do not
   re-implement the loop; extract it or call it.
6. Notification content:
   - title: `Family Ledger · digest not posted`
   - body: `The 10 PM ledger post hasn't gone out. Tap to send it manually.`
   - url: `/` (deep-linking to the dashboard is safe and never goes stale — the same
     reasoning the existing ping uses)
7. Write `digest_fallback_pinged:<key>`.
8. `revalidatePath("/")` so the dashboard re-renders.
9. Return `{ ok, date, sent, failed, stale }`.

#### Preconditions and graceful degradation

- Requires web push to be configured (`isPushConfigured()` — `VAPID_PRIVATE_KEY`,
  `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`). Absent ⇒ return a clear `503`-style payload, exactly
  as `pingDigestReady` does.
- Zero subscribed devices is a **success** with `sent: 0`, not an error.
- If the feed is disabled via `whatsapp_feed_enabled = '0'`, **do not ping** — return
  `skipped: "disabled"`. The owner turned it off deliberately.

#### Known limitation — document it, do not hide it

If the phone posts at 22:20 (i.e. after the fallback already ran), the household receives a
nag for a digest that was merely late. This is an acceptable nuisance in exchange for never
silently losing a day. Do not attempt to "fix" it with a longer delay — the point is to
alert the household promptly enough that someone can still post by hand.

---

### 5.8 A note on the existing weekly/monthly digest

**This feature does not replace, alter or compete with** the existing digest
(`src/lib/digest.ts`, `src/lib/telegram-digest.ts`, `src/lib/whatsapp-digest.ts`,
`/api/cron/digest`). That path is untouched:

- Telegram continues to auto-send the weekly/monthly aggregate digest on the 7th, 14th, 21st,
  28th and month-end.
- WhatsApp remains the Click-to-Chat / wa.me pattern for *that* digest.

On a digest day both messages go out: the weekly aggregate at 22:00 (Telegram + wa.me ping)
and the daily change feed at 22:00 (the phone). That is intended.

Do **not** refactor the two together. They have different shapes (aggregate vs. change feed),
different triggers (calendar periods vs. rolling 24 h) and different transports.

---

## 6. Part B — The Phone Agent (Termux + Baileys)

### 6.1 What it is

A small long-running Node script on Dad's Android phone that:

1. holds a WhatsApp **companion-device** session (the same mechanism as WhatsApp Web);
2. wakes at **22:00 IST**;
3. `GET`s the finished message from the app;
4. posts it into the dedicated group;
5. `POST`s a confirmation.

### 6.2 Repository layout — `tools/whatsapp-agent/`

```text
tools/whatsapp-agent/
├── README.md            # the one-time setup, verbatim, for a human
├── agent.mjs            # the agent
├── config.example.json  # committed template (no secrets)
├── config.json          # gitignored — real token + group JID
├── start.sh             # wake-lock + restart loop
├── auth/                # gitignored — Baileys multi-file session state
└── sent/                # gitignored — local anti-double-post markers
```

> **Mandatory:** add `tools/whatsapp-agent/{config.json,auth/,sent/,agent.log}` to
> `.gitignore`. The auth directory contains credentials equivalent to a logged-in WhatsApp
> session; committing them would be a serious leak. Verify with `git status` before any
> commit that touches this directory.

### 6.3 Config contract

```jsonc
{
  "apiUrl": "https://<your-deployment>.vercel.app",
  "token": "<DIGEST_AGENT_TOKEN>",
  "groupJid": "1203630xxxxxxxxx@g.us",
  "sendAt": "22:00",
  "timezone": "Asia/Kolkata"
}
```

- `groupJid` (not a phone number) — groups are addressed by JID, not by E.164 number.
- `token` must be `chmod 600 config.json`.
- `timezone` is explicit so the schedule does not depend on the phone's locale.

### 6.4 One-time setup (documented in the README)

1. Install **Termux from F-Droid or GitHub** — **not** the Play Store build, which is
   deprecated and will not install the current Node.
2. `pkg update && pkg upgrade`
3. `pkg install nodejs-lts git`
4. `git clone` the repo (or copy the `tools/whatsapp-agent` folder).
5. `npm install` inside the agent folder (deps: `baileys`; no native build is needed —
   Baileys is pure JavaScript, which is precisely why it works on Termux).
6. `cp config.example.json config.json` and fill in `apiUrl`, `token`, and later `groupJid`.
   `chmod 600 config.json`.
7. Create the dedicated WhatsApp group from Dad's phone with Mom and Son.
8. Run `node agent.mjs --groups` once — it links (QR or pairing code) and prints
   `name → jid` for every group. Paste the intended group's JID into `config.json`.
9. Disable battery optimisation for Termux (Android Settings → Apps → Termux → Battery →
   Unrestricted). **Without this, Android will kill the process and the post silently stops.**
10. Start it: `./start.sh` (which takes a `termux-wake-lock` first).

### 6.5 Agent behaviour — normative

#### Linking

- Use Baileys' `useMultiFileAuthState("auth")` so the session survives restarts.
- Prefer **QR** by default; support `--pair` to use a **pairing code** against Dad's number,
  which is easier to complete from the same phone.
- On `connection.update` with `connection: "close"` and a **401**, the session has been
  invalidated (WhatsApp unlinked the device). Do **not** retry in a loop — log a clear
  "re-link required" message and exit non-zero so the operator sees it.
- For any other close reason, reconnect with exponential backoff.

#### Scheduling

- Compute the milliseconds to the next **22:00 IST** boundary and `setTimeout`. Do not
  busy-wait.
- **Also** re-check every 60 s against the wall clock and, on each tick, evaluate "is it past
  22:00 IST and is there no local marker for this window?" — this makes the agent
  self-healing if the timer was suspended while the phone slept.
- Compute the IST boundary the same way the app does (via a timezone-aware conversion). Do
  not trust `new Date().getHours()`, which follows the *device* timezone.

#### One run

1. `GET {apiUrl}/api/digest/day` with `Authorization: Bearer {token}`, a 20 s timeout.
2. Handle status codes explicitly: `401` ⇒ wrong/absent token (fail loudly, do not retry in
   a tight loop); `503` ⇒ the env var is missing; `5xx` ⇒ retry up to 3 times with backoff.
3. If `alreadySent` ⇒ log and finish (this is the normal outcome of an early or duplicate
   fire).
4. If `disabled` ⇒ log and finish.
5. If `empty` or `text === null` ⇒ log "nothing to post" and finish (D7).
6. **If `stale` ⇒ log "window is stale, not posting" and finish** (§5.1).
7. `await sock.sendMessage(groupJid, { text })`.
8. On success: write `sent/<windowKey>.json` locally **and** `POST` the confirmation.
   - The local marker is the primary guard against a double-post across a restart.
   - The POST is best-effort — if it fails, log it. Do **not** re-send the message because
     the confirmation failed. (Consequence: the Settings card may under-report; acceptable.)
9. On send failure: log, do **not** write either marker, and exit — the 22:15 fallback push
   will alert the household.

#### Operational

- `start.sh`:
  ```sh
  termux-wake-lock
  while true; do node agent.mjs >> agent.log 2>&1; sleep 30; done
  ```
  The restart loop is deliberate: if Node crashes, the agent comes back within 30 s.
  Termux's `termux-services`/`sv` is the more robust alternative — document it as optional.
- Rotate `agent.log` (truncate past ~1 MB) so a forgotten phone cannot fill its storage.
- Never log the token or the full response body at info level.
- Prefix every log line with an IST timestamp.

### 6.6 What the agent must NOT do

- **No formatting, no money math, no category names.** It posts the server's string verbatim.
- No database access.
- No knowledge of the window beyond the `windowKey` it echoes back.
- It must not attempt to target a group other than the configured `groupJid`.

---

## 7. Environment Variables

| variable | where | purpose |
|---|---|---|
| `DIGEST_AGENT_TOKEN` | Vercel | Bearer token for `/api/digest/day`. **New.** Generate with `openssl rand -hex 32` (or `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`). |
| `CRON_SECRET` | Vercel | Already required; reused by the new fallback cron. |

Existing and unchanged for this feature: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_SUBJECT` (web push), `DATABASE_URL`, `AUTH_SECRET`, `FAMILY_MASTER_PASSWORD`.

The agent's copy of `DIGEST_AGENT_TOKEN` lives only in the phone's `config.json`.

---

## 8. Testing Plan

Follow the repo's existing convention: **DB-free pure tests under `src/lib/*-test.ts`, run
via `tsx`, exposed as an npm script.** `src/lib/digest-test.ts` and
`src/lib/validation-test.ts` are the models to copy — read them before writing new tests.

Add to `package.json`:

```json
"test:ledger-feed": "tsx src/lib/ledger-feed-test.ts"
```

`src/lib/ledger-feed-test.ts` must cover:

**Window math (`feedWindowForInstant`)**
- exactly-on-the-boundary instant;
- one second before the boundary → previous window;
- a late fire (22:07) produces an **identical key** to a 22:00 fire;
- month rollover and year rollover keys and labels;
- `stale` flips exactly past the grace period;
- the IST offset is `+05:30` (assert a known instant maps to a known UTC bound).

**Message builder (`buildLedgerFeedMessage`)**
- empty feed ⇒ returns `null`;
- added-only, single entry ⇒ no pluralisation bug (`1 entry` vs `3 entries` in the header);
- note omitted when empty; note shown when present; note truncated at 80 chars;
- markdown sanitisation: a note containing `*` cannot bold the remainder — assert the
  literal character is absent from the output;
- uncategorized renders as `❔ Uncategorized`;
- edited rows render the before → after forms from the §5.4.6 table, one case per field;
- deleted rows render from a snapshot;
- netting: a delete with a matching in-window restore produces **neither** a Deleted line
  nor a synthetic Added line;
- legacy restore payload (no `ids`) still nets out via the `payload.from` fallback;
- section omission when a section is empty; total line omitted when `added` is empty;
- a 50-row day truncates at 40 with `… and N more` while the header count stays true.

**Diff helper (`diffSnapshots`)**
- identical snapshots ⇒ empty change list (and therefore no log row);
- each tracked field in isolation;
- a null pre-image does not throw.

Manual verification (document the exact commands in the agent README):

```bash
# 200 with text
curl -s -H "Authorization: Bearer $DIGEST_AGENT_TOKEN" \
  "https://<deployment>/api/digest/day" | jq

# pin the window to a known past day
curl -s -H "Authorization: Bearer $DIGEST_AGENT_TOKEN" \
  "https://<deployment>/api/digest/day?at=2026-09-18T16:35:00.000Z" | jq .text -r

# unauthenticated must be 401
curl -s -o /dev/null -w "%{http_code}\n" "https://<deployment>/api/digest/day"
```

Also run, as with any change to this repo:

```bash
npm run typecheck
npm run lint
npm run test:digest          # the existing digest suite must stay green
npm run test:ledger-feed     # the new suite
```

---

## 9. Edge Cases & Failure Modes

| # | Situation | Specified behaviour |
|---|---|---|
| E1 | No changes in the window | No post (D7). Endpoint returns `empty: true`, `text: null`. |
| E2 | Agent fires early (21:30) | Window resolves to the previous day's, which is already marked ⇒ `alreadySent: true`, no post. |
| E3 | Agent fires very late / phone was off for days | `stale: true`; the agent refuses to post. Fallback push alerts the household. **No back-filling.** |
| E4 | Delete + Undo inside the window | Netted out (D6). |
| E5 | Delete in-window, restore in a *later* window | Deletion is reported normally; the restore is a *later* window's concern. |
| E6 | Row deleted, then a legacy restore entry with no `ids` | Netting falls back to loading the originating delete entry (§5.4.4). |
| E7 | A category was merged in the window | One summary line, not N edit lines (§5.4.5). |
| E8 | A category referenced by an edit was renamed since | Resolve to the **current** name; fall back to the raw id if the row is gone. |
| E9 | Transaction edited twice in one window | Two edit lines (one per log row) — the feed is a journal, not a state snapshot. |
| E10 | Recurring cron auto-stamped a transaction in the window | It has a `created_at` in-window, so it appears as an Added row. **Correct and intended.** |
| E11 | Note contains `*` or a newline | Sanitised (§5.4.6). |
| E12 | 200 rows in one window | Truncated at 40 per section with `… and N more`. |
| E13 | Phone off / Termux killed at 22:00 | No post; 22:15 web push fires. |
| E14 | WhatsApp unlinks the device (401) | Agent logs "re-link required" and exits non-zero; it does not spin. |
| E15 | `/api/digest/day` returns 401 in production | Wrong or missing `DIGEST_AGENT_TOKEN`; the agent fails loudly rather than silently retrying. |
| E16 | Confirmation POST fails after a successful send | The message **is** sent; only the record is missing. Never re-send. |
| E17 | Two agents configured (e.g. a second phone) | The server marker plus local markers make a duplicate highly unlikely but not impossible within the same second. Accepted; this is a one-phone household feature. |
| E18 | Owner disables the feed mid-month | `whatsapp_feed_enabled = '0'` ⇒ endpoint returns `disabled: true`, agent posts nothing, fallback does not ping. |
| E19 | Merge touches transactions created earlier | The merge summary appears; those transactions do **not** appear as Added (their `created_at` is outside the window). |
| E20 | The household edits a transaction dated in a previous window | It appears in the **current** window's Edited section (D2 is an audit-instant basis). |

---

## 10. Security & Privacy

1. **The endpoint must be token-guarded.** `/api/*` is *not* protected by middleware. An
   unguarded endpoint here would expose the household's complete financial activity to
   anyone with the URL. Use the constant-time compare (§5.5.1).
2. **Bounded read scope.** `GET /api/digest/day` returns only the current window's data. It
   accepts no filters, no date-range query, no ordering, no projections. Do not add
   parameters that widen what is returned — that is the whole reason a bespoke token is
   acceptable here.
3. **The phone holds two sensitive things**: the bearer token and a WhatsApp session's
   credentials. Both must be `chmod 600` and gitignored (§6.2). Treat a lost phone as a
   credential compromise: revoke the token, unlink the device.
4. **Deleted-entry details are visible to all group members**, including Son, and include
   notes on rows someone deliberately removed. This is the owner's decision (D5 + D8); it is
   recorded here so it is a known property rather than a surprise.
5. **Baileys is unofficial.** It drives the WhatsApp Web protocol. Its use is a matter of
   WhatsApp's terms and carries a nonzero risk of the linked number being restricted.
   Mitigations already in the design: a real linked device on a residential IP (the
   lowest-risk form), a low message volume (one message per day), and a single fixed
   destination group. **Deriving a strongly recommended extra mitigation:** link a
   **spare/secondary number** rather than the primary family number — the owner chose Dad's
   number, so this is noted as a residual risk they have accepted.
6. **Data leaves the app to Meta** once posted. Inherent to the requirement; not mitigable.
7. **Never log the token**, the full push payload, or full response bodies at info level.

---

## 11. Out of Scope

- Replacing or modifying the existing weekly/monthly Telegram + WhatsApp digest.
- Any inbound WhatsApp handling (this is one-directional; the agent never reads messages).
- The official Meta Cloud API, the Groups API, Official Business Account verification.
- Back-filling missed windows (§5.1).
- Per-member or per-category digests.
- A UI for editing the message format (the format is code, per §4).
- Multiple target groups — **one** group, one JID.
- iOS as a sender host (Termux and Baileys do not apply there).

---

## 12. Documentation Obligations

This repo has a specific governance rule, stated at the top of `docs/CHANGELOG.md`:

> All amendments to `SPEC.md` are recorded here. The spec is frozen; entries below exist only
> because the user explicitly authorized each change.

Therefore, as part of this work:

1. **Add a new entry to `docs/CHANGELOG.md`**, matching the existing house style (see the
   "Master-password change retires existing sessions — 13 September 2026 (owner request)"
   entry for the shape): a heading with the date and `(owner request)`, a short statement of
   what the owner asked for, then bullets naming the concrete files and the normative rules
   introduced. Mention explicitly:
   - the new `update_transaction` audit action and the `ids` addition to
     `restore_transactions`;
   - the new `DIGEST_AGENT_TOKEN` env var;
   - the new cron job and why it is a separate job (Hobby's once-per-day-per-job limit);
   - the new `app_settings` keys;
   - that the Settings digest card gains a third channel.
2. **Do not edit `docs/SPEC.md`.** If a normative clause there genuinely conflicts, raise it
   with the owner rather than amending the frozen document.
3. **Update `tools/whatsapp-agent/README.md`** with the verbatim one-time setup (§6.4) — it is
   the only place a human will look.
4. Verify, as the existing entries do, and record it in the entry:
   `npm run typecheck`, `npm run lint`, `npm run test:ledger-feed`, `npm run test:digest`.

---

## 13. Implementation Order (Checklist)

**Phase 1 — pure logic (no DB, no network)**

- [ ] `src/lib/ledger-feed-window.ts` — `feedWindowForInstant`, `windowKeyLabel`, constants.
- [ ] `src/lib/transaction-diff.ts` — `TRACKED_FIELDS`, `diffSnapshots`, snapshot type.
- [ ] `src/lib/ledger-feed-test.ts` + the `test:ledger-feed` npm script. **Green before
      moving on** — the window math is where the subtle bugs live.

**Phase 2 — edit instrumentation**

- [ ] Add the `update_transaction` payload contract (§5.3.1).
- [ ] Instrument `updateTransaction`, `setTransactionAssignment`, `setTransactionsAssignment`,
      `assignCategory` (§5.3.2) with pre-image reads and best-effort logging.
- [ ] Add `ids` to `restoreActivityEntry`'s payload (§5.3.4).
- [ ] Check the Settings → History action label mapping has a safe default (§5.3.5).

**Phase 3 — the feed**

- [ ] `src/lib/ledger-feed.ts` — `getLedgerFeed` (additions / edits / deletions / merges,
      netting) and `buildLedgerFeedMessage` (format, sanitisation, caps).
- [ ] Extend the builder's unit tests with the message cases.

**Phase 4 — endpoints**

- [ ] `src/app/api/digest/day/route.ts` — `GET` + `POST`, token auth, `force-dynamic`.
- [ ] `DIGEST_AGENT_TOKEN` set on Vercel.
- [ ] curl-verify `401` unauthenticated and `200` with text.

**Phase 5 — fallback**

- [ ] `src/app/api/cron/digest-fallback/route.ts`.
- [ ] `vercel.json` entry `{ "path": "/api/cron/digest-fallback", "schedule": "45 16 * * *" }`.
- [ ] Reuse `pingDigestReady`'s delivery loop including the stale-endpoint purge.

**Phase 6 — record-keeping**

- [ ] Extend `getRecentDigestSends()` with the third channel (§5.6.1).
- [ ] Update `digest-card.tsx` to render it as **"WhatsApp feed"**.

**Phase 7 — the agent**

- [ ] `tools/whatsapp-agent/` (agent, config template, start.sh, README).
- [ ] `.gitignore` entries — **verify with `git status`**.
- [ ] On the phone: F-Droid Termux → Node → link → `--groups` → JID → battery exemption →
      `./start.sh`.

**Phase 8 — documentation**

- [ ] `docs/CHANGELOG.md` entry (§12).
- [ ] All four verification commands green.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Window** | The rolling 24 h ending at 22:00 IST, `[yesterday 22:00, today 22:00)`. |
| **Window key** | `${startDateIst}..${endDateIst}` — the stable idempotency/marker id. |
| **Companion device** | A WhatsApp linked device (what WhatsApp Web is). What Baileys emulates. |
| **Baileys** | Pure-JavaScript WhatsApp Web client library. Unofficial. |
| **Termux** | A Linux environment for Android. Hosts the agent. |
| **JID** | WhatsApp's address form. Groups end in `@g.us`. |
| **Pre-image** | The row's state *before* an edit, needed to render "before → after". |
| **Netting** | Suppressing a delete whose matching restore happened in the same window (D6). |
| **Change feed** | A journal of events (add/edit/delete) in a time range — not a state snapshot. |
| **Digest** | The pre-existing weekly/monthly *aggregate* message. Different feature, untouched. |
| **Agent** | The Termux script that fetches the rendered message and posts it. |

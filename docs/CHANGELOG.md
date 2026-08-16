# Changelog — Family Ledger Specification

All amendments to `SPEC.md` are recorded here. The spec is frozen; entries below exist
only because the user explicitly authorized each change.

Superseded entries are **annotated, never rewritten** — the audit trail is the point.

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

## v1.2 Amendment — 16 August 2026 (owner decision: budgets)

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

# Changelog — Family Ledger Specification

All amendments to `SPEC.md` are recorded here. The spec is frozen; entries below exist
only because the user explicitly authorized each change.

Superseded entries are **annotated, never rewritten** — the audit trail is the point.

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

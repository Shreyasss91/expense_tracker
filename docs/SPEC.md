# 📖 MASTER SPECIFICATION DOCUMENT: Family Ledger (v1.2)

| | |
|---|---|
| **Document Status** | ❄️ FROZEN — no changes permitted (amendments recorded in `CHANGELOG.md`) |
| **Version** | 1.2 (see `CHANGELOG.md`) |
| **Date** | 12 August 2026 — amended 15 August 2026 (3 owner decisions; see `CHANGELOG.md`), 16 August 2026 (budgets, bills, exclude-bills, expense-focused cards, ledger reconciliation, Phase-2 remediation; see `CHANGELOG.md`), 18 August 2026 (Amendments 7–9: single-page Quick Add, note-based category suggestions + inline creation, name-only category chips; see `CHANGELOG.md`), and 19 August 2026 (Amendments 10–12: Amount+Tag row, member-switch chip, dynamic sticky CTA, and an edit sheet matching Quick Add's shell; see `CHANGELOG.md`) |
| **Target Audience** | AI Code Generators / LLMs / Development Agents |
| **Project Type** | Full-Stack Web Application (Family Expense Tracker) |
| **Hosting Target** | Vercel (Hobby Tier) |
| **Companion File** | `seed.csv` (historical data, 1,157 transactions — referenced, not embedded) |
| **Implementation Trigger** | Work begins ONLY when user says: **"lets start the project"** |

> **v1.2 amendment pass — 15 August 2026.** Three owner decisions are incorporated into
> this document: (1) **dark mode is permitted** (§6.1, §11); (2) the **Quick Add sequence
> is Amount → Details → Category** (§6.2); (3) the **family password is environment-managed**
> with no in-app change facility (§6.5, §9). Each is recorded in `CHANGELOG.md`. No
> implementation, schema, migration, or `seed.csv` change accompanied these amendments.
> *(The Quick Add sequence bullet is superseded by the 18 August 2026 single-page
> amendment — see below and `CHANGELOG.md`.)*
>
> **16 August 2026 — budgets authorized by the owner** (§6.7, §4.2, §11): monthly budgets
> (total + per-category, per-month or as an every-month default) are a new v1.2 feature
> with a `budgets` table, Settings card, and dashboard Budget card. The same day's owner
> iterations added: an expense-focused dashboard summary strip and ledger header, a
> spent-vs-budget bar under the ledger month strip, a global "exclude bills" toggle
> (`app_settings`), a Bills summary card, and a one-tap "It's a bill" Quick Add
> shortcut (§6.2–§6.7). All recorded in `CHANGELOG.md`.
>
> **18 August 2026 — Quick Add is a single page** (§6.2): the **Amount → Details →
> Category** sequence is superseded by one scrollable sheet — amount text input, tag
> chips, date/time, note, category grid (tap to select) and a single **Add transaction**
> button. The one-tap "It's a bill" shortcut and the full-screen numpad are removed with
> the multi-step flow. Recorded in `CHANGELOG.md`.
>
> **19 August 2026 — Add-transaction UI restructure, Amendments 10–12** (§6.2, §6.4): the
> separate Amount field and Tag chip selector merge into one **Amount+Tag row** — a
> ₹-prefixed amount input beside a compact 2×2 tag cluster — and the sticky footer CTA's
> label goes dynamic (**"Add ₹1,250 · Dining Out"** once valid). The sheet's own header
> "Add transaction" text becomes a real button wired to the same submit path as the
> footer CTA (Amendment 11), and is then styled as a filled pill so it visibly reads as
> a button rather than underlined text (Amendment 12).
> The Date/Time collapsed summary **no longer persists** across devices — every open
> starts collapsed on today's date and the current time, for the rest of that tab's
> session only (Amendment 11). The **edit-transaction dialog is rewritten from a
> centered modal into a bottom sheet matching Quick Add's shell** — grip handle, header
> button + a per-transaction member-reassignment dropdown chip, the same field order,
> and a dynamic sticky "Save ₹1,250 · Dining Out" CTA, with Delete moved to a small icon
> button beside Save (Amendment 12). Recorded in `CHANGELOG.md`.

---

## 1. Executive Summary & User Intent

**Family Ledger** is a high-speed, low-friction expense tracking web application designed for a 3-person household (Dad, Mom, Son).

**Core User Intent:** The primary users are busy parents. The app must prioritize **speed of data entry** over complex accounting. Logging an expense must take < 5 seconds via a "Quick Add" interface. The secondary intent is **financial clarity**, providing instant visual breakdowns of committed bills vs. discretionary lifestyle spending.

**Design Philosophy:** Mobile-first UI, large touch targets, zero-friction authentication, and immediate visual feedback.

**Family Context (from source chat data):**
- Two cars (Tata Tiago, Renault Duster) + one bike → Fuel is the largest routine expense (~₹5k/month)
- One young child ("Papu"/Son) → heavy Kids-category spend (pampers, toys, school)
- Active site/property investment + gold/silver purchases → these count as expenses
- Regular family trips, festivals, and gift-giving (muyyi) culture

---

## 2. Technical Stack & Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router, React Server Components, Server Actions) |
| Language | TypeScript (Strict mode) |
| Styling | Tailwind CSS + `shadcn/ui` (Radix UI primitives) |
| Charts | Recharts (Responsive containers, Pie, Bar, Line) |
| Database | Neon (Serverless Postgres, free tier) |
| ORM | Drizzle ORM (Core + `drizzle-kit` for migrations) |
| DB Driver | `@neondatabase/serverless` (HTTP/WebSocket driver for Vercel serverless) |
| Authentication | NextAuth.js (Auth.js v5) — **Credentials Provider only** |
| Validation | Zod (schema validation for all Server Actions) |
| Icons | `lucide-react` |
| Date/Time | `date-fns` + `date-fns-tz` — business timezone `Asia/Kolkata` (§5.7) |
| Currency | Storage `NUMERIC(12,2)`; app arithmetic in integer paise; display via `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` (§5.8) |
| Deterministic IDs | `uuid` (v5) — content-addressed seed identity (§8.1) |
| Hosting | Vercel Hobby Tier (connected to existing GitHub repo) |

---

## 3. Authentication & Identity (The "Option B" Pattern)

This app does **not** use standard multi-user email/password registration. It uses a **Shared Family Password + Member Switcher** pattern.

### 3.1 Auth Flow (NextAuth)
1. **Single Master Password:** Stored in `.env` as `FAMILY_MASTER_PASSWORD`.
2. **Login Screen:** A single password input field. No email, no "forgot password", no registration.
3. **Session:** Upon correct password, NextAuth issues a secure, HTTP-only session cookie. Session payload contains `{ role: 'family_admin' }`.
4. **Route Protection:** Middleware protects all routes except `/login`.

### 3.2 Member Identity (App State)
Once authenticated, the user selects *who* is currently holding the device.

1. **Member Switcher:** Dropdown in the global header displaying the 3 members: **Dad 👨, Mom 👩, Son 👦** with assigned colors/emojis. **A second, equivalent switcher lives in the Quick Add sheet's own header chip (§6.2, Amendment 10, 19 Aug 2026)** — it calls the same `updateActiveMember` Server Action, so switching mid-entry needs no trip back to the global header.
2. **State Management — normative:** The selected `member_id` is stored in **a plain, client-readable cookie** named `active_member_id`. It is **not** `httpOnly`, **not** Zustand, and **not** any other client store. Rationale: Server Components and Client Components both read the same value, it survives refresh, SSR is deterministic (no memberless first paint, no hydration flash), and no state-management dependency is introduced. Handing the phone to another member = one tap to switch, no re-login.
3. **Mutations:** Every Server Action that creates a transaction reads `active_member_id` from the cookie and stamps it on the database record.

#### 3.2.1 The Active Member Is NOT a Security Boundary
This distinction is normative and must not be blurred:

- **Authentication** (§3.1) is the security boundary. The NextAuth session cookie proves the holder has access to the family application. It is `httpOnly` and signed.
- **The active member cookie** is a *UI convenience* recording who is currently holding the device. It is client-readable and client-writable by design. It carries no privilege, gates no route, and grants no access.

Consequently, every Server Action **must validate that the submitted/consumed `member_id` exists in the `members` table** and reject the mutation otherwise. This validation exists to prevent broken foreign keys and malformed data — **not** to authenticate the user. No Server Action may treat this cookie as proof of identity, and no authorization decision may depend on it.

#### 3.2.2 Immutable Member Identity — Normative
Members follow **the same architectural principle as categories** (§5.3): **immutable identity ≠ mutable display label.**

- `slug` is the **permanent identity**. It is assigned once at seed time, is never edited by the user, is **not exposed in Settings**, and must never be changed by a migration.
- `name` is the **display label only**, freely editable in Settings (§6.5). `emoji`, `color` and `sortOrder` remain editable exactly as already specified.
- All CSV ingestion resolves `member` → `slug` → `members.id` through the literal map below. **Member lookups never depend on `name`.**
- Transactions reference `members.id` (a UUID) and are therefore untouched by any rename.

| `slug` (immutable) | `name` (initial, editable) | Emoji | Rows in `seed.csv` |
|---|---|---|---|
| `dad` | Dad | 👨 | 904 |
| `mom` | Mom | 👩 | 253 |
| `son` | Son | 👦 | 0 (seeded, no history — §6.3.1) |

The seed script maps the CSV `member` string through **this table as a literal lookup map**, not via a runtime slugify function. The initial `name` values must match the CSV strings byte-for-byte; after seeding, `name` is the user's to change.

**Guarantee:** renaming `Dad` → `Appa` changes one display string. It has **zero effect** on existing transactions (which hold the UUID) and **zero effect** on future seed identity (which resolves through `slug`). The `member` column of `seed.csv` never changes, so the CSV-string → slug map stays valid permanently.

---

## 4. Database Schema (Drizzle ORM)

5 tables — 3 core (`members`, `categories`, `transactions`) plus `budgets` (§6.7) and
`app_settings` (§6.7). All IDs are UUIDs.

### 4.1 Enums
```typescript
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'expense']);
export const transactionTagEnum = pgEnum('transaction_tag', ['one_time', 'recurring', 'lifestyle']);
```

### 4.2 Tables
```typescript
export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),   // IMMUTABLE identity: 'dad' | 'mom' | 'son' (§3.2.2)
  name: text('name').notNull(),            // MUTABLE display label — editable in Settings (§6.5)
  emoji: text('emoji').notNull(),          // '👨', '👩', '👦' — editable
  color: text('color').notNull(),          // Tailwind color class — editable
  sortOrder: integer('sort_order').notNull(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),   // IMMUTABLE identity — never edited by the user (§5.3)
  name: text('name').notNull(),            // MUTABLE display label — editable in Settings (§6.5)
  emoji: text('emoji').notNull(),
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey(),         // Quick Add: crypto.randomUUID(). Seed: deterministic UUIDv5 (§8.1)
  memberId: uuid('member_id').references(() => members.id).notNull(),
  categoryId: uuid('category_id').references(() => categories.id).notNull(),
  type: transactionTypeEnum('type').notNull().default('expense'),
  tag: transactionTagEnum('tag'),      // Nullable in type only — constrained by CHECK below (§5.2)
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),  // Read as string; see §5.8
  note: text('note'),
  date: date('date', { mode: 'string' }).notNull(),   // YYYY-MM-DD, Asia/Kolkata calendar date (§5.7)
  time: time('time', { mode: 'string' }).notNull(),   // Postgres TIME; reads back as HH:MM:SS (§5.6)
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  dateIdx: index('transactions_date_idx').on(t.date),
  memberIdx: index('transactions_member_id_idx').on(t.memberId),
  categoryIdx: index('transactions_category_id_idx').on(t.categoryId),
  // Keyset pagination cursor (§7.3) — must match the ORDER BY exactly, all four columns
  listCursorIdx: index('transactions_list_cursor_idx')
    .on(t.date.desc(), t.time.desc(), t.createdAt.desc(), t.id.desc()),
  // §5.2 invariant, enforced at the last line of defence
  tagInvariant: check(
    'transactions_tag_invariant',
    sql`(${t.type} = 'expense' AND ${t.tag} IS NOT NULL)
     OR (${t.type} = 'income'  AND ${t.tag} IS NULL)`
  ),
}));
```

**Note on `transactions.id`:** `defaultRandom()` is deliberately **removed**. Every insert supplies its own UUID — a random v4 from Quick Add, a deterministic v5 from the seed script. A database-generated random default would make seeding non-idempotent (§8.1).

```typescript
export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  month: text('month'),            // 'yyyy-MM' for one month; NULL = the every-month default (§6.7)
  categoryId: uuid('category_id').references(() => categories.id),  // NULL = total monthly budget (§6.7)
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),  // Read as string; see §5.8
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // one budget per (month, category) scope — NULLs collapsed via COALESCE
  scopeUnique: uniqueIndex('budgets_scope_unique')
    .on(sql`COALESCE(${t.month}, '')`, sql`COALESCE(${t.categoryId}::text, '')`),
}));

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),            // plain string; '1'/'0' for booleans (§6.7)
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**`app_settings`** is a tiny key-value store for global application settings. It currently
holds exactly one key: `exclude_bills_from_budget` (`'1'`/`'0'` — the global "exclude
bills from the total budget" toggle, §6.7). Read/written via `src/db/app-settings-mutations.ts`
(plain statements; upsert on conflict). No row for a key = off.

**Indexes:** `transactions(date)`, `transactions(member_id)`, `transactions(category_id)`, the composite `(date DESC, time DESC, created_at DESC, id DESC)` list cursor (§7.3), and `budgets_scope_unique` (§6.7).

---

## 5. Business Logic & Data Rules

### 5.1 Currency & Date Formatting
- **Currency:** Indian Rupees, Indian numbering system (lakhs/crores): `₹1,23,456.78`
- **Formatter:** `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`
- **Month cycle:** Calendar month, 1st–31st.

### 5.2 The Tag Triad (Strict Definitions)
Every **expense** carries exactly one tag. Income entries skip tags.

| Tag | Definition | Rule of Thumb | Examples |
|---|---|---|---|
| `recurring` | Fixed commitments that repeat automatically | "If it's an automatic bill → recurring" | WiFi, mobile recharge, insurance premiums, EMI, rent, LPG, school fees, Netflix, gym membership |
| `one_time` | Occasional, once-in-a-year / long-term purchases | Rare or capital purchases | Property registration, gold/silver, TV, hospital bills, annual celebrations |
| `lifestyle` | Everyday living + discretionary | "If it's a life choice → lifestyle" | Food, dresses, travel, movies, dining out, fuel, groceries |

**Enforcement (normative — all four layers required):**

| Layer | Mechanism |
|---|---|
| UI | Tag selector is mandatory for expenses; hidden and cleared for income (§6.2) |
| Zod | Discriminated union on `type`: `expense` requires a tag, `income` forbids one |
| Server Action | Re-validates the parsed payload before any DB write — never trusts the client |
| Database | `transactions_tag_invariant` CHECK constraint (§4.2) |

The column stays nullable in *type* because income legitimately has no tag; the CHECK makes `expense + NULL` and `income + tag` unrepresentable regardless of which code path writes the row.

**Tag is never inferred from category.** 9 of the 19 categories carry more than one tag in the historical data (e.g. `Property & Investments` is 17 `one_time` + 1 `recurring` — the Bhima EMI). Any logic that derives a tag from a category is wrong.

### 5.3 Category Seeds (19 Defaults — user-refined from real data)

**`seed.csv` is the source of truth for the seeded category set.** Its `category` column contains exactly these 19 strings.

**Immutable identity vs. mutable label — normative:**
- `slug` is the **permanent identity**. It is assigned once at seed time, is never edited by the user, is not exposed in Settings, and must never be changed by a migration.
- `name` is the **display label only**. The user may rename it freely in Settings (§6.5) with no effect on data integrity.
- All CSV ingestion (seed script §8, and any future import) resolves `category` → `slug` → `categories.id`. **Lookups never join on `name`.** This is what allows "Dining Out" to be renamed to "Restaurants & Food" while 205 historical transactions keep pointing at the same category row.
- **User-created categories (owner amendment, 18 Aug 2026):** the 19 slugs below are the *seed-time* set. Quick Add may create additional categories inline (§6.2/§6.5): the `slug` is generated from the name (slugified, deduplicated with a `-2`/`-3` suffix), remains immutable, and is never exposed; a color is picked deterministically from a palette and the category is appended at the end of the order. Re-seeding stays idempotent because the seed inserts only its 19 literal slugs (`onConflictDoNothing`).

The 19 slugs are fixed literals, listed here so no slugification algorithm can drift:

| # | `slug` (immutable) | `name` (initial, editable) | Emoji |
|---|---|---|---|
| 1 | `fuel` | Fuel | ⛽ |
| 2 | `travel-trips` | Travel & Trips | ✈️ |
| 3 | `clothing` | Clothing | 👗 |
| 4 | `kids` | Kids | 🧸 |
| 5 | `property-investments` | Property & Investments | 🏠 |
| 6 | `dining-out` | Dining Out | 🍔 |
| 7 | `groceries-household` | Groceries & Household | 🛒 |
| 8 | `insurance-finance` | Insurance & Finance | 🏦 |
| 9 | `health-medical` | Health & Medical | 🏥 |
| 10 | `education` | Education | 🎓 |
| 11 | `religion-gifts` | Religion & Gifts | 🎁 |
| 12 | `home-furniture` | Home & Furniture | 🛋️ |
| 13 | `vehicle-maintenance` | Vehicle Maintenance | 🔧 |
| 14 | `utilities-recharges` | Utilities & Recharges | 📱 |
| 15 | `farm-garden` | Farm & Garden | 🌱 |
| 16 | `entertainment-outings` | Entertainment & Outings | 🎢 |
| 17 | `personal-care-fitness` | Personal Care & Fitness | 💇 |
| 18 | `transport-parking` | Transport & Parking | 🚌 |
| 19 | `misc` | Misc | 📦 |

The seed script maps the CSV `category` string to a slug via **this table as a literal lookup map**, not via a runtime slugify function. The initial `name` values must match the CSV strings byte-for-byte; after seeding, `name` is the user's to change.

**Category deletion is out of scope for v1.** Settings permits rename, emoji change, and reorder only (§6.5) — the FK from `transactions.category_id` must never be left dangling.

### 5.4 Data Inclusion/Exclusion Rules (Derived from chat analysis)
| Rule | Handling |
|---|---|
| Spouse transfers ("Vinutha 2000", PhonePe to wife) | **EXCLUDED** — internal money movement, not consumption |
| Property / site payments / gold / silver | **INCLUDED** as expenses under "Property & Investments" |
| Oct 2023 birthday celebration (~₹84k) | Tagged **one_time**, category "Religion & Gifts" |
| Office spends (office tindi, office pooja) | **INCLUDED** as personal expenses (Misc) |
| Corrections in source data | Corrected value wins ("petrol 1050..not 150" → 1050; "Not 3026... 2564" → 2564) |
| Multi-item totals ("Total 9290") | Split into individual line items |

### 5.5 Known Recurring Commitments (from source data)
- ICICI term insurance: ₹2,564/month (was ₹3,026 before Oct 2025)
- Kotak term insurance: ~₹13,813/year (December)
- Bhima EMI: ₹2,000/month (since Aug 2026)
- Airtel internet: 4-month packs (~₹2,355–2,434)
- Mobile recharges: ~₹900/year per number (annual plans)
- Netflix ₹199/mo, JioHotstar/JioTV occasional
- School fees (Sarji): ₹44,000/year + art school ₹5,000/3 months

### 5.6 Time Handling (Minute Precision)

The app is minute-precision. Seconds are never meaningful and are never shown.

| Boundary | Format | Rule |
|---|---|---|
| `seed.csv` `time` column | `HH:MM` | Source format — **left as-is, not rewritten** |
| Storage (Postgres `TIME`) | `HH:MM:SS` | Native time type — sortable, indexable, comparable |
| Seed script (CSV → DB) | — | Append `:00` to every CSV time before insert |
| Quick Add (UI → DB) | — | Time picker emits `HH:MM`; append `:00` in the Server Action |
| Display (DB → UI) | `HH:MM` | Truncate seconds via `date-fns` `format(..., 'HH:mm')` |

**Why the column stays a real `TIME`:** storing clock time as `text` would lose ordering and range queries and force string surgery in every future report. Normalizing at the two write boundaries costs one line each and keeps the database correct.

### 5.7 Business Timezone (`Asia/Kolkata`) — Normative

The application's business timezone is **`Asia/Kolkata` (IST, UTC+05:30)**. It is a single exported constant (`APP_TIMEZONE`) and the only timezone the application reasons in. It is **not** read from the runtime environment.

**The hazard:** Vercel executes in **UTC**. A bare `new Date()` on the server resolves to UTC, so an expense logged at 01:30 IST is stamped as the *previous day, 20:00* — landing in the wrong day group, and on the 1st of a month, in the wrong month's totals entirely.

**Rules:**
1. **`new Date()` is prohibited for any business-date decision.** Every "now", calendar date, and boundary is derived through `APP_TIMEZONE` (`date-fns-tz` — `toZonedTime` / `fromZonedTime`).
2. The rule governs, without exception: Quick Add's default date and time (§6.2), "Today"/"Yesterday" grouping (§6.4), calendar-month boundaries (§5.1), the dashboard month picker (§6.3), every date-range query, and the 6-month trend (§6.3).
3. **Month boundaries** are computed in IST, then passed to SQL as plain `YYYY-MM-DD` strings compared against the naive `date` column.
4. `transactions.date` and `transactions.time` are **naive local values already in IST** — both the seeded history and Quick Add entries. They are never UTC and are never timezone-converted on read.
5. `created_at` is a UTC `timestamp` recording the **actual instant the database row was created** — an audit field. **It must never be used to derive a business date**, and its values must never be manufactured, back-dated or otherwise manipulated (see §7.3). It participates in the pagination ordering as written, never as a value engineered to make that ordering unique.

**Why naive columns are correct here:** the household is single-timezone. Storing IST wall-clock values directly keeps `date` comparable with plain date strings and keeps SQL aggregation (§7.2) free of per-row timezone conversion. `date-fns` remains the formatting library; `date-fns-tz` is added for zone-aware boundary math.

### 5.8 Monetary Representation — Normative

One representation, end to end. Mixing representations is the defect this section exists to prevent.

| Stage | Representation | Rule |
|---|---|---|
| Database | `NUMERIC(12,2)` | **Unchanged.** Exact decimal; holds the ₹12,00,000 maximum comfortably |
| Driver boundary | `string` | `pg` returns `numeric` as a **string** to avoid float corruption — never a number |
| Application | **integer paise** (`number`) | Convert at the boundary, immediately on read |
| Arithmetic | integer paise only | All sums, differences, percentages, chart values |
| Display | formatted rupees | Convert back only at the render edge |

**Rules:**
1. **Convert on read, at the DB boundary:** `Math.round(parseFloat(row.amount) * 100)`. No `+`, no `Number()` coercion, no implicit concatenation anywhere else. (`"1200000" + "20"` silently yields `"120000020"`.)
2. **All arithmetic is integer paise.** Never float rupees, never strings.
3. **Convert on write:** paise → a fixed-2-decimal string (`(paise / 100).toFixed(2)`) passed to `NUMERIC(12,2)`.
4. **Format only at the edge:** `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` over `paise / 100` (§5.1).
5. **SQL aggregation** (§7.2) sums the `NUMERIC` column natively — Postgres decimal arithmetic is already exact — and the aggregate is converted to paise once on read, by the same rule 1.

**Why integer paise and not a decimal library:** the largest single value is 1,20,00,000 paise and the entire 1,157-row history totals ~23.97 crore paise — both far below `Number.MAX_SAFE_INTEGER` (9.007 × 10¹⁵). Integer arithmetic is therefore exact with zero dependencies. A decimal library would add weight to every calculation path for no gained precision.

**Why `NUMERIC(12,2)` stays:** it is the correct storage type and needs no change. All 8 decimal-bearing rows in `seed.csv` fit scale 2 exactly. The defect was never the column — only the application's implicit trust in JavaScript coercion.

---

## 6. UI/UX Specifications

### 6.1 Global Layout
- **Header:** App Logo/Title (left), Member Switcher Dropdown (right), Settings icon (far right).
- **Bottom Navigation (Mobile):** Dashboard · Transactions · **Quick Add (center, prominent FAB)**.
- **Theme:** Light by default; clean, minimal; shadcn/ui default palette. **Dark mode is permitted in v1.2** (owner amendment, 15 Aug 2026 — removed from the §11 exclusion list): a sun/moon toggle in the header switches between light and dark, the first visit defaults to the user's **system preference**, and the choice persists locally. The implementation is class-based (`next-themes` with a `.dark` variable block in `globals.css`); no redesign of the theme system is authorized.

### 6.2 The "Quick Add" Flow (Critical Path — optimize ruthlessly)
One-handed mobile use, < 5 seconds, **one bottom sheet**:
1. **Trigger:** Large Floating Action Button with `+`.
2. **Sheet header (Amendments 10–12):** above the fields, a grip handle and a header row
   with two controls — an **Add transaction** button (a filled pill, wired to the exact
   same `submit()` as the footer CTA below — same validation, same optimistic create) and
   the **member chip**, which is a real dropdown: tapping it switches the app-wide active
   member (§3.2) via the same `updateActiveMember` Server Action as the global header
   switcher, applied optimistically and reverted if the switch fails.
3. **Date/Time:** pickers default to *now* **in `Asia/Kolkata`** (§5.7); the time is normalized `HH:MM` → `HH:MM:00` (§5.6). They sit at the very top, collapsed behind a compact summary („Today · 14:32“, or „Yesterday · 14:32“, or „12 Aug 2026 · 14:32“ once the date is more than a day away, with a pencil) that reveals the pickers when tapped — the defaults are rarely changed, so the frequently edited fields stay together below. **The collapsed/expanded choice no longer persists (Amendment 11, 19 Aug 2026)** — every open of the sheet starts collapsed on today's date and the current time, on every device; tapping it open keeps it expanded only for the rest of that tab's session. *(Superseded: the choice previously persisted per device in `localStorage` — see `CHANGELOG.md`.)*
4. **Amount + Tag row (Amendment 10, 19 Aug 2026):** the Amount input and the Tag selector share one `flex` row rather than stacking. **Amount** is a ₹-prefixed text input (`flex-1`, mobile decimal keypad) that sanitizes on every keystroke to a value that always fits `NUMERIC(12,2)` — digits and at most one decimal separator, at most 2 decimal digits, at most 10 integer digits — and is captured as integer paise (§5.8). **Tag** is a compact 2×2 cluster beside it: the currently selected tag renders large in the left column (spanning both rows, defaults `lifestyle`, then remembers the last committed tag — §5.2; `recurring` flags bills), with the other two tags stacked as small tap-to-swap buttons in the right column — tapping one swaps it into the selected slot. A live `≈ ₹` preview (or "Enter a valid amount" once a submit was attempted with none) renders under the row.
5. **Note (optional):** a single-line text input, 140 characters max — remembers the last committed note, so repeat entries (recharges, EMIs, rent) start with both the tag and note already filled in; the remembered tag/note live per-device in `localStorage` and are updated only on a successful commit (amount, category, date and time are never remembered).
6. **Category:** grid of categories (name only, no emoji — Amendment 9) with per-category remaining-budget hints (§6.7) — tapping **selects** the category (highlighted, with a check); it no longer commits. Recently used categories float to the top of the grid (per-device `localStorage`, recorded on each successful commit — the edit-transaction dialog's grid orders the same way and records usage on edit saves); never-used categories keep the manual order from Settings (§6.5). When a note is typed, the grid shows up to **6 suggested categories** instead of the full grid — scored from the note's words against a curated keyword map per seed category plus the category names (an already-selected category stays pinned on top); clearing the note, or a note with no matches, falls back to the full grid; a **"Show all categories"** link next to the hint text expands back to the full grid and resets whenever the note changes. A **＋ Add** tile (dashed pill, at the end of the grid) opens an inline emoji + name form that creates the category (§5.3/§6.5) and immediately selects it — the edit-transaction dialog offers the same tile via the shared `useCreateCategory` hook.
7. **Submit:** the sticky footer **Add transaction** button (pinned at the bottom, enabled once an amount and category are set) triggers the Server Action → optimistic UI update → toast confirmation. **Its label is dynamic (Amendment 10):** once valid it reads e.g. **"Add ₹1,250 · Dining Out"** (whole rupees, no decimals — `formatINRWhole`); while invalid it reads "Add transaction" and a small helper line above it names what's missing ("Enter an amount and pick a category" / "Enter an amount" / "Pick a category"). The fields live in a real `<form>`, so **Enter** submits once the form is valid; once valid, the helper line instead reads "press Enter ↵ to add". The `member_id` is read from the `active_member_id` cookie and validated against `members` (§3.2.1).

> **Single-page flow is normative — owner amendment, 18 Aug 2026.** The earlier normative sequence **Amount → Details → Category** (owner amendment, 15 Aug 2026 — category tap was the committing step) is **superseded**: all fields now live on one scrollable sheet and the category tap only selects. The 16 Aug 2026 one-tap **"It's a bill"** shortcut (whose purpose was to skip the Details step) is removed along with the full-screen numpad. *(Same-day field order, owner request: **Date/Time** moved to the top — collapsed behind a „Today · 14:32“ summary in Quick Add, with a pencil revealing the pickers — followed by **Amount → Tag → Note → Category**; the edit-transaction dialog mirrors the same Date/Time-first order.)* See `CHANGELOG.md`.
>
> **Amount+Tag row, member switch, dynamic CTA — owner amendment, 19 Aug 2026
> (Amendments 10–12).** Step 3 (Amount) and step 4 (Tag) above from the 18 Aug pass are
> **merged into one row** (step 4 above) — the two fields no longer stack. **Note**
> (step 5) changes from a multi-line field to a **single-line, 140-character input**,
> so the `Cmd/Ctrl+Enter`-in-the-note carve-out from the 18 Aug amendment no longer
> applies — a plain **Enter** now submits from every field, note included. The sheet's
> own header gains a **member-switch dropdown** and an **Add transaction** button wired
> to the same submit path as the footer CTA (superseding the earlier plain `<h2>` heading
> and non-interactive member badge). See `CHANGELOG.md`.

### 6.3 Dashboard View
- **Header:** Month/Year picker (e.g., "August 2026"). Month boundaries computed in `Asia/Kolkata` (§5.7).
- **Summary Cards (expense-focused, owner iteration 16 Aug 2026):** Expense · Top category ·
  Lifestyle spend · **Bills** · Largest spend. Bills is the month's `recurring`-tagged total
  with its entry count (§5.2, §6.7 — the same figure the budget can exclude). Every card
  links to the Ledger pre-filtered to the transactions it describes: `type=expense`,
  `category=<topCategoryId>`, `tag=lifestyle`, `tag=recurring`, or `category=<id>&q=<note>`
  for the largest single spend.
- **Tag Breakdown row:** "₹X in bills · ₹Y in lifestyle · ₹Z in one-time buys" — 3 progress bars with %.
- **Category Pie Chart:** Recharts PieChart of expense distribution.
- **Member Split:** Horizontal bar chart (Dad vs Mom vs Son).
- **6-Month Trend:** Line chart comparing monthly totals — the expense line (red) and
  income line (green) plotted together, so income vs expense is visible as the gap
  between them. (The standalone **Income / Net savings cards were removed** in the
  expense-focused iteration, 16 Aug 2026 — the summary strip is now Expense · Top
  category · Lifestyle spend · Bills · Largest spend.)

All figures come from SQL aggregates (§7.2), never from client-side reduction over a fetched table.

#### 6.3.1 Zero-State & Zero-Denominator Behavior — Normative
The seeded history contains **no income rows and no `Son` rows**, so these states are the *default* first experience, not a rare edge case. `NaN%`, `Infinity%`, `-0`, `0/0`, and blank cards are all defects.

**Universal percentage rule:** every percentage in the app is computed as — *if `denominator === 0`, render the em-dash `—` and hold the bar/segment at 0% width; otherwise compute normally.* No percentage may divide without this guard.

| Metric | When income = 0 | When the month has no transactions at all |
|---|---|---|
| Total Income | `₹0.00` (a real, correct value — never blank) | `₹0.00` |
| Total Expense | Normal expense total | `₹0.00` |
| Net Savings | The **negative expense total**, styled red — never a percentage, never "−∞%", never "0%" | `₹0.00`, neutral styling |
| Savings rate (if shown) | `—` (denominator is income) | `—` |
| Tag breakdown bars | % of **total expense**, not of income — so these render normally | All three at 0% with `—` labels |
| Category pie | Normal | Empty-state card: "No expenses this month" — not a zero-slice chart |
| Member split | Members with zero (incl. `Son`) render an explicit `₹0.00` row at 0% width — never omitted, never `NaN` | All members at `₹0.00` |
| 6-month trend | Months with no data plot as **`0`, not a gap** — the axis stays continuous | Same |

**Note:** the tag-breakdown denominator is *total expense*, never income. With no income rows this is the difference between a working dashboard and three broken bars.

**Note on the removed cards (16 Aug 2026):** the **Total Income** and **Net Savings** rows
above governed the income/net summary cards, which the expense-focused owner iteration
removed from the dashboard (§6.3). Income survives only as the 6-month trend's income
line, which follows the trend row below (plots `0` for income-less months — never a gap).
The rows above are retained for the record and for any future income-driven surface.

### 6.4 Transactions List View
- **Month strip:** a horizontally scrollable strip of the last **36 months** (IST, §5.7)
  plus **All** — quick month navigation. The `month` filter is URL-driven
  (`?month=yyyy-MM`); tapping a month **preserves every other active filter**, and
  **All** clears it (also reaching anything outside the window).
- **Summary header:** directly under the strip, one card summarizing **exactly the
  filtered set** — month + member + category + tag + type + search — showing **Expense ·
  Lifestyle spend · Largest spend** and the entry count. Expense-focused by owner
  iteration (16 Aug 2026): income and net-savings were dropped, replaced by lifestyle
  and the largest single spend, mirroring the dashboard's summary cards (§6.3). With no
  month selected it reports the all-time totals. Computed by a single SQL pass
  (`getLedgerSummary`) over the **same `WHERE` clause as the list**, so the numbers
  describe exactly what the filters describe — never just the visible page.
- **Grouping:** By date ("Today", "Yesterday", "12 Aug 2026") — all three resolved in `Asia/Kolkata` (§5.7).
- **List Item:** Emoji · Category · Note (truncated) · Member avatar · **₹Amount** (red=expense, green=income).
- **Interactions:** Swipe-left delete (§6.4.1), tap to edit. **Edit sheet (Amendment 12,
  19 Aug 2026):** tapping a row opens a **bottom sheet matching Quick Add's shell** —
  grip handle, a header row with an **Edit transaction** pill button (saves — same
  submit path as the sticky footer CTA) and a **member-reassignment dropdown chip**,
  the same field order as Quick Add (Date/Time → Amount+Tag row → Note → Category, §6.2)
  inside a scrollable body, and a sticky footer with a dynamic **"Save ₹1,250 · Dining
  Out"** CTA. The member chip here reassigns *this transaction's* member — a local,
  validated form field, distinct from the app-wide `active_member_id` cookie that Quick
  Add's chip switches (§3.2.1, `SPEC_AMENDMENT_7_MEMBER_REASSIGNMENT.md`) — and the
  standalone "Member" select row from the 18 Aug layout is gone now that it lives in the
  header. **Delete** is a small icon button beside the sticky Save button, triggering the
  same swipe-left undo flow (§6.4.1). *(Supersedes the centered-modal `Dialog`
  presentation used before 19 Aug 2026 — see `CHANGELOG.md`.)*
- **Filters:** URL-driven pill toggles for Member, Category, Tag, **Type** (`income` /
  `expense`) and Month, plus search — every filter (and the month strip) writes to the
  URL (`?member=…&category=…&tag=…&type=…&month=…&q=…`), so filtered views are shareable
  and server-rendered. **Filtering, sorting and paging all execute in SQL** (§7.3) —
  never in the browser over a fully-fetched table.
- **Budget bar:** when a month is selected, a spent-vs-budget bar renders directly under
  the strip (§6.7) — month-scoped, ignoring the list's other filters.
- **Paging:** Keyset pagination on the strict total order `date DESC, time DESC, created_at DESC, id DESC`, infinite scroll (§7.3). The same ordering is used by the list query and the cursor comparison.
- **CSV Export button** (§6.6).

#### 6.4.1 Delete with Undo (~5 seconds) — Normative
Swipe-left delete on a device that gets handed between family members makes accidental deletion realistic. A confirmation dialog is rejected: it taxes every *intentional* delete to guard the rare accident, which contradicts the speed-first philosophy (§1).

**Mechanism:**
1. Swipe-left removes the row **optimistically from the UI only**. No Server Action fires yet.
2. A toast appears — "Transaction deleted · **Undo**" — with a ~5-second timer.
3. **Undo tapped:** the timer is cancelled, the row reappears in place. **No database write ever occurred**, so there is nothing to restore.
4. **Timer lapses (or the toast is dismissed):** `deleteTransaction(id)` fires and the row is **hard-deleted**.
5. **Navigation or unmount before the timer lapses:** the pending delete is flushed immediately (fires the action) rather than being silently abandoned. A row must never appear deleted while remaining in the database.

**No soft delete.** No `deleted_at` column, no tombstones, no restore UI, no filtering of deleted rows from queries. The undo window lives entirely in client state before the write, which is precisely why it costs no schema, no query complexity, and no scope growth.

### 6.5 Settings
- Manage categories: **create (inline from Quick Add or the edit dialog, §6.2), rename, emoji, reorder**. The `slug` (§5.3) is immutable and is not exposed in the UI. Category **deletion is not offered in v1** (§5.3). New categories appear in this list **immediately** — it live-syncs whenever the server-side category set changes — and are flagged in a small **„Recently created“** strip at the top (per-device `localStorage`, a convenience hint only). *(The "rename, emoji, reorder only" wording is superseded by Amendment 8 — 18 Aug 2026; see `CHANGELOG.md`.)*
- **Family password (environment-managed — owner amendment, 15 Aug 2026):** the password is `FAMILY_MASTER_PASSWORD`, an environment variable supplied via `.env.local` / the deployment platform (§9). The application provides **no in-app password-change facility in v1.2**; changing the password is an **environment/deployment administration operation** (update the env var on the deployment platform and redeploy). No credentials table, password database, password-management subsystem, or deployment-control architecture exists or is authorized.
- Member list: **name, emoji, colour and order editable**. The member `slug` (§3.2.2) is immutable and is **not exposed in the UI**. Member **deletion is not offered in v1** — the FK from `transactions.member_id` must never be left dangling.
- **Budgets (owner amendment, 16 Aug 2026):** a Budgets card edits monthly limits — total and/or per-category, scoped to one month or to "Every month" as the default (§6.7). The card also carries the global **"Exclude bills from budgets"** switch — recurring-tagged spend is then ignored by the total monthly limit (§6.7).

### 6.6 Canonical CSV Export — Normative

The export uses the **same 8 columns, in the same order, as `seed.csv`**:

```
date,time,member,type,item,amount,category,tag
```

| Field | Export rule |
|---|---|
| `date` | `YYYY-MM-DD`, as stored (IST calendar date, §5.7) |
| `time` | **`HH:MM`** — seconds truncated, matching the CSV convention (§5.6) |
| `member` | Member's **current display `name`** |
| `type` | `expense` \| `income` |
| `item` | The transaction's `note` field (the CSV's `item` column maps to `note`) |
| `amount` | Plain decimal, 2 dp, **no `₹` symbol, no thousands separators, no `en-IN` grouping** (e.g. `1200000.00`) |
| `category` | Category's **current display `name`** |
| `tag` | `one_time` \| `recurring` \| `lifestyle`; **empty string** for income rows |

**Normalization:** UTF-8, LF line endings, header row always emitted, rows ordered `date ASC, created_at ASC`. Any field containing a comma, double-quote or newline is RFC 4180 quoted — the export must remain correct even though the historical `seed.csv` happens to need no quoting.

**Scope of the symmetry — read carefully:** the export is *structurally compatible* with `seed.csv`, which makes it a genuine backup format and a valid input shape. It is **not** a claim that an export may be fed back through `npm run db:seed`. Seeding remains an explicit, controlled, developer-initiated operation against the canonical `seed.csv` (§8) — never an automatic round-trip, and never a synchronization mechanism.

**Note on the `member`/`category` columns:** they export *current display names*, which may since have been renamed (§3.2.2, §5.3, §6.5). This is correct for a human-readable backup. It also means an export is not guaranteed to re-import against the literal slug maps in §3.2.2 and §5.3 if members or categories have been renamed — another reason the round trip is not automatic.

### 6.7 Budgets — owner amendment 16 Aug 2026 (§4.2, §6.5, §11)

> **Budget limits + over-budget alerts was in the §11 v1 exclusion list.** The owner
> explicitly authorized budgets as a v1.2 feature on 16 Aug 2026; this section is the
> resulting specification (recorded in `CHANGELOG.md`). All other §11 exclusions stand.

**Model:** one `budgets` row per **(month, category)** scope (§4.2):

- `month` is `'yyyy-MM'` for a single month, or `NULL` for the **default that applies to
  every month**.
- `categoryId` is `NULL` for the **total monthly budget**, or a category id for a
  **per-category limit**.
- `amount` follows the §5.8 paise representation (`NUMERIC(12,2)` storage, integer-paise
  arithmetic at the boundary).

**Effective budget for a month:** the exact-month row wins; otherwise the `NULL`-month
default applies. Applied identically to the total and to each category.

**Settings (§6.5):** the Budgets card edits one scope at a time — "Every month" or a single
month — with a total limit input and per-category limit inputs. The per-category list renders
directly from the current category set, so a category created inline (Quick Add / edit
dialog, §6.2) appears there automatically after the cache revalidation. Empty inputs mean no
limit.
Saving replaces the whole scope by delete-then-insert — plain sequential statements, since the
app's neon-http driver has no transaction support — so `budgets_scope_unique` can never be
violated by the app. Replacement is **intentionally non-atomic**, a documented reliability
characteristic of the chosen driver: if the insert fails after the delete, the scope is left
empty (no budget for that month) rather than half-written — and the uniqueness index means a
partial write can never produce duplicate rows. This is an accepted, owner-approved
characteristic (Phase-2 audit F2-02), not a defect to be redesigned.

**Exclude bills (global toggle, owner decision):** a single app-wide switch (stored as
`exclude_bills_from_budget` in `app_settings`, §4.2) makes **every total-budget comparison
ignore the month's recurring-tagged spend** — the dashboard Budget card, the ledger month
strip, and the over-budget toast all compare *discretionary spend* (total expense −
recurring) against the total limit, and show a small "excluding ₹X in bills" note when the
toggle is on. **Per-category budgets always count everything** — the exclusion applies to
the total budget only (owner decision). The recurring tag itself (§5.2) and the "₹X in
bills" tag-breakdown row (§6.3) already identify bills; this toggle decides whether they
count against the limit.

**Dashboard (§6.3):** a Budget card shows spent vs the effective total budget with a progress
bar, "₹X left / ₹X over" (green/red), plus an **inline edit/clear shortcut** (pencil → set
a new total for that exact month or clear it, without touching category budgets).
Per-category budget bars live inside the **Spending by category** card, next to the spend
they constrain. No budget set → a "Set one in Settings" link. Zero-denominator safety per
§6.3.1: a zero budget renders an empty bar, never a division by zero. **Bar rendering:** the
fill's colour ramps **deep green → deep red** across the band (0% → 100% of the budget);
when spent exceeds the budget the **band shrinks** to make room for a **deep-red overflow
segment**, so the amount over is visible as bar length (fill + overflow always fit the bar,
never overflowing its container) — not just a colour flip. A small **tick marks the 100%
point** (the budget limit): the bar's right edge under budget, the band/overflow boundary
when over.

**Ledger month strip (§6.4):** when a month is selected, the ledger shows a spent-vs-budget
bar directly under the strip — the month's total expense against the effective total
budget, with "₹X left / ₹X over" (green/red), computed server-side via
`getMonthBudgetStatus`. No total budget for the month → no bar. The bar is month-scoped
and ignores the ledger's other filters (member/category/tag/search), since budgets are
per-month.

**Quick Add hints (§6.2/§6.7):** on the category grid, each category that has a budget for
the transaction's month shows its **remaining** amount underneath („₹X left" in green,
„₹X over" in red). Computed client-side via the `getCategoryBudgetStatus` Server Action
against the chosen date's month, so it stays correct when the user backdates.

**Over-budget toast (§6.7):** after an expense is created or edited, the Server Action
checks the post-write month total and the affected category's total against the effective
budgets. If either is over, the action returns an alert (`{ kind: 'total' | 'category',
overPaise, limitPaise, ... }`) and the client shows a warning toast — "This month is over
budget — ₹X past the ₹Y limit" (or per-category). One alert per write, the total wins over
the category. This is a client-side, in-app alert only — no email/telegram notifications.

**Server action:** `saveBudgets(raw)` — Zod-validated (§7.1), replaces the scope via
`replaceBudgetScope` (delete-then-insert, `src/db/budget-mutations.ts`), `revalidatePath('/')`
+ `revalidateTag('transactions')`.

---

## 7. Server Actions & Data Fetching

No traditional REST API routes for mutations. Use Next.js **Server Actions**.

### 7.1 Core Server Actions
- `createTransaction(data: z.infer<typeof transactionSchema>)`
- `updateTransaction(id: string, data: ...)`
- `deleteTransaction(id: string)`
- `updateActiveMember(memberId: string)`

**Every mutating action must, before any write:**
1. Parse its payload with Zod — including the `type`/`tag` discriminated union (§5.2).
2. Verify the `member_id` exists in `members` (§3.2.1 — data integrity, *not* authentication).
3. Convert amounts to/from integer paise at the boundary (§5.8).

### 7.2 Data Fetching & Aggregation — Normative
- React Server Components fetch directly with Drizzle `db.select()` + `where` clauses.
- `revalidatePath('/')` and `revalidateTag('transactions')` inside all mutation actions.
- **All dashboard analytics are computed in SQL** — `SUM`, `COUNT`, `GROUP BY`, date-range `WHERE` — and return pre-aggregated rows. Fetching transactions and reducing them in JavaScript is prohibited, on the server as well as the client.
  - Category pie → `GROUP BY category_id`
  - Member split → `GROUP BY member_id`
  - Tag breakdown → `GROUP BY tag`
  - 6-month trend → `GROUP BY` month over an IST-derived 6-month range (§5.7)
- Aggregate results are converted from `NUMERIC` strings to integer paise once, on read (§5.8).
- **Rationale:** the table opens at 1,157 rows and grows ~300/year. Shipping it to the client to compute a pie chart wastes the payload, the memory and the battery of the phone this app is built for.

### 7.3 Pagination — Normative

The transactions list uses **keyset (cursor) pagination**, never `OFFSET`. The ordering is a **strict total order** — no two rows can ever compare equal.

**Canonical ordering (used identically by the list query and the cursor comparison):**

```sql
ORDER BY
    date       DESC,
    time       DESC,
    created_at DESC,
    id         DESC
```

**Cursor:** the complete tuple `(date, time, created_at, id)` of the last row on the page. All four components are mandatory; a partial cursor is invalid.

**Index:** `transactions_list_cursor_idx` on `(date DESC, time DESC, created_at DESC, id DESC)` (§4.2) — it must match the `ORDER BY` exactly, column for column and direction for direction.

**Why each column is present:**

| Column | Role |
|---|---|
| `date` | The business date — the primary user-visible ordering (§5.7) |
| `time` | The recorded message-log / business time. It participates in natural transaction ordering, so the list reads chronologically within a day |
| `created_at` | Distinguishes rows created at different actual instants — the audit timestamp, used as written |
| `id` | The **final guaranteed-unique tiebreaker**. `id` is the primary key and therefore unique within the transactions table, so even rows identical in `date`, `time` and `created_at` retain a strict, stable order |

- **Page size:** 50, appended by infinite scroll.
- Filters and search compose into the same SQL `WHERE` clause — the client never receives unfiltered rows and never pages in memory.
- **Why keyset, not `OFFSET`:** `OFFSET` degrades linearly as history grows and can skip or repeat rows when a transaction is inserted mid-scroll.
- **Why four columns and not two:** ~40 seeded rows can share one `date` *and* one message-log `time` (§8.2, §8.3), and the entire seed is written by a single bulk insert whose `created_at` values are near-identical. Without `id`, two rows could compare equal at a page boundary and be skipped or repeated. `id` closes that hole permanently.

> **`created_at` is never manufactured.** It remains the actual database creation/audit timestamp for every row, seeded or user-entered (§5.7 rule 5). Assigning synthetic `created_at` values to make pagination deterministic was explicitly **rejected** — uniqueness is achieved by adding `id` to the ordering, not by corrupting the meaning of an audit column.

---

## 8. Seed Data Strategy (`seed.csv`)

The repo includes a `seed.csv` file containing **1,157 historical transactions** (23 Nov 2022 → 12 Aug 2026) extracted from the family's WhatsApp expense log (English + Kannada).

**CSV Columns:** `date,time,member,type,item,amount,category,tag`

**Audited structure (verified 12 Aug 2026 against the file itself):** 1,158 lines = 1 header + 1,157 data rows; exactly 8 fields on every row; no quoting, no embedded commas, no CRLF, no empty or whitespace-padded fields; ASCII only; sorted ascending by date with zero out-of-order rows; all amounts positive and within `NUMERIC(12,2)`; all dates `YYYY-MM-DD`; all times `HH:MM`; all tags valid enum members; 19 distinct categories; every row `type=expense`.

> ⚠️ **Counting caveat.** `seed.csv` has **no trailing newline**, so `wc -l` reports 1,157 — one short — because it counts newline *characters* and the final row is unterminated. The correct count is obtained with a record counter such as `awk 'END{print NR}'` (1,158 incl. header). **1,157 is the canonical data-row count.** This exact miscount produced the erroneous "1,156" figure in spec v1.1; see `CHANGELOG.md`.

**Seed Script Logic (`npm run db:seed`):**
1. Read `seed.csv`, **preserving each row's verbatim raw source line before parsing** (§8.1 Implementation Requirement), then parse that same line's fields.
2. Map `member` string ('Dad'/'Mom') → `slug` via the literal table in §3.2.2 → UUID from `members` table. **Never join on `members.name`.**
3. Map `category` string → `slug` via the literal table in §5.3 → UUID from `categories` table. **Never join on `categories.name`.**
4. Parse `date` (already `YYYY-MM-DD`, pass through) and normalize `time` from `HH:MM` → `HH:MM:00` before insert (§5.6).
5. Compute each row's deterministic `id` per §8.1, hashing the **preserved raw line** — never a line reconstructed from parsed fields.
6. Convert `amount` to the storage form per §5.8.
7. Bulk insert into `transactions` with Drizzle `onConflictDoNothing()`, which now conflicts on the **primary key** (§8.1).

### 8.1 Deterministic Seed Identity — Normative

Transaction IDs for seeded rows are **content-addressed**, computed from the CSV itself:

```
id = uuidv5(SEED_NAMESPACE, rawCsvLine + "\u001F#" + occurrenceIndex)
```

| Component | Definition |
|---|---|
| `SEED_NAMESPACE` | A single fixed UUID constant, generated once and hard-coded in the seed script. Never changed — changing it re-IDs the entire history |
| `rawCsvLine` | The **verbatim source line**, minus its line terminator. No re-serialization, no trimming, no field normalization, no reordering. The file is audited clean, so the raw line *is* the canonical form |
| `\u001F` | ASCII Unit Separator (written as the escape, never as a raw byte) — cannot occur in the ASCII-only source data, so the ordinal can never be confused with row content |
| `occurrenceIndex` | The count of **byte-identical prior lines** in the file. `0` for every row except the second member of each exact-duplicate pair (§8.2), which is `1` |

#### Implementation Requirement — Raw Line Preservation (normative)

The loader **must preserve the original raw CSV line before parsing** and hash **that exact source-line text**. It must **not** parse the CSV and then reconstruct a line for hashing.

**Required pipeline — order is mandatory:**

```
raw source line
    ↓  preserve exact raw line  (verbatim bytes, minus line terminator)
    ↓  parse CSV fields         (from the same line)
    ↓  compute UUIDv5 from the preserved raw line + occurrenceIndex
    ↓  insert parsed fields
```

**Why reconstruction is prohibited:** §8.1 defines `rawCsvLine` as the *verbatim source line*. A re-serialized line is a different artifact — any difference in field order, spacing, quoting policy, decimal rendering (`100` vs `100.00`), or parser trimming silently produces a different UUID, and the "identical CSV → identical IDs" guarantee collapses. The hash input must never round-trip through the parser.

**Practical consequence for the implementation:** the CSV must be read in a mode that exposes the raw line alongside the parsed record (for example, reading the file line-by-line and parsing each line individually, rather than handing the whole file to a parser that yields only field objects). Parsing and hashing read the *same* line; hashing does not read the parser's output.

**Properties this guarantees:**
- Identical CSV input → identical IDs, on every machine, every run. No clock, no randomness, no database round-trip.
- The two legitimate exact-duplicate pairs (§8.2) receive **different** IDs and remain two rows.
- **Stable under reordering or insertion.** The ordinal is scoped to the duplicate group, not to file position, so adding a backdated row does not shift any other row's ID. Within a group the two members may swap which is `#0` and `#1`, but since they are byte-identical that swap is unobservable.
- `onConflictDoNothing()` finally has a real conflict target (the PK), so re-running is a genuine no-op.
- **No business-field unique constraint and no additional column** are required.

#### 8.1.1 Scope of Idempotency — Read Before Relying On It

> **The seed operation is idempotent for an unchanged canonical `seed.csv`. It is not a synchronization mechanism, and it does not detect edits to — or deletions of — previously seeded rows.**

Consequence, stated explicitly: **if an existing CSV row is later edited** (say a corrected amount), its content-derived UUID changes. A subsequent seed run therefore **inserts the corrected row while leaving the previous database row untouched**, and both will exist. The same applies to a row removed from the CSV — its database row remains.

This is **accepted for v1**, because seeding is an explicit, controlled, developer-initiated operation, not an automatic pipeline or a sync system. Reconciling an edited CSV is a manual operation.

**Prohibited resolutions:** no `source`/`seed_origin` column, no import-batch table, no `deleted_at`, and no schema addition of any kind introduced solely to solve this edge case. If true synchronization is ever required, it is a new specification — not an incremental widening of the seed script.

### 8.2 Verified Intentional Duplicates — Do Not Deduplicate

The 12 Aug 2026 audit found exactly **two pairs of byte-identical rows**. Both were investigated and **confirmed intentional**. They are genuine separate line items and **must never be collapsed, deduplicated, or "cleaned"** — by a migration, a seed script, an import routine, or a future agent.

| Lines | Row |
|---|---|
| 157 & 169 | `2024-09-16,21:49,Dad,expense,Mysore car parking,40,Travel & Trips,lifestyle` |
| 541 & 543 | `2025-08-06,19:19,Mom,expense,Fruits,100,Groceries & Household,lifestyle` |

**Evidence:** neither pair is adjacent — each is separated by other distinct items inside the same timestamp block, which is the signature of transcription from a single multi-item WhatsApp message rather than a copy-paste error. The Mysore block independently contains `Mysore parking,30` (a third, differently-priced parking payment) and `Mysore kanike` three times at ₹800/₹200/₹450. Because timestamps are **message-log times, not spend times** (§8.3), a shared timestamp is no evidence of duplication.

A third pair — `2025-05-13 Petrol ₹1,000` at `06:28` and `22:37` — differs by time and is therefore already distinct; two fills in one day across two cars and a bike is ordinary.

**This is why the identity scheme in §8.1 carries an occurrence ordinal instead of hashing business fields.** A key of `date+time+item+amount+member` was explicitly considered and **rejected**: it would silently merge these four rows into two and would delete real data whenever the family buys the same thing twice at the same logged minute.

### 8.3 Notes on Seed Data
- No income entries exist in the source — app starts expenses-only. Every row is `type=expense`. See §6.3.1 for the resulting dashboard zero-states.
- Only `Dad` and `Mom` appear as members (904 / 253); `Son` has no historical rows but is still seeded and must render as `₹0.00`, never omitted (§6.3.1).
- All spouse transfers already excluded; corrections already applied.
- Times are message-log timestamps in `HH:MM` — **not** precise spend times; dates are actual spend dates. Roughly 40 rows can share a single `date`+`time`, and the whole seed lands in one bulk insert with near-identical `created_at` values — which is why the pagination order terminates in `id` (§7.3).
- `seed.csv` has no trailing newline — the parser must still emit the final row (and see the counting caveat above).
- The 19 category strings in the CSV are authoritative for the initial seed; ingestion resolves them through the literal slug map (§5.3).
- 8 rows carry paise (2 dp); all others are whole rupees. Total historical spend: ₹23,96,855.39.
- **`seed.csv` is immutable.** It is the source of truth and must not be edited, reordered, deduplicated, re-sorted, or given a trailing newline. Every discrepancy found in the 12 Aug 2026 audit lay in this document, never in the data.

---

## 9. Environment Variables & Secret Management

### 9.1 Required Environment Variables

**Placeholders only. This document must never contain a real value.**

```env
DATABASE_URL="postgresql://..."
AUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
FAMILY_MASTER_PASSWORD="..."
```

`APP_TIMEZONE` (§5.7) and `SEED_NAMESPACE` (§8.1) are **hard-coded constants, not environment variables**, exactly as specified in those sections. `SEED_NAMESPACE` in particular must never become configurable — a misconfigured value would silently re-ID the entire transaction history.

### 9.2 Secret Management — Normative

The application uses **Neon PostgreSQL**. The database connection string is supplied **exclusively** through the `DATABASE_URL` environment variable.

**Actual secret values MUST NOT be committed to the repository or documented in** `SPEC.md`, `CHANGELOG.md`, `README.md`, `.env.example`, source code, generated documentation, or client-side code.

- **Local development** uses `.env.local`.
- **Production / Vercel deployments** receive secrets through the deployment platform's environment-variable configuration.
- **`.env.example` may be committed, but MUST contain placeholders only.**

`FAMILY_MASTER_PASSWORD` is a secret and follows **the same non-commit / non-documentation rule** as `DATABASE_URL` and `AUTH_SECRET`.

`DATABASE_URL` and `FAMILY_MASTER_PASSWORD` are **server-only**. Neither may be exposed to the browser, prefixed with `NEXT_PUBLIC_`, embedded in a Client Component, or returned from a Server Action.

### 9.3 Environment File Convention

| File | Contents | Git |
|---|---|---|
| `.env.local` | **Real** local development secrets | **Gitignored — never committed** |
| `.env.example` | **Placeholders only** | Safe to commit |

**`.env.local`** — real values, never committed:

```env
DATABASE_URL="<real local Neon connection string>"
AUTH_SECRET="<real secret>"
NEXTAUTH_URL="http://localhost:3000"
FAMILY_MASTER_PASSWORD="<real secret>"
```

**`.env.example`** — placeholders only, safe to commit:

```env
DATABASE_URL="postgresql://..."
AUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
FAMILY_MASTER_PASSWORD="..."
```

`.gitignore` must cover `.env.local` (and any other real-value env file) before the first commit that could contain one.

### 9.4 Neon CLI — Optional Development Tooling, Not an Architectural Dependency

The **Neon CLI is supported and preferred** for project integration during development:

```bash
npx neonctl@latest init
```

It may also be used for project/branch linking and environment management during development.

**The distinction is normative and must not be blurred:**

| | Status |
|---|---|
| **Neon PostgreSQL** | **Required infrastructure** |
| **Neon CLI (`neonctl`)** | **Optional development / project-integration tooling** |
| **Application runtime** | **Does not depend on the Neon CLI** |

The running application connects **only** through `DATABASE_URL` using `@neondatabase/serverless` (§2). `neonctl` is never a runtime dependency, never imported by application code, never required by the build, and never needed for deployment. A developer who provisions Neon through the web console is fully supported.

### 9.5 Secret Handling by AI Coding Agents — Normative

This project is developed with AI coding agents, so the rule is stated explicitly rather than assumed:

**Database credentials and application secrets MUST NOT be copied into source files, documentation, prompts/instructions, generated artifacts, logs, or client-side code.**

An AI coding agent **may use** environment variables when required for an authorized development operation, but **must never copy their values** into tracked project files or documentation. This includes echoing a secret into a commit message, a code comment, a README, a test fixture, a debug log, a changelog entry, or a specification document.

If a secret is ever observed in conversation, in a terminal, or in a file, it must be treated as **exposed** and reported for rotation — never propagated.

---

## 10. Build Milestones

1. **Scaffold:** Next.js + Tailwind + shadcn/ui + TypeScript → push to GitHub → deploy placeholder on Vercel.
2. **Database:** Neon project + Drizzle schema + migrations + seed script + `seed.csv` import.
3. **Auth:** NextAuth credentials login + member switcher.
4. **Core CRUD:** Quick Add + transactions list (filter/search/edit/delete) + CSV export.
5. **Dashboard:** Charts (category pie, member split, tag breakdown, 6-month trend).
6. **Polish:** Mobile testing, empty states, loading states, error handling.

---

## 11. Future Scope (Out of Bounds for v1)

*The following are explicitly EXCLUDED from v1:*
- Multi-user email/magic-link authentication
- Freeform user-generated tags
- Automated recurring transaction generation (v1 = manual logging with `recurring` label)
- PWA / offline-first (service workers, IndexedDB sync)
- Receipt photo attachments
- Multi-currency support
- ~~Budget limits + over-budget alerts~~ *(removed from the exclusion list by owner amendment on 16 Aug 2026 — budgets are a permitted v1.2 feature, §6.7)*
- Telegram/email monthly digest
- Merchant auto-categorization
- Voice input

> *"Dark mode" was **removed from this exclusion list** by owner amendment on 15 August
> 2026 — dark mode is a permitted v1.2 feature (§6.1). "Budget limits + over-budget alerts"
> was **removed** by owner amendment on 16 August 2026 — budgets are a permitted v1.2
> feature (§6.7). All other items above remain excluded. See `CHANGELOG.md`.*

---

## ⚠️ STANDING DIRECTIVE FOR AI AGENTS

This specification is **frozen**. No deviations, no "helpful" additions outside this scope, and no architectural changes are permitted.
(if you have "helpful" additions,architectural changes -- first present to it to user, ask for permission, no silent folding ins)

**Implementation is strictly prohibited until the user explicitly issues the command:** `"lets start the project"`.
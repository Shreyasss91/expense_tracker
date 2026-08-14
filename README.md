# 📒 Family Ledger

A high-speed, low-friction expense tracker for a family household — Dad 👨, Mom 👩, Son 👦.
Built from the frozen spec in [`docs/SPEC.md`](docs/SPEC.md).

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router, RSC, Server Actions) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Database | Neon (serverless Postgres) |
| ORM | Drizzle (`drizzle-kit` migrations) |
| Auth | NextAuth.js v5 — Credentials only (shared family password) |
| Validation | Zod |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in real values — never commit .env.local
npm run db:push              # apply the schema to the database
npm run db:seed              # import the 1,157 historical rows from seed_data/seed.csv
npm run dev
```

The family password is `FAMILY_MASTER_PASSWORD` in `.env.local` / Vercel env settings.
Sign in with it, then pick who's holding the phone with the member switcher in the header.

### Environment variables (placeholders in `.env.example`)

```env
DATABASE_URL="postgresql://..."     # Neon connection string
AUTH_SECRET="..."                   # NextAuth secret
NEXTAUTH_URL="http://localhost:3000"
FAMILY_MASTER_PASSWORD="..."        # the single family password
```

`APP_TIMEZONE` (`Asia/Kolkata`) and `SEED_NAMESPACE` are hard-coded constants — not env vars (§5.7, §8.1).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (`drizzle/`) |
| `npm run db:push` | Push schema directly (dev convenience) |
| `npm run db:seed` | Seed members, categories and the 1,157 transactions (idempotent) |
| `npm run db:setup` | Push schema + seed |

## Architecture notes (spec highlights)

- **Quick Add** (§6.2): FAB → numpad amount → category grid → details. Amounts are integer paise (§5.8); times normalize `HH:MM` → `HH:MM:00` (§5.6); the active member comes from the `active_member_id` cookie and is validated against the `members` table (§3.2).
- **Member switcher** (§3.2): a plain client-readable cookie — a UI convenience, never a security boundary.
- **Seed identity** (§8.1): seeded transaction IDs are UUIDv5 of the verbatim `seed.csv` line + occurrence ordinal, so re-seeding is a no-op and the two intentional duplicate pairs stay distinct.
- **Dashboard** (§7.2): all analytics are SQL aggregates; zero-state safe per §6.3.1 (no `NaN%`, `—` for zero denominators, `Son` always renders ₹0.00).
- **Ledger** (§7.3): keyset pagination on `(date DESC, time DESC, created_at DESC, id DESC)`, page size 50, infinite scroll. Delete is swipe-left with a ~5s Undo window (§6.4.1).
- **CSV export** (§6.6): same 8 columns as `seed.csv`, plain 2-dp amounts, `HH:MM` times, RFC 4180 quoting.

## Deploying (Vercel)

1. Push the repo to GitHub.
2. Import the repo in Vercel (framework preset: Next.js).
3. Add the four env vars from `.env.example` (real values).
4. Run `npm run db:push && npm run db:seed` against the production database (or via a build step).

The seed data itself is immutable — `seed_data/seed.csv` must not be edited, reordered, deduplicated, or given a trailing newline (§8.3).

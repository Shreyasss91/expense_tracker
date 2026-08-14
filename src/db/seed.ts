/**
 * Seed script (§8) — `npm run db:seed`.
 *
 * Idempotent for an unchanged canonical seed.csv: every row's id is a
 * deterministic UUIDv5 of its verbatim raw source line (§8.1), so a re-run
 * conflicts on the primary key and is a genuine no-op.
 *
 * §8.1 Implementation Requirement: the raw source line is preserved BEFORE
 * parsing and hashed as-is — never a line reconstructed from parsed fields.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { v5 as uuidv5 } from "uuid";
import {
  CATEGORY_SLUG_MAP,
  MEMBER_SLUG_MAP,
  SEED_CATEGORIES,
  SEED_MEMBERS,
  SEED_NAMESPACE,
  TRANSACTION_TAGS,
} from "../lib/constants";
import { categories, members, transactions } from "./schema";

// Developer tool — builds its own client (the app's db client is server-only).
const sql = neon(process.env.DATABASE_URL ?? "");
const db = drizzle({ client: sql });

const CSV_HEADER = "date,time,member,type,item,amount,category,tag";

async function main() {
  const csvPath = join(process.cwd(), "seed_data", "seed.csv");
  const content = readFileSync(csvPath, "utf8");

  if (content.includes("\r")) {
    throw new Error("seed.csv contains CR — the audit guarantees LF-only; refusing to proceed");
  }
  // §8.3: seed.csv has no trailing newline — split still yields every row.
  const lines = content.split("\n");
  if (lines[0] !== CSV_HEADER) {
    throw new Error(`Unexpected header: ${JSON.stringify(lines[0])}`);
  }
  const rawRows = lines.slice(1);

  console.log(`seed.csv: ${rawRows.length} data rows (incl. ${countOccurrences(rawRows)} duplicate-group members).`);

  // 1. Seed the 3 members through the literal map in §3.2.2.
  for (const m of SEED_MEMBERS) {
    await db.insert(members).values({ ...m }).onConflictDoNothing({ target: members.slug });
  }
  // 2. Seed the 19 categories through the literal map in §5.3.
  for (const c of SEED_CATEGORIES) {
    await db.insert(categories).values({ ...c }).onConflictDoNothing({ target: categories.slug });
  }

  // Resolve slug → UUID from the DB. Never join on name.
  const memberRows = await db.select().from(members);
  const categoryRows = await db.select().from(categories);
  const memberIdBySlug = new Map(memberRows.map((m) => [m.slug, m.id]));
  const categoryIdBySlug = new Map(categoryRows.map((c) => [c.slug, c.id]));

  const seen = new Map<string, number>();
  const rows: (typeof transactions.$inferInsert)[] = [];

  for (const raw of rawRows) {
    if (raw === "") continue; // defensive; audited file has no empty lines

    // §8.1: occurrenceIndex counts byte-identical prior lines.
    const occurrence = seen.get(raw) ?? 0;
    seen.set(raw, occurrence + 1);

    // §8.1: hash the PRESERVED raw line — never a re-serialized record.
    const id = uuidv5(`${raw}\u001F#${occurrence}`, SEED_NAMESPACE);

    const fields = raw.split(",");
    if (fields.length !== 8) {
      throw new Error(`Expected 8 fields, got ${fields.length}: ${raw.slice(0, 80)}`);
    }
    const [date, time, memberStr, type, item, amountStr, categoryStr, tagStr] = fields;

    const memberSlug = MEMBER_SLUG_MAP[memberStr];
    if (!memberSlug) throw new Error(`Unknown member string: ${memberStr}`);
    const categorySlug = CATEGORY_SLUG_MAP[categoryStr];
    if (!categorySlug) throw new Error(`Unknown category string: ${categoryStr}`);

    const memberId = memberIdBySlug.get(memberSlug);
    const categoryId = categoryIdBySlug.get(categorySlug);
    if (!memberId || !categoryId) {
      throw new Error(`Missing resolved id for member=${memberSlug} category=${categorySlug}`);
    }

    if (type !== "expense") throw new Error(`Unexpected type ${type} on: ${raw.slice(0, 80)}`);
    const tag = tagStr as (typeof TRANSACTION_TAGS)[number];
    if (!TRANSACTION_TAGS.includes(tag)) {
      throw new Error(`Unexpected tag ${tagStr} on: ${raw.slice(0, 80)}`);
    }
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`Unexpected time ${time}`);

    // §5.8: amount through integer paise → fixed-2-decimal storage string.
    const amount = (Math.round(parseFloat(amountStr) * 100) / 100).toFixed(2);

    rows.push({
      id,
      memberId,
      categoryId,
      type: "expense",
      tag,
      amount,
      note: item,
      date,
      // §5.6: HH:MM → HH:MM:00 at the write boundary
      time: `${time}:00`,
    });
  }

  // 4. Bulk insert; onConflictDoNothing conflicts on the PK (§8.1).
  const inserted = await db.insert(transactions).values(rows).onConflictDoNothing();
  const total = await db.$count(transactions);

  console.log(`Inserted ${inserted.rowCount ?? "?"} rows (0 = already fully seeded).`);
  console.log(`transactions table now has ${total} rows.`);
}

function countOccurrences(lines: string[]): number {
  const seen = new Map<string, number>();
  let dups = 0;
  for (const l of lines) {
    const n = seen.get(l) ?? 0;
    seen.set(l, n + 1);
    if (n === 1) dups += 1; // a second byte-identical line
  }
  return dups;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

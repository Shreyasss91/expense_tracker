/**
 * Seed round-trip test — `npm run test:seed-roundtrip`.
 *
 * Proves that the canonical CSV export (§6.6) reproduces `seed.csv`:
 *
 *   seed.csv ──db:seed──▶ database ──exportCsv logic──▶ CSV ──must equal──▶ seed.csv
 *
 * The export normalizes amounts to plain 2 dp (§6.6) while seed.csv stores
 * whole rupees without decimals, so both sides are compared in that canonical
 * form. Ordering within a date is message-log time, not guaranteed by the
 * export ORDER BY (created_at ties), so the comparison is a multiset; the
 * export's date-ASC ordering is spot-checked separately.
 *
 * Requires a seeded database (run `npm run db:seed` first) and `.env.local`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { v5 as uuidv5 } from "uuid";
import { CSV_HEADER, formatCsvLine } from "../lib/csv-export";
import { SEED_NAMESPACE } from "../lib/constants";
import { categories, members, transactions } from "./schema";

const EXPECTED_SEED_ROWS = 1157; // §8: canonical data-row count

const client = neon(process.env.DATABASE_URL ?? "");
const db = drizzle({ client });

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const csvPath = join(process.cwd(), "seed_data", "seed.csv");
  const content = readFileSync(csvPath, "utf8");
  if (content.includes("\r")) fail("seed.csv contains CR — the audit guarantees LF-only");

  // 1. Read seed.csv preserving raw lines (§8.1).
  const lines = content.split("\n");
  if (lines[0] !== CSV_HEADER) fail(`unexpected seed.csv header: ${JSON.stringify(lines[0])}`);
  const rawRows = lines.slice(1).filter((l) => l.length > 0);
  if (rawRows.length !== EXPECTED_SEED_ROWS) {
    fail(`expected ${EXPECTED_SEED_ROWS} seed rows, found ${rawRows.length} (seed.csv is immutable — §8.3)`);
  }

  // 2. Compute each row's deterministic id from its raw line + occurrence
  //    ordinal, and parse the fields (identical pipeline to the seed script).
  const seen = new Map<string, number>();
  const expected: { id: string; fields: string[] }[] = [];
  for (const raw of rawRows) {
    const occurrence = seen.get(raw) ?? 0;
    seen.set(raw, occurrence + 1);
    const id = uuidv5(`${raw}\u001F#${occurrence}`, SEED_NAMESPACE);
    const fields = raw.split(",");
    if (fields.length !== 8) fail(`seed row has ${fields.length} fields: ${raw.slice(0, 60)}`);
    expected.push({ id, fields });
  }

  // 3. Load those same rows back out of the database, by deterministic id,
  //    using the same join the export action uses.
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      time: transactions.time,
      type: transactions.type,
      note: transactions.note,
      amount: transactions.amount,
      tag: transactions.tag,
      member: members.name,
      category: categories.name,
    })
    .from(transactions)
    .innerJoin(members, eq(transactions.memberId, members.id))
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(inArray(transactions.id, expected.map((e) => e.id)));

  const byId = new Map(rows.map((r) => [r.id, r]));
  if (byId.size !== expected.length) {
    fail(`${expected.length - byId.size} seeded row(s) missing from the database — run npm run db:seed`);
  }

  // 4. Re-serialize in seed.csv order through the exact export formatter.
  const exported = expected.map(({ id, fields }) => {
    const r = byId.get(id)!;
    const line = formatCsvLine({
      date: r.date,
      time: r.time,
      member: r.member,
      type: r.type as "income" | "expense",
      note: r.note,
      amount: r.amount,
      category: r.category,
      tag: r.tag,
    });
    const out = line.split(",");
    if (out.length !== 8) fail(`exported line has ${out.length} fields for seed row: ${fields.join(",").slice(0, 60)}`);
    return out;
  });

  // 5. Compare as multisets in canonical form (amounts normalized to 2 dp).
  const canonical = (f: string[]) => [...f.slice(0, 5), Number(f[5]).toFixed(2), ...f.slice(6)];
  const key = (f: string[]) => canonical(f).join("\u001F");
  const seedSorted = expected.map((e) => key(e.fields)).sort();
  const exportSorted = exported.map(key).sort();
  if (JSON.stringify(seedSorted) !== JSON.stringify(exportSorted)) {
    for (let i = 0; i < Math.max(seedSorted.length, exportSorted.length); i++) {
      if (seedSorted[i] !== exportSorted[i]) {
        fail(
          `round-trip mismatch at row ${i + 1}.\n` +
            `  seed  : ${seedSorted[i] ?? "(missing)"}\n` +
            `  export: ${exportSorted[i] ?? "(missing)"}\n` +
            `Hint: did a member/category get renamed, seed.csv get edited, or a seeded row get deleted?`,
        );
      }
    }
    fail("round-trip mismatch");
  }

  // 6. Format spot-checks per §6.6 on the exported data.
  for (const f of exported) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[0])) fail(`bad date: ${f[0]}`);
    if (!/^\d{2}:\d{2}$/.test(f[1])) fail(`bad time: ${f[1]}`);
    if (!["income", "expense"].includes(f[3])) fail(`bad type: ${f[3]}`);
    if (!/^\d+(\.\d{2})?$/.test(f[5])) fail(`bad amount: ${f[5]}`);
  }

  // 7. The export query itself must order by date ASC (created_at ASC ties)
  //    per §6.6 — spot-check on the same query the action runs.
  const ordered = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(inArray(transactions.id, expected.map((e) => e.id)))
    .orderBy(sql`date ASC, created_at ASC`);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].date < ordered[i - 1].date) {
      fail(`export ordering violated at index ${i}: ${ordered[i - 1].date} → ${ordered[i].date}`);
    }
  }

  console.log(
    `✓ Round-trip OK — ${exported.length} seeded rows exported from the DB match ` +
      `seed.csv in canonical form (header, 8 columns, HH:MM times, 2-dp amounts, date-ASC ordering).`,
  );
  // Natural exit (no process.exit) so undici's keep-alive handles drain cleanly.
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

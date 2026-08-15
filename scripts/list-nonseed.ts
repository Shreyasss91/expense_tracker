/**
 * Dev utility — list rows in `transactions` that are NOT seed rows.
 * A row is a seed row iff its id equals uuidv5(rawLine + \u001F#occurrence, SEED_NAMESPACE)
 * for some byte-identical line of seed.csv (§8.1).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { v5 as uuidv5 } from "uuid";
import { SEED_NAMESPACE } from "../src/lib/constants";

const sql = neon(process.env.DATABASE_URL ?? "");
const SEED_CSV = join(process.cwd(), "seed_data", "seed.csv");

async function main() {
  const content = readFileSync(SEED_CSV, "utf8");
  const lines = content.split("\n").slice(1).filter((l) => l.length > 0);
  const seen = new Map<string, number>();
  const ids = new Set<string>();
  for (const raw of lines) {
    const occ = seen.get(raw) ?? 0;
    seen.set(raw, occ + 1);
    ids.add(uuidv5(`${raw}\u001F#${occ}`, SEED_NAMESPACE));
  }
  const rows = (await sql`SELECT id, date, amount, note, category_id FROM transactions`) as {
    id: string;
    date: string;
    amount: string;
    note: string | null;
    category_id: string;
  }[];
  const nonSeed = rows.filter((r) => !ids.has(r.id));
  console.log(`total rows: ${rows.length} | seed ids: ${ids.size} | non-seed rows: ${nonSeed.length}`);
  for (const r of nonSeed) {
    console.log(`  ${r.date}  ₹${r.amount}  note=${JSON.stringify(r.note ?? "")}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

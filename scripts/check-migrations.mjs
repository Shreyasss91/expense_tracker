// §1.4 — CI guard: the drizzle/meta/_journal.json entries and the
// drizzle/*.sql files must stay 1:1 and in order. A migration committed
// without a journal entry (or vice versa) breaks db:migrate in confusing
// ways; this fails the build with the exact mismatch instead.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();
const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
const tags = journal.entries.map((e) => e.tag);

const missingInFiles = tags.filter((t) => !files.includes(t));
const missingInJournal = files.filter((f) => !tags.includes(f));
const orderOk = tags.every((t, i) => files[i] === t);

if (missingInFiles.length || missingInJournal.length || !orderOk) {
  if (missingInFiles.length) console.error("Journal tags with no SQL file:", missingInFiles);
  if (missingInJournal.length) console.error("SQL files with no journal entry:", missingInJournal);
  if (!orderOk) {
    console.error("Journal order does not match sorted file order:");
    console.error("  journal:", tags.join(", "));
    console.error("  files:  ", files.join(", "));
  }
  process.exit(1);
}
console.log(`OK — ${files.length} migrations, journal and files in sync.`);

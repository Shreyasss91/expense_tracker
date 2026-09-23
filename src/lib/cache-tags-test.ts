/**
 * Cache-tag guard — `npm run test:cache-tags`.
 *
 * A cached read is only as fresh as its tag set, and Next's `unstable_cache`
 * cannot infer one: it is told which tags to clear, never which tables the
 * callback touched. A tag that was forgotten is therefore invisible — nothing
 * throws, nothing types wrong, the read simply keeps answering from before the
 * write until its TTL expires, which is exactly how long the gap lasts.
 *
 * Two rules, and both over-approximate in the safe direction: over-tagging costs
 * a re-query on the next read, under-tagging costs staleness with no signal.
 *
 *   1. READERS — every `unstable_cache` callback must declare a tag for every
 *      cache-mapped table it references.
 *   2. WRITERS — a route handler under `src/app/api/**` that inserts, updates or
 *      deletes a cache-mapped table must revalidate that table's tag itself,
 *      because it has no caller to do it for it. The mutations in
 *      `src/actions/**` are covered by `test:cache-refresh`'s import rule and by
 *      review; write helpers in `src/lib` / `src/db` are revalidated by their
 *      callers, which this scan cannot follow — stated, not hidden.
 *
 * The audit that produced these rules found **three real gaps** in a six-site
 * cache layer, each of which had survived review: the daily recurring cron
 * invalidated nothing at all, and two readers were tagged for the ledger while
 * also depending on `categories` and `templates`. See docs/changelog.md,
 * "The cached reads, audited".
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  blankComments,
  blankNonCode,
  findCachedCallBodies,
  findCalls,
  findLocalFunctions,
  findTableWrites,
} from "./source-scan";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/**
 * The cache-mapped tables and the tag that clears each. A table is listed here
 * only once something caches a read of it.
 */
const TABLE_TAGS: Record<string, string> = {
  transactions: "transactions",
  categories: "categories",
  members: "members",
  templates: "templates",
  // `budgets` has no tag of its own, and that is deliberate rather than an
  // oversight: a budget is only ever rendered beside ledger aggregates, so
  // `saveBudgets` / `setTotalBudget` clear "transactions" on purpose
  // (`settings.ts`: "dashboard aggregates are cached under this tag"). Recorded
  // here so the convention is checked instead of remembered.
  budgets: "transactions",
};

const KNOWN_TAGS = new Set(Object.values(TABLE_TAGS));

function readFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...readFiles(root, rel));
    } else if (/\.tsx?$/.test(entry.name) && !/[-.]test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const ident = (name: string) => new RegExp(`(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`);

/**
 * `import { templates as templateTable } from "@/db/schema"` — which schema
 * table each local name in the file refers to. This is what makes the reader
 * rule precise in two ways:
 *
 *   - it sees an aliased import (`getTemplates` queries `templateTable`, and
 *     looks table-free to a scan that only knows the canonical names);
 *   - it does NOT see a local variable that happens to share a table's name
 *     (`detectRecurringSuggestions` has `const members = cluster.members`, which
 *     is not the `members` table and must not demand its tag).
 */
function schemaBindings(text: string): Record<string, string> {
  const match = blankComments(text).match(/import\s*\{([^}]*)\}\s*from\s*"@\/db\/schema"/);
  if (!match) return {};
  const bindings: Record<string, string> = {};
  for (const part of match[1].split(",")) {
    const [original, local] = part.trim().split(/\s+as\s+/);
    if (original) bindings[(local ?? original).trim()] = original.trim();
  }
  return bindings;
}

/** The mapped tables a body actually queries, via the names the file bound to them. */
function tablesReadIn(body: string, bindings: Record<string, string>): string[] {
  const blanked = blankNonCode(body);
  return Object.entries(bindings)
    .filter(([local, table]) => table in TABLE_TAGS && ident(local).test(blanked))
    .map(([, table]) => table);
}

/**
 * The tables a cached callback depends on, following its calls into functions
 * declared in the same file. `unstable_cache(() => detectRecurringSuggestions())`
 * names no table itself, so a scan that stopped at the callback would find
 * nothing to check — which is precisely the read whose tags were wrong.
 */
function tablesBehind(fileText: string, body: string, bindings: Record<string, string>): string[] {
  const localFunctions = findLocalFunctions(fileText);
  const tables = new Set<string>();
  const visited = new Set<string>();
  const queue = [body];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const table of tablesReadIn(current, bindings)) tables.add(table);
    for (const m of blankNonCode(current).matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = m[1];
      if (visited.has(callee) || !localFunctions.has(callee)) continue;
      visited.add(callee);
      queue.push(localFunctions.get(callee) as string);
    }
  }
  return [...tables];
}

/**
 * The tags a file actually clears, read off real `revalidateTag("...")` CALLS.
 *
 * Both obvious shortcuts are wrong here. A plain text match finds the helper's
 * own log label — ``revalidateTag("${tag}")``, a template literal that looks
 * exactly like a call — and a scan over blanked output finds nothing, because
 * the tag name is a string literal. The call is located with the scanner and its
 * argument is then read out of the untouched text.
 */
function clearedTagsIn(text: string): string[] {
  const tags: string[] = [];
  for (const site of findCalls(text, /(?<![A-Za-z0-9_$])revalidateTag/)) {
    const literal = text.slice(site.index).match(/^revalidateTag\s*\(\s*"([^"]*)"/);
    if (literal) tags.push(literal[1]);
  }
  return tags;
}

function tagsDeclaredIn(body: string): string[] {
  const match = body.match(/tags:\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function main() {
  const root = process.cwd();
  const files = readFiles(root, "src");
  check(files.length > 0, `run from the project root (${files.length} source files scanned)`);

  // --- Readers ------------------------------------------------------------
  console.log("\nReaders — a cached read must be tagged for every table it depends on");

  const cached: { file: string; line: number; body: string; required: string[]; declared: string[] }[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const bindings = schemaBindings(text);
    for (const site of findCachedCallBodies(text)) {
      cached.push({
        file,
        ...site,
        required: tablesBehind(text, site.body, bindings).map((t) => TABLE_TAGS[t]),
        declared: tagsDeclaredIn(site.body),
      });
    }
  }
  check(cached.length >= 6, `the scan found the cached reads (${cached.length})`);
  check(
    cached.every((site) => site.required.length > 0),
    "every cached read was traced to at least one mapped table (a rule that finds nothing proves nothing)",
  );

  for (const site of cached) {
    const declared = site.declared;
    const required = site.required;
    const missing = required.filter((tag) => !declared.includes(tag));
    check(
      missing.length === 0,
      `${site.file}:${site.line} declares ${declared.join(", ") || "(no tags)"} — covers ${required.join(", ") || "(no mapped table)"}${
        missing.length ? `, MISSING ${missing.join(", ")}` : ""
      }`,
    );
    check(
      declared.every((tag) => KNOWN_TAGS.has(tag)),
      `${site.file}:${site.line} declares only known tags${declared.filter((t) => !KNOWN_TAGS.has(t)).map((t) => ` (unknown: ${t})`).join("")}`,
    );
  }

  // The two readers this audit changed, named so the specific gap cannot come
  // back quietly — a generic rule failure would say "missing templates", which
  // is easy to skim past.
  const dashboard = cached.find((s) => s.file.includes("page.tsx"));
  check(
    Boolean(dashboard) && dashboard!.declared.includes("categories"),
    "the dashboard is invalidated by a category rename (its pie draws category names)",
  );
  const suggestions = cached.find((s) => s.file.includes("recurring-detection"));
  check(
    Boolean(suggestions) && ["templates", "categories"].every((t) => suggestions!.declared.includes(t)),
    "recurring suggestions clear when a template is created from one, or a category is renamed",
  );

  // --- Writers ------------------------------------------------------------
  console.log("\nWriters — a route handler has no caller to revalidate for it");

  const routeFiles = files.filter((f) => f.startsWith("src/app/api/"));
  check(routeFiles.length > 0, `the scan found the route handlers (${routeFiles.length})`);

  let appliedWrites = 0;
  for (const file of routeFiles) {
    const text = readFileSync(join(root, file), "utf8");
    const cleared = clearedTagsIn(text);
    const writes = findTableWrites(text).filter((w) => w.table in TABLE_TAGS);
    for (const write of writes) {
      appliedWrites += 1;
      const tag = TABLE_TAGS[write.table];
      check(
        cleared.includes(tag),
        `${file}:${write.line} writes ${write.table} (${write.op}) and clears "${tag}"`,
      );
    }
  }
  check(appliedWrites >= 2, `the writer rule actually met a mapped write (${appliedWrites})`);

  // A tag nobody clears, or a tag name misspelled in a single call site, is dead
  // cache. Both directions are cheap to check once the set exists.
  const clearedTags = new Set<string>();
  for (const file of files) {
    for (const tag of clearedTagsIn(readFileSync(join(root, file), "utf8"))) clearedTags.add(tag);
  }
  for (const tag of KNOWN_TAGS) {
    check(clearedTags.has(tag), `"${tag}" is cleared by at least one call site`);
  }
  const strays = [...clearedTags].filter((t) => !KNOWN_TAGS.has(t));
  check(
    strays.length === 0,
    `no revalidateTag call names a tag nothing is cached under${strays.length ? ` (strays: ${strays.join(", ")})` : ""}`,
  );

  if (failures > 0) {
    console.error(`\n✗ Cache-tag guard FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log(
      "\n✓ Cache-tag guard OK — every cached read is tagged for the tables it reads, and every route-handler write clears its tag.",
    );
  }
}

main();

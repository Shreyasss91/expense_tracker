/**
 * Cache-refresh guard — `npm run test:cache-refresh`.
 *
 * Two things must hold on every write-then-revalidate path in the app, and
 * neither is visible by reading a call site:
 *
 *   1. BEHAVIOUR — a refresh that throws must not turn a **committed** write
 *      into a reported failure. `src/lib/cache-refresh.ts` is where that is
 *      decided, for both entry points (the re-exported `revalidatePath` /
 *      `revalidateTag` used by `src/actions/**`, and `refreshAfterWrite` used by
 *      the route handlers).
 *   2. SHAPE — nothing may call the framework's revalidators unguarded. The
 *      actions import the wrapper under the framework's own names on purpose, so
 *      no call site can tell the two apart; only the **import source** can, and
 *      this file reads those imports.
 *
 * Runs with `--conditions=react-server` because the helper is `server-only`.
 *
 * The behavioural half needs a process where `revalidatePath` genuinely throws —
 * and it has one. Outside a request Next has no static-generation store, so the
 * call raises *"Invariant: static generation store missing"*. That is normally a
 * nuisance (the digest/day DB test works around it); here it is the only way to
 * reach the failure path at all, since inside a real request the refresh
 * succeeds and the guard is dead code.
 *
 * The test refuses to be vacuous about this: it calls the framework's own
 * function first, captures the reason **it** throws, and then requires the
 * wrapper's log line to contain that exact reason. A stub that logged a canned
 * message could not produce it, so the check proves the wrapper really delegated.
 *
 * The shape half is a ratchet, not a proof. It pins which files may import the
 * framework's revalidators and how many raw calls each may hold, so a new
 * unguarded call fails until someone deliberately records it here. It also
 * checks that each raw call sits **inside** a `refreshAfterWrite` thunk rather
 * than beside it — a question no text match can answer, so the enclosing call
 * is found by matching parens, and that scanner has its own checks below.
 *
 * What it still cannot see: whether the guard is *effective* (any wrapper would
 * satisfy it), and whether a call in an action is ever reached.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { blankComments, findCalls, findTableWrites } from "./source-scan";
import { revalidatePath as nextRevalidatePath, revalidateTag as nextRevalidateTag } from "next/cache";
import { revalidatePath, revalidateTag, refreshAfterWrite } from "./cache-refresh";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/** Captures console.warn for the duration of `fn` — the guard logs, never stays silent. */
function captureWarnings(fn: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

/** The reason the framework's revalidator throws in this process, or null if it did not. */
function directCallReason(call: () => void): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const GREPPABLE = "the write succeeded but the cache revalidation failed";

function behaviourChecks() {
  console.log("\nBehaviour — a throwing refresh must not reach the caller");

  // The harness itself: if the framework call stopped throwing here, every check
  // below would pass against a wrapper that never ran anything.
  //
  // The probe argument is the one the wrapper is later called with, because
  // Next's invariant message EMBEDS it ("... missing in revalidatePath /settings"),
  // so a differently-argued probe would never be found inside the wrapper's log.
  const pathReason = directCallReason(() => nextRevalidatePath("/settings"));
  check(pathReason !== null, "framework revalidatePath throws outside a request (test is not vacuous)");
  check(Boolean(pathReason && pathReason.length > 0), `the captured reason is non-empty: ${JSON.stringify(pathReason)}`);

  const tagReason = directCallReason(() => nextRevalidateTag("transactions"));
  check(tagReason !== null, "framework revalidateTag throws outside a request");

  const pathWarnings = captureWarnings(() => revalidatePath("/settings"));
  check(pathWarnings.length === 1, `revalidatePath swallowed the throw and logged once (got ${pathWarnings.length})`);
  const pathLog = pathWarnings[0] ?? "";
  check(pathLog.includes(GREPPABLE), "the log carries the stable greppable phrase");
  check(pathLog.includes('revalidatePath("/settings")'), "the log names the refreshed path");
  check(
    Boolean(pathReason) && pathLog.includes(pathReason as string),
    "the log carries the framework's own reason — proof the wrapper delegated, not a stub",
  );

  const tagWarnings = captureWarnings(() => revalidateTag("transactions"));
  check(tagWarnings.length === 1, "revalidateTag swallowed the throw and logged once");
  const tagLog = tagWarnings[0] ?? "";
  check(tagLog.includes('revalidateTag("transactions")'), "the tag log names the tag");
  check(Boolean(tagReason) && tagLog.includes(tagReason as string), "the tag log carries the framework's own reason");

  // Both are called as statements by Server Actions and route handlers. A
  // promise here would escape as an unhandled rejection instead of a log line.
  check(revalidatePath("/") === undefined, "revalidatePath returns nothing — the call is synchronous");

  // `refreshAfterWrite` is the route-handler entry point; a plain Error stands in
  // for whatever the refresh throws, which is the part that matters.
  let threw = false;
  const customWarnings = captureWarnings(() => {
    try {
      refreshAfterWrite("probe write", () => {
        throw new Error("probe failure");
      });
    } catch {
      threw = true;
    }
  });
  check(!threw, "refreshAfterWrite does not rethrow the refresh failure");
  check(customWarnings[0]?.includes("probe write"), "refreshAfterWrite labels the log with the caller's label");
  check(customWarnings[0]?.includes("probe failure"), "refreshAfterWrite reports the underlying reason");
  check(customWarnings[0]?.includes(GREPPABLE), "refreshAfterWrite uses the same greppable phrase");

  // The happy path must stay a pass-through: called exactly once, and silent.
  let calls = 0;
  const quiet = captureWarnings(() => refreshAfterWrite("working write", () => { calls += 1; }));
  check(calls === 1, "a working refresh runs exactly once");
  check(quiet.length === 0, "a working refresh logs nothing");
}

// --- Source shape ---------------------------------------------------------

/** A revalidator call, excluding `nextRevalidatePath(` and `obj.revalidatePath(`. */
const REVALIDATOR = /(?<![A-Za-z0-9_$.])revalidate(?:Path|Tag)/;

function revalidateSites(text: string) {
  return findCalls(text, REVALIDATOR);
}

/**
 * Comments are blanked first so a doc comment describing an import cannot be
 * mistaken for one. Literals are NOT blanked — the module specifier is itself a
 * string, and it is the whole answer here.
 */
function importsFromNextCache(text: string): boolean {
  const match = blankComments(text).match(/import\s*\{([^}]*)\}\s*from\s*"next\/cache"/);
  return Boolean(match && /\brevalidate(?:Path|Tag)\b/.test(match[1]));
}

/** True when the file takes them from the guarded helper — the only other source allowed. */
function importsFromHelper(text: string): boolean {
  return /import\s*\{[^}]*\brevalidate(?:Path|Tag)\b[^}]*\}\s*from\s*"@\/lib\/cache-refresh"/.test(
    blankComments(text),
  );
}

/**
 * The enclosing-call scanner is what makes the check below meaningful, so it is
 * checked first — on snippets whose answer is known, including the ones it must
 * get *wrong-looking* (a call beside the thunk, a call inside a comment).
 */
function scannerChecks() {
  console.log("\nThe scanner — the shape half is only as good as this");

  const guards = (src: string) => revalidateSites(src).map((s) => s.guard ?? "none");

  check(
    guards('refreshAfterWrite("x", () => revalidatePath("/"));').join() === "refreshAfterWrite",
    "an inline thunk reports refreshAfterWrite as its guard",
  );
  check(
    guards('refreshAfterWrite("x", () => {\n  revalidatePath("/");\n  revalidateTag("t");\n});').join() ===
      "refreshAfterWrite,refreshAfterWrite",
    "both calls inside a block thunk are guarded",
  );
  check(
    guards('refreshAfterWrite("x", () => revalidatePath("/"));\nrevalidatePath("/beside");').join() ===
      "refreshAfterWrite,none",
    "the same call one line later is NOT guarded",
  );
  check(
    guards('// revalidatePath("/")\nconst s = "revalidateTag(t)";').length === 0,
    "a call named in a comment or a string is not a call site",
  );
  check(
    guards('/* revalidatePath("/") */\nrevalidateTag("t");').join() === "none",
    "a block comment is blanked, and the real call beside it is still found",
  );
  check(
    findTableWrites("await db\n  .insert(transactions)\n  .values(x);")
      .map((w) => `${w.op}:${w.table}`)
      .join() === "insert:transactions",
    "a write in a multi-line chain is still found",
  );
}

/**
 * Files that may hold a RAW call, and how many. Deliberately pinned: a new
 * unguarded call (or a new file importing the framework's revalidators) fails
 * this test until the author wraps it in `refreshAfterWrite` or switches to the
 * wrapper, then records the decision here.
 */
const RAW_CALL_BUDGET: Record<string, number> = {
  "src/app/api/attachments/[id]/route.ts": 2,
  "src/app/api/cron/digest/route.ts": 1,
  "src/app/api/cron/digest-fallback/route.ts": 1,
  "src/app/api/cron/recurring/route.ts": 3,
  "src/app/api/digest/day/route.ts": 1,
  "src/app/api/import/route.ts": 3,
};

const HELPER = "src/lib/cache-refresh.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function shapeChecks(root: string) {
  console.log("\nShape — no write path may call the framework's revalidators unguarded");

  const srcDir = join(root, "src");
  check(existsSync(join(srcDir, "actions")), "run from the project root (src/actions found)");
  if (!existsSync(join(srcDir, "actions"))) return;

  const rel = (f: string) => relative(root, f).split(sep).join("/");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  const helperText = read(HELPER);
  check(
    helperText.includes("revalidatePath as nextRevalidatePath") && helperText.includes("revalidateTag as nextRevalidateTag"),
    "the helper is the one module that aliases the framework's revalidators",
  );
  check(
    helperText.includes("export function revalidatePath") && helperText.includes("export function revalidateTag"),
    "the helper exports both wrappers under the framework's names",
  );
  // Its own declarations are not calls; everything else must go through the alias.
  const helperBody = helperText.replace(/export function revalidate(?:Path|Tag)\(/g, "export function ");
  check(
    revalidateSites(helperBody).length === 0,
    "the helper reaches the framework only through the aliases (its own log labels are strings, not calls)",
  );

  const files = walk(srcDir)
    .filter((f) => !/[-.]test\.tsx?$/.test(f) && statSync(f).isFile())
    .map(rel)
    .filter((f) => f !== HELPER);

  const withCalls = files.filter((f) => revalidateSites(read(f)).length > 0);
  check(withCalls.length > 0, `the scan found files that revalidate (${withCalls.length})`);

  const rawUsers = withCalls.filter((f) => importsFromNextCache(read(f)));
  const helperUsers = withCalls.filter((f) => importsFromHelper(read(f)));

  // The invariant: every call site resolves to one of the two known sources.
  const unaccounted = withCalls.filter((f) => !rawUsers.includes(f) && !helperUsers.includes(f));
  check(
    unaccounted.length === 0,
    `every file that revalidates takes the name from next/cache or the helper\n      unaccounted: ${unaccounted.join(", ") || "(none)"}`,
  );

  check(
    rawUsers.every((f) => !helperUsers.includes(f)),
    "no file mixes the raw and guarded revalidators",
  );

  const rawKeys = [...rawUsers].sort();
  const budgetKeys = Object.keys(RAW_CALL_BUDGET).sort();
  check(
    rawKeys.join(", ") === budgetKeys.join(", "),
    `the files holding raw calls are exactly the recorded budget\n      observed: ${rawKeys.join(", ") || "(none)"}\n      recorded: ${budgetKeys.join(", ")}`,
  );
  for (const name of budgetKeys) {
    check(
      revalidateSites(read(name)).length === RAW_CALL_BUDGET[name],
      `${name}: ${RAW_CALL_BUDGET[name]} raw call(s) as recorded`,
    );
  }

  // The point of the sweep: a raw call must be INSIDE the thunk whose try/catch
  // absorbs it. `refreshAfterWrite(` merely appearing in the file proves nothing
  // — the call could sit beside it and throw straight out of the handler. Only
  // the enclosing-call scan can tell the two apart.
  for (const name of rawUsers) {
    const text = read(name);
    check(text.includes("refreshAfterWrite("), `${name}: every raw call is paired with refreshAfterWrite`);
    const outside = revalidateSites(text).filter((s) => s.guard !== "refreshAfterWrite");
    const detail = outside.map((s) => `line ${s.line} (${s.name}, guard=${s.guard ?? "none"})`).join(", ");
    check(
      outside.length === 0,
      `${name}: every raw call sits inside a refreshAfterWrite thunk${detail ? `\n      standing outside one: ${detail}` : ""}`,
    );
  }

  // `src/actions/**` is the family swept onto the wrapper: all of it, and only it.
  const actionFiles = files.filter((f) => f.startsWith("src/actions/"));
  const actionUsers = actionFiles.filter((f) => revalidateSites(read(f)).length > 0);
  check(actionUsers.length >= 6, `at least six action modules revalidate (found ${actionUsers.length})`);

  let actionCallSites = 0;
  for (const file of actionUsers) {
    actionCallSites += revalidateSites(read(file)).length;
    check(importsFromHelper(read(file)), `${file}: imports the refresh wrappers from the helper`);
    check(!importsFromNextCache(read(file)), `${file}: does NOT import the framework's revalidators directly`);
  }
  check(actionCallSites >= 100, `the action sweep really covers the call sites (${actionCallSites})`);
  check(actionUsers.length === helperUsers.filter((f) => f.startsWith("src/actions/")).length, "no action module was missed");
}

behaviourChecks();
scannerChecks();
shapeChecks(process.cwd());

if (failures > 0) {
  console.error(`\n✗ Cache-refresh guard FAILED (${failures} check(s) failed)`);
  process.exitCode = 1;
} else {
  console.log("\n✓ Cache-refresh guard OK — a refresh failure can be logged, never reported as a failed write.");
}

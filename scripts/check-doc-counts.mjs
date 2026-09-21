// The phone agent's check counts are quoted in the live documents, and a count
// that drifts becomes a lie a reader acts on: the run sheet once told a human to
// expect 51 checks from `npm run test:whatsapp-agent`, which prints 63 — and in a
// document whose own rule is "tick nothing you have not verified", a number that
// cannot appear makes a CORRECT run look like a broken one. (The rehearsal
// printed its count; the contract test printed only a verdict, which is how the
// wrong number survived. Both now print it.)
//
// So this guard runs every suite whose count is documented, reads the count the
// suite itself printed, and fails if any document disagrees — naming the file,
// the line, and both numbers.
//
// It is fail-closed in BOTH directions, because the two ways this guard could rot
// are both silent:
//
//   - A suite that stops printing a parseable count is a failure. Silence is not
//     agreement, and a regex that quietly matches nothing would leave every
//     document here unchecked while the job stayed green.
//   - A document whose sentence is reworded so the claim's pattern no longer
//     matches is a failure too — not a skip. Reworded prose stops being checked
//     otherwise, which is precisely how the original 51 outlived a change that
//     made it false.
//
// The counts in dated CHANGELOG entries are deliberately NOT scanned: this repo's
// rule is that an earlier data point stays in the record rather than being
// overwritten (`9b445ef`), so those numbers are history, not claims. Only the plan
// and the companion spec — documents a reader acts on — are checked.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "docs/PLAN_WHATSAPP_AGENT_TERMUX.md";
const SPEC = "docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md";

// Each claim: the npm script, the summary line it must print its count in, and
// every place a document quotes that count. `quoted[].pattern` must contain
// exactly one capture group — the documented number.
const CLAIMS = [
  {
    script: "test:whatsapp-agent",
    printed: /All (\d+) whatsapp-agent checks passed\./,
    quoted: [
      { doc: PLAN, pattern: /\*\*(\d+) assertions, green as of/ },
      { doc: PLAN, pattern: /the repo-side contract test \((\d+) assertions\)/ },
      { doc: SPEC, pattern: /`npm run test:whatsapp-agent`, \*\*(\d+) assertions\*\*/ },
    ],
  },
  {
    script: "rehearse:whatsapp-agent",
    printed: /All (\d+) rehearsal checks passed\./,
    quoted: [
      { doc: PLAN, pattern: /\*\*(\d+) checks\.\*\* It runs the \*\*real agent, unmodified\*\*/ },
      { doc: PLAN, pattern: /the laptop rehearsal \((\d+) checks\)/ },
      { doc: SPEC, pattern: /`npm run rehearse:whatsapp-agent`, \*\*(\d+) checks\*\*/ },
    ],
  },
];

const failures = [];
let compared = 0;
const lineOf = (text, index) => text.slice(0, index).split(/\r?\n/).length;

for (const claim of CLAIMS) {
  // One string rather than an args array: `shell: true` concatenates, so Node 22
  // warns that array args are unescaped (DEP0190). The script name is a literal
  // from CLAIMS, not user input.
  const run = spawnSync(`npm run ${claim.script}`, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (run.status !== 0) {
    failures.push(`\`npm run ${claim.script}\` did not exit 0 (status ${run.status}) — a count from a failing run proves nothing`);
    continue;
  }
  const printed = claim.printed.exec(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  if (!printed) {
    failures.push(`\`npm run ${claim.script}\` printed no "${claim.printed.source}" summary — widen the pattern so its count is readable again`);
    continue;
  }
  const expected = Number(printed[1]);

  for (const { doc, pattern } of claim.quoted) {
    const text = readFileSync(join(root, doc), "utf8");
    // Matched globally so a document that repeats the claim (and agrees with
    // itself) is checked at every occurrence, not just the first.
    const matches = [...text.matchAll(new RegExp(pattern.source, "g"))];
    if (matches.length === 0) {
      failures.push(`${doc} no longer contains this claim (${pattern.source}) — reworded prose stops being checked, so widen the pattern`);
      continue;
    }
    for (const match of matches) {
      compared += 1;
      const documented = Number(match[1]);
      if (documented !== expected) {
        failures.push(`${doc}:${lineOf(text, match.index)} says ${documented}, \`npm run ${claim.script}\` prints ${expected}`);
      }
    }
  }
}

if (failures.length) {
  console.error("Documented check counts disagree with what the suites print:\n");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("\nFix the document — or this guard, if the prose legitimately moved.");
  process.exit(1);
}

console.log(`OK — ${CLAIMS.length} suites, ${compared} documented counts, all in agreement.`);

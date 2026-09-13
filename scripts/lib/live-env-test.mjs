/**
 * `loadLiveEnv` regression test — `npm run test:live-env`.
 *
 * The guard exists to stop a live script from authenticating against
 * PRODUCTION with a stale shell variable, so the FAILURE path is the point:
 * it must exit non-zero, name the shadowed variables, and print no VALUES —
 * those are secrets.
 *
 * Every case runs in a child process, because `loadLiveEnv` mutates
 * `process.env` and calls `process.exit(1)`; in-process it would end the run
 * and leak state into later cases. The child is this same file re-invoked with
 * a scenario, so the fixture code is real JS rather than an escaped string.
 *
 * The fixture uses its own keys and its own file, so a developer's real
 * `.env.local` and exported secrets are never read or disturbed.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLiveEnv } from "./live.mjs";

const ALPHA = "LIVEENV_FIXTURE_ALPHA";
const BETA = "LIVEENV_FIXTURE_BETA";
const FILE_ALPHA = "alpha-from-file";
const AMBIENT_ALPHA = "alpha-from-stale-shell";
const SELF = fileURLToPath(import.meta.url);

/** Child mode: run exactly one scenario and report what ended up in the env. */
function runChildScenario() {
  loadLiveEnv(process.env.LIVEENV_TEST_FILE);
  console.log(
    `MERGED ${ALPHA}=${process.env[ALPHA] ?? "(unset)"} ${BETA}=${process.env[BETA] ?? "(unset)"}`,
  );
}

function runParent() {
  const dir = mkdtempSync(join(tmpdir(), "live-env-test-"));
  const fixture = join(dir, "fixture.env");
  writeFileSync(fixture, `${ALPHA}=${FILE_ALPHA}\n${BETA}=beta-from-file\n`);

  /** A child whose fixture keys start unset, whatever this shell exports. */
  function run(extra, envPath = fixture) {
    const env = { ...process.env };
    for (const key of [ALPHA, BETA, "ALLOW_ENV_OVERRIDE"]) delete env[key];
    Object.assign(env, { LIVEENV_TEST_FILE: envPath, LIVEENV_TEST_SCENARIO: "1" }, extra);
    const result = spawnSync(process.execPath, [SELF], { env, encoding: "utf8" });
    assert.equal(result.error, undefined, `child failed to spawn: ${result.error?.message}`);
    return result;
  }

  try {
    // 1. Nothing shadows the file: every key merges from it.
    const clean = run({});
    assert.equal(clean.status, 0, `clean load must succeed, got ${clean.status}: ${clean.stderr}`);
    assert.match(clean.stdout, new RegExp(`MERGED ${ALPHA}=${FILE_ALPHA} ${BETA}=beta-from-file`));

    // 2. A differing ambient value is FATAL and names the offender.
    const shadowed = run({ [ALPHA]: AMBIENT_ALPHA });
    assert.equal(shadowed.status, 1, "a shadowed variable must abort the run");
    assert.match(shadowed.stderr, new RegExp(ALPHA), "the offending variable must be named");
    assert.match(shadowed.stderr, /dotenv never overrides/, "the reason must be explained");
    assert.match(shadowed.stderr, new RegExp(`unset ${ALPHA}`), "the fix must be suggested");

    // 3. ...but it must never print the values — they are secrets.
    const output = `${shadowed.stdout}${shadowed.stderr}`;
    assert.ok(!output.includes(AMBIENT_ALPHA), "the stale VALUE must not be printed");
    assert.ok(!output.includes(FILE_ALPHA), "the file VALUE must not be printed");

    // 4. An ambient value EQUAL to the file is not a conflict — this is the
    //    normal case where a shell simply re-exports what the file says.
    const equal = run({ [ALPHA]: FILE_ALPHA });
    assert.equal(equal.status, 0, "an identical ambient value must not be treated as shadowing");
    assert.match(equal.stdout, new RegExp(`MERGED ${ALPHA}=${FILE_ALPHA}`));

    // 5. ALLOW_ENV_OVERRIDE=1 warns and proceeds, keeping the ambient value
    //    while still merging the keys the environment does not define.
    const override = run({ [ALPHA]: AMBIENT_ALPHA, ALLOW_ENV_OVERRIDE: "1" });
    assert.equal(override.status, 0, `the escape hatch must not abort: ${override.stderr}`);
    assert.match(override.stdout, /overridden by the environment/);
    assert.match(
      override.stdout,
      new RegExp(`MERGED ${ALPHA}=${AMBIENT_ALPHA} ${BETA}=beta-from-file`),
      "the ambient value must win while the file still fills the gaps",
    );

    // 6. No file at all (the CI case) is a silent no-op, not a failure.
    const absent = run({}, join(dir, "does-not-exist.env"));
    assert.equal(absent.status, 0, "an absent env file must not abort");
    assert.match(absent.stdout, new RegExp(`MERGED ${ALPHA}=\\(unset\\) ${BETA}=\\(unset\\)`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    assert.ok(!existsSync(dir), "the temp fixture directory must be cleaned up");
  }

  console.log(
    "loadLiveEnv OK — shadowing aborts naming the variable without printing values, " +
      "identical values and an absent file pass through, and ALLOW_ENV_OVERRIDE=1 proceeds.",
  );
}

if (process.env.LIVEENV_TEST_SCENARIO) runChildScenario();
else runParent();

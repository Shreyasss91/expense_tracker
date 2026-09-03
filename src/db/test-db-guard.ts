/**
 * §1.10 — the DB round-trip test scripts write and delete rows in whatever
 * database .env.local points at. They self-limit to throwaway months and
 * snapshot-restore real data, but a `npm run test:budget-roundtrip` against
 * PRODUCTION credentials is still one typo away from a bad afternoon.
 *
 * This guard refuses to run against a production-looking database unless the
 * operator explicitly forces it, so the typo fails loudly instead.
 *
 * "Production-looking" is deliberately a heuristic (host-based, no local/
 * ci/staging markers in the URL): a true prod marker doesn't exist, and the
 * guard errs on refusing — forcing is one env var away.
 */
export function assertNotProductionDb(label: string): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return; // no DB configured — the caller's own error handling kicks in

  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const isDisposable = /(neon\.tech.*(dev|staging|test|ci|branch|scratch|throwaway))|-branch-|ci:ci/.test(url);
  if (isLocal || isDisposable) return;

  if (process.env.DB_TESTS_ALLOW_PROD !== "1") {
    throw new Error(
      `${label}: DATABASE_URL looks like a PRODUCTION database (no local/ci/branch marker in the host). ` +
        `These tests write and delete rows. Point .env.local at a disposable branch, or set ` +
        `DB_TESTS_ALLOW_PROD=1 to explicitly accept the risk.`,
    );
  }
}

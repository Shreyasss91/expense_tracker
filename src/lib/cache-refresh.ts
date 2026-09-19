import "server-only";

/**
 * Refresh cached pages after a write that has **already committed**, without
 * letting the refresh change what the caller is told.
 *
 * Every write path here ends in `revalidatePath` / `revalidateTag`, and the
 * cache call sits inside the same `try` as the write. That is fine until the
 * refresh itself throws: the caller then receives a *failure* for a mutation the
 * database has already committed, so its belief and the stored state disagree.
 * The attachments route already refused to do this to a blob it had orphaned —
 * *"failing the request now would lie to the user"* — and this applies the same
 * rule to the refresh.
 *
 * What the lie costs depends on who reads the response, which is why the sweep
 * stopped at the route handlers:
 *
 *   - `POST /api/digest/day` is read by the **phone agent**, which logs *"the
 *     fallback push may fire"* on a non-200 — a false alarm for a night already
 *     recorded;
 *   - the two crons are read by **Vercel**, which marks the run failed and can
 *     alert on a job that did its work;
 *   - `/api/import` and the receipt delete are read by the **UI**, which shows an
 *     error for an import or a delete that happened.
 *
 * The failure is **logged, never swallowed** — hardening must not become hiding,
 * and a cache that will not revalidate is worth knowing about. `label` is the
 * only thing that distinguishes one call site from another in the log, so it
 * should say what was written, not merely which route ran.
 *
 * Deliberately **not** reordered: refreshing before the write would let a cache
 * failure skip the write entirely, which is strictly worse. The write is the
 * contract; the refresh is cosmetic.
 */
export function refreshAfterWrite(label: string, refresh: () => void): void {
  try {
    refresh();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`${label}: the write succeeded but the cache revalidation failed — ${reason.slice(0, 200)}`);
  }
}

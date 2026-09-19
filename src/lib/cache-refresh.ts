import "server-only";
import { revalidatePath as nextRevalidatePath, revalidateTag as nextRevalidateTag } from "next/cache";

/**
 * Refresh cached pages after a write that has **already committed**, without
 * letting the refresh change what the caller is told.
 *
 * Every write path in this app ends in `revalidatePath` / `revalidateTag`, and
 * the cache call sits inside the same `try` as the write. That is fine until the
 * refresh itself throws: the caller then receives a *failure* for a mutation the
 * database has already committed, so its belief and the stored state disagree.
 * The attachments route already refused to do this to a blob it had orphaned —
 * *"failing the request now would lie to the user"* — and this applies the same
 * rule to the refresh.
 *
 * What the lie costs depends on who reads the result, so nothing is allowed to
 * report an unguarded refresh any more — there are two entry points, and both
 * of them end here:
 *
 *   - **`revalidatePath` / `revalidateTag` re-exported below**, for the ~100 call
 *     sites in `src/actions/**`. Those actions return `{ ok: false }` — or, when
 *     the call sits after the `try`, reject outright — so a throwing refresh was
 *     reported to the user as a failed save. In `createTemplate` and
 *     `saveSearch` it was worse than a wrong toast: the refresh sits *inside* the
 *     write's `try`, so its `catch` answered *"Could not save the template"* for
 *     a committed insert, and the obvious user reaction — retry — inserts a
 *     second row.
 *   - **`refreshAfterWrite(label, fn)`**, for the five route handlers
 *     (`/api/digest/day` POST, both crons, `/api/import`, the receipt delete),
 *     whose callers are the phone agent, Vercel and the UI respectively.
 *
 * The failure is **logged, never swallowed** — hardening must not become hiding,
 * and a cache that will not revalidate is worth knowing about. The log label
 * says what was written or which path was being refreshed, so it is greppable
 * (`the write succeeded but the cache revalidation failed`) and names the actual
 * call site rather than only the module.
 *
 * The honest cost of swallowing: the page keeps serving its cached render until
 * something else revalidates it. That is the less bad error — a stale cache is
 * eventually corrected and the log says so, whereas a false failure is acted on
 * immediately and irreversibly by whoever reads it.
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

/**
 * Drop-in replacements for `next/cache`'s revalidators, deliberately sharing
 * their names so that switching a call site over is an import-line change and
 * nothing else. `src/actions/**` imports **these**, never the framework's — a
 * guard test pins that (`test:cache-refresh`), because the difference is
 * invisible at the call site and only ever matters on the failure path.
 */
export function revalidatePath(path: string, type?: "page" | "layout"): void {
  refreshAfterWrite(`revalidatePath("${path}")`, () => nextRevalidatePath(path, type));
}

/** See `revalidatePath` above. */
export function revalidateTag(tag: string): void {
  refreshAfterWrite(`revalidateTag("${tag}")`, () => nextRevalidateTag(tag));
}

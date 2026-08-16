import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { appSettings } from "./schema";

/** §6.7 — global "exclude bills (recurring) from the total budget" toggle. */
export const EXCLUDE_BILLS_KEY = "exclude_bills_from_budget";

/** '1'/'0' string → boolean. Anything else (incl. a missing row) is off. */
export function excludeBillsEnabled(value: string | null | undefined): boolean {
  return value === "1";
}

/** Read a single app setting; missing row → null. Plain statement — the
 * neon-http driver has no transaction support, and reads don't need one. */
export async function getAppSetting<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  key: string,
): Promise<string | null> {
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

/** Upsert a single app setting (insert or update on conflict). */
export async function setAppSetting<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/** Convenience: the current exclude-bills flag as a boolean. */
export async function getExcludeBillsEnabled<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
): Promise<boolean> {
  return excludeBillsEnabled(await getAppSetting(db, EXCLUDE_BILLS_KEY));
}

import "server-only";

/**
 * §2.11 — what to push, and when.
 *
 * The audit's two examples — "80% of your Food budget, 8 days left" and "3
 * bills un-reviewed" — are exactly the two signals this module turns into
 * push notifications. The server-side pieces already existed (getBudgetAlert
 * for over-budget, getPendingReviewCount for the review queue); what was
 * missing was the *proactive* framing: budget pacing (approaching, not just
 * over) and a daily cadence that doesn't become spam.
 *
 * Two guards keep it useful rather than noisy:
 *
 *   1. Threshold — only budgets at >= 80% utilisation are worth a nudge.
 *   2. Daily gate — each notification has a stable key (scope + month, or
 *      "review" + date); once sent, that key is recorded in app_settings for
 *      the day, so a chatty budget or a standing review queue pings at most
 *      once per day. Re-sending every open is how you train people to disable
 *      notifications.
 *
 * All of it is built on the existing query functions and the existing
 * app_settings idempotency pattern (same idea as the digest and backup
 * crons), so there is no new state machine to reason about.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, pushSubscriptions, transactions } from "@/db/schema";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { budgetsForMonth } from "@/lib/budgets";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthKeyInIST, todayInIST } from "@/lib/dates";
import { monthKeySchema } from "@/lib/validations";
import { pendingReviewWhere } from "@/lib/review-where";
import { isPushConfigured, sendWebPush, type SendStatus } from "@/lib/web-push";

export interface PushNotification {
  title: string;
  body: string;
  /** Deep link opened on tap — keeps the nudge actionable. */
  url: string;
  /** Stable per-day key for the throttle (no date; the gate adds today). */
  key: string;
}

const BUDGET_THRESHOLD = 0.8;

interface ScopeSpend {
  total: number;
  byCategory: Map<string, number>;
  byGroup: Map<string, number>;
}

/**
 * One pass over the month's rows: the running total, leaf spend per category
 * (for leaf budgets), and leaf spend rolled up per group (for group budgets,
 * §2.1). All three in a single `SELECT ... GROUP BY` family, so a busy month
 * is a handful of round-trips rather than one per budget.
 */
async function monthSpend(monthKey: string): Promise<ScopeSpend> {
  const month = monthKeySchema.parse(monthKey);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;

  const [totalRows, catRows, groupRows] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end))),
    db
      .select({ categoryId: transactions.categoryId, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end), isNotNull(transactions.categoryId)))
      .groupBy(transactions.categoryId),
    // Group roll-up: spend whose leaf sits under a group, grouped by that group.
    db
      .select({ groupId: categories.parentId, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(gte(transactions.date, start), lte(transactions.date, end), isNotNull(categories.parentId)))
      .groupBy(categories.parentId),
  ]);

  return {
    total: rupeesToPaise(totalRows[0]?.total ?? "0"),
    byCategory: new Map(catRows.map((r) => [r.categoryId as string, rupeesToPaise(r.total)])),
    byGroup: new Map(groupRows.map((r) => [r.groupId as string, rupeesToPaise(r.total)])),
  };
}

function daysLeftInMonth(): number {
  const today = todayInIST();
  const [y, m, d] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastDay - d);
}

/**
 * Build the current set of due notifications. Pure with respect to the daily
 * gate — callers decide whether each key has already fired today.
 */
export async function computeNotifications(): Promise<PushNotification[]> {
  const month = monthKeyInIST();
  const budgetRows = await budgetsForMonth(db, month);
  if (budgetRows.length === 0) return buildReviewOnly();

  const [spend, groups, pending] = await Promise.all([
    monthSpend(month),
    db.select({ id: categories.id, name: categories.name, emoji: categories.emoji }).from(categories).where(isNull(categories.parentId)),
    db.select({ count: sql<number>`count(*)` }).from(transactions).where(pendingReviewWhere()),
  ]);

  const groupName = new Map(groups.map((g) => [g.id, g]));
  const daysLeft = daysLeftInMonth();
  const out: PushNotification[] = [];

  for (const b of budgetRows) {
    const limit = rupeesToPaise(b.amount);
    const spent = b.categoryId ? (spend.byCategory.get(b.categoryId) ?? 0) : b.groupId ? (spend.byGroup.get(b.groupId) ?? 0) : spend.total;
    if (limit <= 0 || spent < BUDGET_THRESHOLD * limit) continue;

    let label: string;
    let scope: string;
    if (!b.categoryId && !b.groupId) {
      label = "This month";
      scope = "total";
    } else if (b.categoryId) {
      label = `${b.categoryEmoji ?? ""} ${b.categoryName ?? "Category"}`.trim();
      scope = `category:${b.categoryId}`;
    } else {
      const g = b.groupId ? groupName.get(b.groupId) : undefined;
      label = `${g?.emoji ?? ""} ${g?.name ?? "Group"}`.trim();
      scope = `group:${b.groupId}`;
    }

    const pct = Math.round((spent / limit) * 100);
    if (spent > limit) {
      out.push({
        title: "Budget alert",
        body: `${label} is over budget by ${formatINR(spent - limit)}`,
        url: b.categoryId || b.groupId ? "/transactions" : "/",
        key: `push:budget:${scope}:${month}`,
      });
    } else {
      const days = daysLeft === 1 ? "1 day" : `${daysLeft} days`;
      out.push({
        title: "Budget alert",
        body: `${pct}% of your ${label} budget, ${days} left`,
        url: "/transactions",
        key: `push:budget:${scope}:${month}`,
      });
    }
  }

  const pendingCount = Number(pending[0]?.count ?? 0);
  if (pendingCount > 0) {
    out.push({
      title: "Review reminder",
      body: `${pendingCount} ${pendingCount === 1 ? "entry" : "entries"} to review`,
      url: "/review",
      key: `push:review:${todayInIST()}`,
    });
  }

  return out;
}

/** When there are no budgets at all, the review nudge still stands on its own. */
async function buildReviewOnly(): Promise<PushNotification[]> {
  const pending = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(pendingReviewWhere());
  const pendingCount = Number(pending[0]?.count ?? 0);
  if (pendingCount === 0) return [];
  return [
    {
      title: "Review reminder",
      body: `${pendingCount} ${pendingCount === 1 ? "entry" : "entries"} to review`,
      url: "/review",
      key: `push:review:${todayInIST()}`,
    },
  ];
}

export interface DispatchResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Notifications actually attempted (after the daily gate). */
  attempted: number;
  /** Total notifications that were due before the gate. */
  due: number;
  sent: number;
  failed: number;
  /** Subscriptions removed because the push service reported them dead. */
  stale: number;
}

/**
 * Send everything currently due, once per day per key. Used by the daily cron
 * (/api/cron/push) and available to call directly after a deploy.
 */
export async function dispatchNotifications(): Promise<DispatchResult> {
  const empty: DispatchResult = { ok: false, attempted: 0, due: 0, sent: 0, failed: 0, stale: 0 };

  if (!isPushConfigured()) {
    return { ...empty, status: 503, error: "Web Push is not configured (set VAPID_* env vars)" };
  }

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) {
    return { ...empty, status: 404, error: "No push subscriptions yet" };
  }

  const due = await computeNotifications();
  if (due.length === 0) {
    return { ...empty, ok: true, status: 200 };
  }

  // Daily gate: drop keys already fired today. Each notification carries a
  // stable key (scope + month / "review" + date); we store it dated so the
  // gate naturally resets at midnight.
  const today = todayInIST();
  const datedKeys = due.map((n) => `${n.key}:${today}`);
  const fired = await Promise.all(datedKeys.map((k) => getAppSetting(db, k)));
  const firedSet = new Set(fired.filter((v): v is string => Boolean(v)));
  const notifications = due.filter((_, i) => !firedSet.has(datedKeys[i]));

  if (notifications.length === 0) {
    return { ...empty, ok: true, status: 200, due: due.length };
  }

  let sent = 0;
  let failed = 0;
  const staleEndpoints: string[] = [];

  for (const sub of subs) {
    const target = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth };
    for (const notification of notifications) {
      let status: SendStatus;
      try {
        status = await sendWebPush(target, notification);
      } catch {
        status = "failed";
      }
      if (status === "sent") sent += 1;
      else if (status === "failed") failed += 1;
      else if (status === "stale") staleEndpoints.push(sub.endpoint);
    }
  }

  // A dead subscription (app uninstalled, permission revoked) returns 404/410;
  // purge it so we stop paying for POSTs that can never land.
  if (staleEndpoints.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, staleEndpoints));
  }

  // Record that we fired these keys today, so the next cron is a fresh start.
  await Promise.all(notifications.map((n) => setAppSetting(db, `${n.key}:${today}`, new Date().toISOString())));

  const ok = sent > 0 || failed === 0;
  return {
    ...empty,
    ok,
    status: ok ? 200 : 502,
    attempted: notifications.length,
    due: due.length,
    sent,
    failed,
    stale: staleEndpoints.length,
  };
}

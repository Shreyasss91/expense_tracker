import { NextResponse } from "next/server";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { format, parse } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { members, templates, transactions } from "@/db/schema";
import { isGenericNote } from "@/lib/generic-notes";
import { nowTimeInIST, todayInIST } from "@/lib/dates";
import { timingSafeStringEqual } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * Recurring auto-entries — daily cron (vercel.json, 06:00 IST) that stamps
 * due templates into the ledger automatically.
 *
 * A template is due when auto_day = today's IST day-of-month and it has not
 * been stamped for the current month yet (last_auto_key marker). Days 1–28
 * only, so short months can neither skip nor double-fire.
 *
 * Idempotency: the marker is written right after each insert. The neon-http
 * driver has no transactions, so a crash between insert and marker could
 * double-stamp — the same accepted non-atomic window the budgets path
 * documents (§6.7). The daily schedule makes the window minutes wide.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  // §1.8: constant-time compare of the bearer token (no timing leak of secret).
  if (!secret || !authorization || !timingSafeStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Manual override for testing/backfilling: ?date=YYYY-MM-DD
  const dateParam = new URL(request.url).searchParams.get("date");
  let date: string;
  if (dateParam) {
    // §1.10 — the regex below accepts impossible calendar dates (e.g.
    // 2026-02-30); a round-trip parse+format rejects them so we return 400
    // instead of letting the later INSERT throw a 500.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ ok: false, error: "Invalid date format (expected YYYY-MM-DD)" }, { status: 400 });
    }
    const parsed = parse(dateParam, "yyyy-MM-dd", new Date());
    if (format(parsed, "yyyy-MM-dd") !== dateParam) {
      return NextResponse.json({ ok: false, error: "Invalid calendar date" }, { status: 400 });
    }
    date = dateParam;
  } else {
    date = todayInIST();
  }
  const day = Number(date.slice(8, 10));
  const monthKey = date.slice(0, 7);

  try {
    const memberRows = await db.select().from(members).orderBy(asc(members.sortOrder));
    const memberIds = new Set(memberRows.map((m) => m.id));
    const defaultMemberId = memberRows[0]?.id;
    if (!defaultMemberId) {
      return NextResponse.json({ ok: false, error: "No members exist" }, { status: 500 });
    }

    const due = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.autoDay, day),
          or(isNull(templates.lastAutoKey), ne(templates.lastAutoKey, monthKey)),
        ),
      );

    let created = 0;
    const skipped: string[] = [];

    for (const t of due) {
      // §2.12 — paused templates never auto-stamp; variable-amount templates
      // stay manual-only ("amount varies — ask me").
      if (t.isPaused || t.isVariable) {
        skipped.push(t.id);
        continue;
      }
      // §2.12 — one-shot skip: consume the marker without inserting so the
      // month is treated as handled, then clear it.
      if (t.skipMonth && t.skipMonth === monthKey) {
        await db
          .update(templates)
          .set({ skipMonth: null, lastAutoKey: monthKey, updatedAt: new Date() })
          .where(eq(templates.id, t.id));
        skipped.push(t.id);
        continue;
      }
      // The template's member may have been deleted since it was set — fall
      // back to the household default rather than skipping the bill.
      const memberId = t.memberId && memberIds.has(t.memberId) ? t.memberId : defaultMemberId;

      const [row] = await db
        .insert(transactions)
        .values({
          id: randomUUID(),
          memberId,
          categoryId: t.categoryId,
          tag: t.tag,
          amount: t.amount,
          note: t.note,
          date,
          time: `${nowTimeInIST()}:00`,
          // §1.11 / §6.4 — generic notes stay NULL (pending review); a real
          // note is auto-acknowledged (timestamped). The old `? null : undefined`
          // was a no-op (both branches NULL), so auto-entries with real notes
          // were never marked reviewed.
          reviewedAt: isGenericNote(t.note) ? null : new Date(),
        })
        .returning({ id: transactions.id });

      if (row) {
        created += 1;
        await db
          .update(templates)
          .set({ lastAutoKey: monthKey, updatedAt: new Date() })
          .where(eq(templates.id, t.id));
      } else {
        skipped.push(t.id);
      }
    }

    // Housekeeping: templates whose auto-day was removed should not carry a
    // stale marker into the month they are re-enabled.
    await db
      .update(templates)
      .set({ lastAutoKey: null })
      .where(and(isNull(templates.autoDay), sql`${templates.lastAutoKey} IS NOT NULL`));

    return NextResponse.json({ ok: true, date, due: due.length, created, skipped });
  } catch (error) {
    console.error("Recurring auto-entries failed", error);
    return NextResponse.json({ ok: false, error: "Auto-entry failed" }, { status: 500 });
  }
}

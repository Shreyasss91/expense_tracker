// §2.2 — per-person attributable spend.
// The ledger records WHO SPENT (member_id) but not WHO BENEFITS. With shared
// ownership (transactions.shared + transactions.split_with) each expense is
// either borne by its spender or split across the household. This module turns
// the month's rows into an attribution view: every member's solo spend plus an
// equal share of each shared expense, plus a "household" total of shared spend.

import { and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { members, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import { monthKeySchema } from "@/lib/validations";

export interface MemberAttribution {
  memberId: string;
  /** Attributable spend: solo + this member's equal share of shared expenses. */
  paise: number;
}

export interface AttributionResult {
  perMember: MemberAttribution[];
  /** Total of all shared (household) spend in the month. */
  householdPaise: number;
  /** Grand total spend in the month (sanity check / denominator). */
  totalPaise: number;
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const month = monthKeySchema.parse(monthKey);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Compute per-member attributable spend for a month. Equal-splitting shared
 * expenses keeps the integer-paise invariant: each share is floored and the
 * leftover paise (0…n-1) is handed to the first n members so the parts sum
 * exactly to the original amount.
 */
export async function getMemberAttribution(monthKey: string): Promise<AttributionResult> {
  const { start, end } = monthBounds(monthKey);
  const [rows, memberRows] = await Promise.all([
    db
      .select({
        memberId: transactions.memberId,
        amount: transactions.amount,
        shared: transactions.shared,
        splitWith: transactions.splitWith,
      })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end))),
    db.select({ id: members.id }).from(members),
  ]);

  const allIds = memberRows.map((r) => r.id);
  const idSet = new Set(allIds);
  const personal = new Map<string, number>(allIds.map((id) => [id, 0]));
  let household = 0;
  let total = 0;

  for (const r of rows) {
    const paise = rupeesToPaise(r.amount);
    total += paise;

    if (!r.shared) {
      personal.set(r.memberId, (personal.get(r.memberId) ?? 0) + paise);
      continue;
    }

    household += paise;
    // Targets = the explicit split_with set, filtered to real members; an empty
    // set means "everyone in the household".
    let targets = (r.splitWith ?? []).filter((id) => idSet.has(id));
    if (targets.length === 0) targets = allIds;
    if (targets.length === 0) {
      // No members at all — fall back to crediting the spender.
      personal.set(r.memberId, (personal.get(r.memberId) ?? 0) + paise);
      continue;
    }
    const share = Math.floor(paise / targets.length);
    let remainder = paise - share * targets.length;
    for (const t of targets) {
      const add = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      personal.set(t, (personal.get(t) ?? 0) + add);
    }
  }

  return {
    perMember: allIds.map((id) => ({ memberId: id, paise: personal.get(id) ?? 0 })),
    householdPaise: household,
    totalPaise: total,
  };
}

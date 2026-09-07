/**
 * Digest period math + formatter tests — `npm run test:digest`.
 *
 * The owner's schedule (7th/14th/21st/28th + last day of month, monthly wins
 * on collision) is pure calendar math, so it gets a DB-free test: every date
 * branch, the February 28th collision, 31-day months, manual periods, phone
 * normalization and the wa.me link encoding. The DB-backed aggregates are
 * exercised by the cron against real data.
 */
import {
  buildTelegramDigestMessage,
  buildWhatsAppDigestText,
  buildWhatsAppLink,
  digestPeriodForDate,
  formatWhatsAppPhone,
  monthPeriod,
  monthToDatePeriod,
  normalizeWhatsAppPhone,
  type DigestData,
} from "./digest-format";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const sample: DigestData = {
  start: "2026-09-01",
  end: "2026-09-07",
  totalPaise: 1245000, // ₹12,450
  count: 34,
  recurringPaise: 250000,
  lifestylePaise: 820000,
  oneTimePaise: 175000,
  categories: [
    { name: "Fuel", paise: 310000 },
    { name: "Groceries & Household", paise: 205000 },
  ],
  members: [
    { name: "Dad", paise: 600000 },
    { name: "Mom", paise: 550000 },
    { name: "Son", paise: 95000 },
  ],
};

function main() {
  // --- Weekly periods: 7th/14th/21st/28th anchor to fixed month ranges.
  const d7 = digestPeriodForDate("2026-09-07")!;
  check(d7?.kind === "weekly" && d7.start === "2026-09-01" && d7.end === "2026-09-07", "7th → weekly 1–7");
  const d14 = digestPeriodForDate("2026-09-14")!;
  check(d14?.start === "2026-09-08" && d14?.end === "2026-09-14", "14th → weekly 8–14");
  const d21 = digestPeriodForDate("2026-09-21")!;
  check(d21?.start === "2026-09-15" && d21?.end === "2026-09-21", "21st → weekly 15–21");
  const d28 = digestPeriodForDate("2026-09-28")!;
  check(d28?.start === "2026-09-22" && d28?.end === "2026-09-28", "28th → weekly 22–28");

  // --- Monthly: the last day of the month covers the whole month.
  const sep30 = digestPeriodForDate("2026-09-30")!;
  check(sep30?.kind === "monthly" && sep30?.start === "2026-09-01" && sep30?.end === "2026-09-30", "30 Sep → monthly 1–30 (31-day month)");
  const oct31 = digestPeriodForDate("2026-10-31")!;
  check(oct31?.kind === "monthly" && oct31?.end === "2026-10-31", "31 Oct → monthly to the 31st");

  // --- Collision: February 28th is BOTH a weekly date and the last day —
  // monthly wins (it already spans the week's range).
  const feb28 = digestPeriodForDate("2027-02-28")!;
  check(feb28?.kind === "monthly" && feb28?.start === "2027-02-01" && feb28?.end === "2027-02-28", "28 Feb (leap-adjacent) → monthly wins");
  const feb28b = digestPeriodForDate("2026-02-28")!;
  check(feb28b?.kind === "monthly" && feb28b?.end === "2026-02-28", "28 Feb 2026 → monthly wins");

  // --- Non-digest days → null; malformed dates → null.
  check(digestPeriodForDate("2026-09-05") === null, "5th is not a digest day");
  check(digestPeriodForDate("2026-09-29") === null, "29th is not a digest day (not the last day)");
  check(digestPeriodForDate("2026-02-30") === null, "impossible calendar date rejected");

  // --- Manual periods.
  const mtd = monthToDatePeriod("2026-09-18");
  check(mtd.start === "2026-09-01" && mtd.end === "2026-09-18" && mtd.kind === "mtd", "month-to-date: 1st → today");
  const month = monthPeriod("2026-09");
  check(month.start === "2026-09-01" && month.end === "2026-09-30" && month.label === "September 2026", "month period: full calendar month");
  const feb = monthPeriod("2026-02");
  check(feb.end === "2026-02-28" && feb.label === "February 2026", "month period respects short months");

  // --- Idempotency keys are stable and period-scoped.
  check(d7.key === "2026-09-01..2026-09-07" && d14.key === "2026-09-08..2026-09-14", "period key = start..end (no overlap between weekly periods)");
  check(sep30.key === "2026-09-01..2026-09-30", "monthly period key spans the month");

  // --- Formatters.
  const tg = buildTelegramDigestMessage({ ...sample, label: "1–7 Sep" });
  check(tg.includes("<b>Family Ledger · 1–7 Sep</b>") && tg.includes("Total: <b>₹12,450.00</b> · 34 entries"), "telegram: header + total line");
  check(tg.includes("<b>By tag</b>") && tg.includes("• Lifestyle: ₹8,200.00"), "telegram: tag split");
  check(tg.includes("• Fuel: ₹3,100.00") && tg.includes("• Groceries &amp; Household: ₹2,050.00"), "telegram: categories with HTML escaping");
  check(tg.includes("• Dad: ₹6,000.00") && tg.includes("• Son: ₹950.00"), "telegram: member rows");

  const wa = buildWhatsAppDigestText({ ...sample, label: "1–7 Sep" });
  check(wa.includes("📊 Family Ledger · 1–7 Sep") && wa.includes("Total: *₹12,450.00* · 34 entries"), "whatsapp: header + total with *bold*");
  check(wa.includes("*By tag*") && wa.includes("• Lifestyle: ₹8,200.00"), "whatsapp: tag split");
  check(wa.includes("• Groceries & Household: ₹2,050.00"), "whatsapp: categories plain-text (no HTML escaping)");

  // --- Phone normalization.
  check(normalizeWhatsAppPhone("+91 98765 43210") === "919876543210", "phone: +91 spaced → E.164 digits");
  check(normalizeWhatsAppPhone("919876543210") === "919876543210", "phone: already E.164 passes through");
  check(normalizeWhatsAppPhone("09876543210") === "919876543210", "phone: leading 0 → +91 (10 digits after stripping)");
  check(normalizeWhatsAppPhone("9876543210") === "919876543210", "phone: 10 digits → +91 assumed (India)");
  check(normalizeWhatsAppPhone("123456789012345") === "123456789012345", "phone: 15 digits pass through");
  check(normalizeWhatsAppPhone("12345") === null, "phone: too short rejected");
  check(normalizeWhatsAppPhone("1234567890123456") === null, "phone: too long rejected");
  check(formatWhatsAppPhone("919876543210") === "+91 98765 43210", "phone: display formatting");

  // --- wa.me link: number + URL-encoded digest text.
  const link = buildWhatsAppLink("919876543210", "Total: ₹1,250 · 3 entries");
  check(link === "https://wa.me/919876543210?text=Total%3A%20%E2%82%B91%2C250%20%C2%B7%203%20entries", "wa.me: number + encoded text");

  if (failures > 0) {
    console.error(`✗ Digest layer FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log("✓ Digest layer OK — period math, formatters, phone and wa.me link per the owner's schedule.");
  }
}

main();
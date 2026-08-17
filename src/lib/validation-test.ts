/** DB-free validation regression tests for transaction and month boundaries. */
import { dateSchema, monthKeySchema, timeSchema, transactionSchema } from "./validations";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`✓ ${msg}`);
  else {
    failures += 1;
    console.error(`✗ ${msg}`);
  }
}

const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";

check(dateSchema.safeParse("2026-08-17").success, "valid calendar date accepted");
check(dateSchema.safeParse("2024-02-29").success, "leap-day calendar date accepted");
check(!dateSchema.safeParse("2026-02-29").success, "non-leap February 29 rejected");
check(!dateSchema.safeParse("2026-04-31").success, "April 31 rejected");
check(!dateSchema.safeParse("2026-13-01").success, "month 13 rejected in date");
check(!dateSchema.safeParse("2026-00-01").success, "month 00 rejected in date");

check(timeSchema.safeParse("00:00").success, "00:00 accepted");
check(timeSchema.safeParse("23:59").success, "23:59 accepted");
check(!timeSchema.safeParse("24:00").success, "24:00 rejected");
check(!timeSchema.safeParse("12:60").success, "12:60 rejected");
check(!timeSchema.safeParse("99:99").success, "99:99 rejected");

check(monthKeySchema.safeParse("2026-08").success, "valid month key accepted");
check(!monthKeySchema.safeParse("2026-00").success, "month key 00 rejected");
check(!monthKeySchema.safeParse("2026-13").success, "month key 13 rejected");

const validExpense = {
  memberId: UUID_A,
  categoryId: UUID_B,
  amount: 1000,
  note: null,
  date: "2026-08-17",
  time: "09:30",
  type: "expense" as const,
  tag: "lifestyle" as const,
};
check(transactionSchema.safeParse(validExpense).success, "valid transaction accepts semantic date/time");
check(!transactionSchema.safeParse({ ...validExpense, date: "2026-02-29" }).success, "transaction rejects impossible date");
check(!transactionSchema.safeParse({ ...validExpense, time: "24:00" }).success, "transaction rejects impossible time");

if (failures > 0) {
  console.error(`✗ Validation regression FAILED (${failures} check(s) failed)`);
  process.exitCode = 1;
} else {
  console.log("✓ Semantic validation OK — dates, times, months and transaction boundaries are strict.");
}

import assert from "node:assert/strict";
import { recurringTransactionId } from "./recurring-identity";

const templateId = "981a1de7-1828-48e7-9eaf-db5909323842";
assert.equal(recurringTransactionId(templateId, "2026-09"), recurringTransactionId(templateId, "2026-09"));
assert.equal(recurringTransactionId(templateId.toUpperCase(), "2026-09"), recurringTransactionId(templateId, "2026-09"));
assert.notEqual(recurringTransactionId(templateId, "2026-09"), recurringTransactionId(templateId, "2026-10"));
assert.notEqual(
  recurringTransactionId(templateId, "2026-09"),
  recurringTransactionId("e9ad151e-d90f-4ebc-b57b-f12b7749eea1", "2026-09"),
);
console.log("Recurring identity tests passed");

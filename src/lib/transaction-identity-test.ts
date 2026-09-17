import assert from "node:assert/strict";
import { offlineTransactionId } from "./transaction-identity";

const clientId = "981a1de7-1828-48e7-9eaf-db5909323842";
assert.equal(offlineTransactionId(clientId), offlineTransactionId(clientId));
assert.equal(offlineTransactionId(clientId.toUpperCase()), offlineTransactionId(clientId));
assert.notEqual(offlineTransactionId(clientId), clientId);
assert.notEqual(offlineTransactionId(clientId), offlineTransactionId("e9ad151e-d90f-4ebc-b57b-f12b7749eea1"));
console.log("Transaction identity tests passed");

import assert from "node:assert/strict";
import { enqueuePendingAdd, type PendingAdd } from "./offline-queue";

const entry: PendingAdd = {
  clientId: "981a1de7-1828-48e7-9eaf-db5909323842",
  payload: {
    memberId: "e9ad151e-d90f-4ebc-b57b-f12b7749eea1",
    categoryId: null,
    splitWith: [],
    amount: 100,
    date: "2026-09-17",
    time: "12:00",
    tag: "one_time",
    note: null,
  },
  createdAt: 0,
};

async function main() {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  assert.equal(await enqueuePendingAdd(entry), false);

  for (const outcome of ["complete", "abort", "error", "throw"] as const) {
    let closed = false;
    let settled = false;
    const request = { result: entry.clientId, onsuccess: null as null | (() => void) };
    const transaction = {
      oncomplete: null as null | (() => void),
      onabort: null as null | (() => void),
      onerror: null as null | (() => void),
      objectStore: () => ({ put: () => request }),
    };
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          const opening = {
            result: {
              transaction: () => {
                if (outcome === "throw") throw new Error("Storage unavailable");
                return transaction;
              },
              close: () => { closed = true; },
            },
            onsuccess: null as null | (() => void),
          };
          queueMicrotask(() => opening.onsuccess?.());
          return opening;
        },
      },
    });
    const pending = enqueuePendingAdd(entry).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (outcome !== "throw") {
      request.onsuccess?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(settled, false, "Request success must not acknowledge an uncommitted write");
      transaction["on" + outcome as "oncomplete" | "onabort" | "onerror"]?.();
    }
    assert.equal(await pending, outcome === "complete");
    assert.equal(closed, true);
  }
  console.log("Offline queue durability tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

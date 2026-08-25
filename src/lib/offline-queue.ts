"use client";

import type { TransactionInput } from "@/lib/validations";

/**
 * Offline Quick Add — an IndexedDB queue of entries committed while the
 * device has no network. Each entry stores the exact TransactionInput the
 * sheet would have sent; a sync manager (src/components/pwa/offline-sync.tsx)
 * replays them through the same createTransaction server action once
 * connectivity returns, then removes them.
 *
 * IndexedDB (not localStorage): survives reloads like localStorage but holds
 * structured objects without JSON round-trips, and won't blow up on quota
 * the way a big localStorage blob might. All helpers are no-ops that resolve
 * gracefully when storage is unavailable (private mode, quota errors).
 */

export interface PendingAdd {
  /** Client-generated id — stable across reloads until the entry syncs. */
  clientId: string;
  payload: TransactionInput;
  createdAt: number;
}

const DB_NAME = "family-ledger";
const DB_VERSION = 1;
const STORE = "pending-adds";

/** Fired whenever the pending count changes so UI badges can refresh. */
export const PENDING_SYNC_EVENT = "ledger:pending-sync";
export function emitPendingSync() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PENDING_SYNC_EVENT));
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db!.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function enqueuePendingAdd(entry: PendingAdd): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
  emitPendingSync();
}

export async function listPendingAdds(): Promise<PendingAdd[]> {
  const rows = await withStore<PendingAdd[]>("readonly", (store) => store.getAll() as IDBRequest<PendingAdd[]>);
  return rows ?? [];
}

export async function removePendingAdd(clientId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(clientId));
  emitPendingSync();
}

export async function countPendingAdds(): Promise<number> {
  const n = await withStore<number>("readonly", (store) => store.count());
  return n ?? 0;
}

import { v5 as uuidv5 } from "uuid";

export function offlineTransactionId(clientId: string): string {
  return uuidv5("family-ledger:offline:" + clientId.toLowerCase(), uuidv5.DNS);
}

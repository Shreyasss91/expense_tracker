import { redirect } from "next/navigation";

/**
 * Amendment 20 — the Review tab merged into the Ledger page; this route only
 * preserves old links and bookmarks.
 */
export default function ReviewPage() {
  redirect("/transactions");
}

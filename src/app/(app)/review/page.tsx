import { Metadata } from "next";
import { getReviewPage } from "@/actions/review";
import { getPendingReviewCount } from "@/actions/transactions";
import { ReviewClient } from "./review-client";

export const metadata: Metadata = {
  title: "Review — Family Ledger",
};

export default async function ReviewPage() {
  const pendingCount = await getPendingReviewCount();
  const initialData = await getReviewPage({ cursor: null });

  return (
    <ReviewClient
      initialRows={initialData.rows}
      nextCursor={initialData.nextCursor}
      pendingCount={pendingCount}
    />
  );
}

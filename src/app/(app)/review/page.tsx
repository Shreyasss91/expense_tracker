import { Metadata } from "next";
import { getReviewPage } from "@/actions/review";
import { getPendingReviewCount } from "@/actions/transactions";
import { getMembers } from "@/actions/member";
import { ReviewClient } from "./review-client";

export const metadata: Metadata = {
  title: "Review — Family Ledger",
};

export default async function ReviewPage() {
  const [pendingCount, members] = await Promise.all([getPendingReviewCount(), getMembers()]);
  const initialData = await getReviewPage({ cursor: null });

  return (
    <ReviewClient
      initialRows={initialData.rows}
      nextCursor={initialData.nextCursor}
      pendingCount={pendingCount}
      members={members}
    />
  );
}

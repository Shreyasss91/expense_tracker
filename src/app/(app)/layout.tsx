import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { categories, members } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { QuickAddProvider } from "@/components/quick-add/quick-add-context";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const activeMemberId = cookieStore.get("active_member_id")?.value;

  const [memberRows, categoryRows] = await Promise.all([
    db.select().from(members).orderBy(asc(members.sortOrder)),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
  ]);

  const memberOptions: MemberOption[] = memberRows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    emoji: m.emoji,
    color: m.color,
    sortOrder: m.sortOrder,
  }));
  const categoryOptions: CategoryOption[] = categoryRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    sortOrder: c.sortOrder,
  }));

  const activeId =
    memberOptions.find((m) => m.id === activeMemberId)?.id ?? memberOptions[0]?.id ?? "";

  return (
    <QuickAddProvider
      members={memberOptions}
      categories={categoryOptions}
      activeMemberId={activeId}
    >
      <AppHeader members={memberOptions} activeMemberId={activeId} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-4 md:pb-10">{children}</main>
      <BottomNav />
    </QuickAddProvider>
  );
}

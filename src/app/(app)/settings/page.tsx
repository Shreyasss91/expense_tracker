import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories, members } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { MembersManager } from "@/components/settings/members-manager";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

export const metadata = { title: "Settings — Family Ledger" };

export default async function SettingsPage() {
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

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Members</CardTitle>
          <CardDescription className="text-xs">
            Edit names, emoji, colours and order. Old transactions keep pointing at the right member.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersManager members={memberOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Categories</CardTitle>
          <CardDescription className="text-xs">
            Rename, change emoji, reorder. Deletion is not available — history always keeps its category.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoriesManager categories={categoryOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Password</CardTitle>
          <CardDescription className="text-xs">
            The family password comes from the environment variable{" "}
            <code className="rounded bg-muted px-1">FAMILY_MASTER_PASSWORD</code> and is managed on the
            deployment platform — it can&apos;t be changed from inside the app.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

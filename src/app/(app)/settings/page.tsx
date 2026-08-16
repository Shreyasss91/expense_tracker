import { addMonths, format, parse } from "date-fns";
import { db } from "@/db";
import { budgets } from "@/db/schema";
import { getCategories, getMembers } from "@/lib/meta";
import { monthKeyInIST } from "@/lib/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { MembersManager } from "@/components/settings/members-manager";
import { BudgetManager } from "@/components/settings/budget-manager";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

export const metadata = { title: "Settings — Family Ledger" };

export default async function SettingsPage() {
  const [memberRows, categoryRows, budgetRows] = await Promise.all([
    getMembers(),
    getCategories(),
    db.select().from(budgets),
  ]);

  // Scope options for the budget manager — same 36-month window as the ledger strip, newest first.
  const stripBase = parse(`${monthKeyInIST()}-01`, "yyyy-MM-dd", new Date());
  const months = Array.from({ length: 36 }, (_, i) => {
    const key = format(addMonths(stripBase, i - 35), "yyyy-MM");
    return { key, label: format(parse(`${key}-01`, "yyyy-MM-dd", new Date()), "MMM yyyy") };
  }).reverse();

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
          <CardTitle className="text-sm">Budgets</CardTitle>
          <CardDescription className="text-xs">
            Set a monthly spending limit — a total for the whole month and/or per category. Each month
            can have its own budget; the &ldquo;Every month&rdquo; default is used for months without their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetManager categories={categoryOptions} months={months} initialBudgets={budgetRows} />
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

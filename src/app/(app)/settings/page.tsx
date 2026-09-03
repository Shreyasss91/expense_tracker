import { addMonths, format, parse } from "date-fns";
import { db } from "@/db";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { budgets } from "@/db/schema";
import { getCategories, getMembers, getTemplates } from "@/lib/meta";
import { monthKeyInIST } from "@/lib/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { MembersManager } from "@/components/settings/members-manager";
import { BudgetManager } from "@/components/settings/budget-manager";
import { TemplatesManager } from "@/components/settings/templates-manager";
import { OfflineEntriesManager } from "@/components/settings/offline-entries-manager";
import { PushSetup } from "@/components/pwa/push-setup";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

export const metadata = { title: "Settings — Family Ledger" };

export default async function SettingsPage() {
  const [memberRows, categoryRows, templateRows, budgetRows, excludeBills] = await Promise.all([
    getMembers(),
    getCategories(),
    getTemplates(),
    db.select().from(budgets),
    getExcludeBillsEnabled(db),
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
    parentId: c.parentId,
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
          <CardTitle className="text-sm">Templates</CardTitle>
          <CardDescription className="text-xs">
            Save recurring expenses for one-tap prefills in Quick Add. Set an auto-add day (1–28) and the
            daily cron stamps the entry automatically — the member picker decides whose ledger it lands in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplatesManager templates={templateRows} categories={categoryOptions} members={memberOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Categories</CardTitle>
          <CardDescription className="text-xs">
            Categories live in groups — pick a group in the ledger filter or tap one open in the picker.
            Rename, re-emoji, reorder, move categories between groups, add new ones per group. Only
            categories (never groups) are picked for transactions; deletion is not available.
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
            Set a monthly spending limit — a total for the whole month, per category, and/or per group
            (§2.1). Each month can have its own budget; the &ldquo;Every month&rdquo; default is used for
            months without their own. Categories created in Quick Add appear here automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetManager categories={categoryOptions} months={months} initialBudgets={budgetRows} excludeBills={excludeBills} />
        </CardContent>
      </Card>

      <Card id="offline-entries">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Offline entries</CardTitle>
          <CardDescription className="text-xs">
            Expenses added while offline wait on this device until they sync. Discard any you decided
            against; everything else syncs automatically when you&apos;re back online.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OfflineEntriesManager members={memberOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription className="text-xs">
            Get a push when a budget hits 80% of its limit (with the days left) and when entries are waiting
            to be reviewed. Needs the PWA installed (or at least the service worker registered) and a
            notification permission — and the server&apos;s VAPID keys set on the deployment platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushSetup />
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

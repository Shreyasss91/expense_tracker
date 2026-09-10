import { addMonths, format, parse } from "date-fns";
import { db } from "@/db";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { budgets } from "@/db/schema";
import { getCategories, getMembers, getTemplates } from "@/lib/meta";
import { monthKeyInIST } from "@/lib/dates";
import { SettingsSection } from "@/components/settings/settings-section";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { ActivityHistory } from "@/components/settings/activity-history";
import { MembersManager } from "@/components/settings/members-manager";
import { BudgetManager } from "@/components/settings/budget-manager";
import { TemplatesManager } from "@/components/settings/templates-manager";
import { OfflineEntriesManager } from "@/components/settings/offline-entries-manager";
import { PushSetup } from "@/components/pwa/push-setup";
import { DigestSettingsCard } from "@/components/digest/digest-card";
import { getWhatsAppDigestConfig, getDigestDayContext } from "@/lib/whatsapp-digest";
import { formatSentAtLabel, getRecentDigestSends } from "@/lib/digest";
import { todayInIST } from "@/lib/dates";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

export const metadata = { title: "Settings — Family Ledger" };

export default async function SettingsPage() {
  const [memberRows, categoryRows, templateRows, budgetRows, excludeBills, whatsappConfig, digestToday, recentSends] = await Promise.all([
    getMembers(),
    getCategories(),
    getTemplates(),
    db.select().from(budgets),
    getExcludeBillsEnabled(db),
    getWhatsAppDigestConfig(),
    getDigestDayContext(todayInIST()),
    getRecentDigestSends(),
  ]);
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

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

      <SettingsSection id="members" title="Members" description="Edit names, emoji, colours and order. Old transactions keep pointing at the right member.">
        <MembersManager members={memberOptions} />
      </SettingsSection>

      <SettingsSection
        id="templates"
        title="Templates"
        description="Save recurring expenses for one-tap prefills in Quick Add. Set an auto-add day (1–28) and the daily cron stamps the entry automatically — the member picker decides whose ledger it lands in."
      >
        <TemplatesManager templates={templateRows} categories={categoryOptions} members={memberOptions} />
      </SettingsSection>

      <SettingsSection
        id="categories"
        title="Categories"
        description="Categories live in groups — pick a group in the ledger filter or tap one open in the picker. Rename, re-emoji, reorder, move categories between groups, add new ones per group. Only categories (never groups) are picked for transactions; deletion is not available."
      >
        <CategoriesManager categories={categoryOptions} />
      </SettingsSection>

      <SettingsSection
        id="budgets"
        title="Budgets"
        description="Set a monthly spending limit — a total for the whole month, per category, and/or per group (§2.1). Each month can have its own budget; the &ldquo;Every month&rdquo; default is used for months without their own. Categories created in Quick Add appear here automatically."
      >
        <BudgetManager categories={categoryOptions} months={months} initialBudgets={budgetRows} excludeBills={excludeBills} />
      </SettingsSection>

      <SettingsSection
        id="history"
        title="History"
        description="Every delete and merge, with who and when. Deleted expenses can be restored — merges are listed for reference."
      >
        <ActivityHistory />
      </SettingsSection>

      <SettingsSection
        id="offline-entries"
        title="Offline entries"
        description="Expenses added while offline wait on this device until they sync. Discard any you decided against; everything else syncs automatically when you&apos;re back online."
      >
        <OfflineEntriesManager members={memberOptions} />
      </SettingsSection>

      <SettingsSection
        id="whatsapp-digest"
        title="WhatsApp &amp; Telegram digest"
        description="A weekly digest (7th, 14th, 21st, 28th) and a monthly one (last day of the month) arrive at 10 PM. Telegram delivers automatically when its env vars are set; WhatsApp uses Click-to-Chat — the app opens WhatsApp with the digest pre-filled and you tap Send. Manual sends for any month, or this month so far, are below."
      >
        <DigestSettingsCard
          telegramConfigured={telegramConfigured}
          whatsappPhone={whatsappConfig.phone}
          whatsappEnabled={whatsappConfig.enabled}
          digestToday={digestToday ? { label: digestToday.period.label, waUrl: digestToday.waUrl } : null}
          lastSends={recentSends.map((s) => ({ channel: s.channel, label: s.label, sentAtLabel: formatSentAtLabel(s.sentAt) }))}
          months={months}
        />
      </SettingsSection>

      <SettingsSection
        id="notifications"
        title="Notifications"
        description="Get a push when a budget hits 80% of its limit (with the days left) and when entries are waiting to be reviewed. Needs the PWA installed (or at least the service worker registered) and a notification permission — and the server&apos;s VAPID keys set on the deployment platform."
      >
        <PushSetup />
      </SettingsSection>

      <SettingsSection id="password" title="Password">
        <p className="text-xs text-muted-foreground">
          The family password comes from the environment variable{" "}
          <code className="rounded bg-muted px-1">FAMILY_MASTER_PASSWORD</code> and is managed on the
          deployment platform — it can&apos;t be changed from inside the app.
        </p>
      </SettingsSection>
    </div>
  );
}

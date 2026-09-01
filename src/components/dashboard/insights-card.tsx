import Link from "next/link";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Insight, InsightSeverity } from "@/lib/insights";

/**
 * §2.8 — renders the diagnostic insights as a card at the top of the
 * dashboard. Warnings (uncategorized, hot categories) are coloured red/amber
 * so they read as "look at this"; info items (record closeness, MoM mover)
 * are neutral. Each links into the filtered ledger slice it describes.
 */
const ICON: Record<InsightSeverity, typeof Info> = {
  warning: AlertTriangle,
  info: Info,
  positive: Lightbulb,
};

const TONE: Record<InsightSeverity, string> = {
  warning: "text-amber-600",
  info: "text-muted-foreground",
  positive: "text-emerald-600",
};

export function InsightsCard({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Lightbulb className="size-4" /> Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((ins) => {
          const Icon = ICON[ins.severity];
          const body = (
            <div className="flex items-start gap-2">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE[ins.severity])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-tight">{ins.title}</p>
                {ins.detail && <p className="text-[11px] text-muted-foreground">{ins.detail}</p>}
              </div>
            </div>
          );
          return ins.href ? (
            <Link key={ins.id} href={ins.href} className="block rounded-lg p-1.5 transition-colors hover:bg-muted">
              {body}
            </Link>
          ) : (
            <div key={ins.id} className="rounded-lg p-1.5">
              {body}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

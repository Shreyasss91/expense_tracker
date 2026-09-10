"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "settings:section:";

/** Window events for the page-level "Expand all" / "Collapse all" controls. */
export const SETTINGS_EXPAND_ALL_EVENT = "settings:expand-all";
export const SETTINGS_COLLAPSE_ALL_EVENT = "settings:collapse-all";

/**
 * A collapsible settings card. The header (title + description) is the toggle —
 * tap it to expand/collapse the content below. Each section remembers its own
 * open/closed state across visits (best-effort localStorage), and a URL hash
 * like #whatsapp-digest opens that section on load so deep links still land on
 * the content.
 */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
      if (stored !== null) setOpen(stored === "1");
      else if (window.location.hash === `#${id}`) setOpen(true);
    } catch {
      // storage unavailable — keep the default
    }
  }, [id]);

  const persist = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, v ? "1" : "0");
    } catch {
      // best-effort persistence
    }
  }, [id]);

  function handleOpenChange(v: boolean) {
    setOpen(v);
    persist(v);
  }

  // Page-level Expand all / Collapse all — each section flips itself and
  // persists the result like a manual toggle.
  useEffect(() => {
    function handleExpandAll() {
      setOpen(true);
      persist(true);
    }
    function handleCollapseAll() {
      setOpen(false);
      persist(false);
    }
    window.addEventListener(SETTINGS_EXPAND_ALL_EVENT, handleExpandAll);
    window.addEventListener(SETTINGS_COLLAPSE_ALL_EVENT, handleCollapseAll);
    return () => {
      window.removeEventListener(SETTINGS_EXPAND_ALL_EVENT, handleExpandAll);
      window.removeEventListener(SETTINGS_COLLAPSE_ALL_EVENT, handleCollapseAll);
    };
  }, [persist]);

  return (
    <Card id={id}>
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-start justify-between gap-2 text-left outline-none select-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <div className="min-w-0">
                <CardTitle className="text-sm">{title}</CardTitle>
                {description && <CardDescription className="text-xs">{description}</CardDescription>}
              </div>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
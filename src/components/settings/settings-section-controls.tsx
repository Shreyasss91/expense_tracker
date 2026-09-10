"use client";

import { Button } from "@/components/ui/button";
import { SETTINGS_COLLAPSE_ALL_EVENT, SETTINGS_EXPAND_ALL_EVENT } from "./settings-section";

/**
 * Page-level Expand all / Collapse all for the collapsible settings cards.
 * Each SettingsSection listens for these window events and flips itself, so
 * the buttons work no matter how many sections the page renders.
 */
export function SettingsSectionControls() {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => window.dispatchEvent(new Event(SETTINGS_EXPAND_ALL_EVENT))}
      >
        Expand all
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => window.dispatchEvent(new Event(SETTINGS_COLLAPSE_ALL_EVENT))}
      >
        Collapse all
      </Button>
    </div>
  );
}
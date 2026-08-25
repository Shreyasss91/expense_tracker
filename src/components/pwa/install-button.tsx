"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Renders an "Install" action only while the browser is offering the PWA
 * install (beforeinstallprompt). Chrome on Android/desktop fires it once
 * installability criteria are met (manifest + icons + SW — see middleware
 * and public/sw.js); iOS Safari never does, so nothing renders there and
 * users keep using Share → Add to Home Screen.
 */
export function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent || installed) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
      onClick={() => {
        void promptEvent.prompt().then(() => setPromptEvent(null));
      }}
      aria-label="Install app"
    >
      <Download className="h-4 w-4" /> Install
    </Button>
  );
}

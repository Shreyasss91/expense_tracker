"use client";

import { useEffect, useState } from "react";
import { Share, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsDesktop } from "@/lib/use-media-query";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * §3.5 — iOS install affordance. Chrome fires beforeinstallprompt and gets
 * the native dialog; iOS Safari never does, which meant the app showed NO
 * install path on the platform where a household PWA is most likely to be
 * installed. On iOS (standalone-capable, not already standalone, no prompt
 * event) we render a "How to install" hint explaining Share → Add to Home
 * Screen. Chrome keeps the one-tap Install button.
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as Mac but has no mouse events.
  const isIPad = navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform ?? "");
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || isIPad;
}

export function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHintOpen, setIosHintOpen] = useState(false);
  const isDesktop = useIsDesktop();

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

  // Already running as an installed PWA — no install UI needed.
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  if (installed || isStandalone) return null;

  // Chrome/Android path — the native install dialog.
  if (promptEvent) {
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

  // §3.5 — iOS Safari path: a short "how to" hint instead of nothing.
  if (isIOS()) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
          onClick={() => setIosHintOpen(true)}
          aria-label="How to install this app on iPhone or iPad"
        >
          <Share className="h-4 w-4" /> Install
        </Button>
        <Sheet open={iosHintOpen} onOpenChange={setIosHintOpen}>
          <SheetContent
            side={isDesktop ? "right" : "bottom"}
            className={
              isDesktop
                ? "flex h-full w-full max-w-md flex-col rounded-l-2xl px-4 py-4 sm:px-6"
                : "mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
            }
            showCloseButton
          >
            <h2 className="text-sm font-semibold">Install on iPhone / iPad</h2>
            <ol className="mt-2 space-y-2 overflow-y-auto pb-4 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1.</span> Open this page in <span className="font-medium text-foreground">Safari</span> (it must be Safari — other browsers can&apos;t install).
              </li>
              <li>
                <span className="font-medium text-foreground">2.</span> Tap the <span className="font-medium text-foreground">Share</span> button {" "}
                <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share icon" /> in the toolbar.
              </li>
              <li>
                <span className="font-medium text-foreground">3.</span> Scroll down and tap <span className="font-medium text-foreground">Add to Home Screen</span>.
              </li>
              <li>
                <span className="font-medium text-foreground">4.</span> Confirm — Ledger appears on your home screen and works like any app.
              </li>
            </ol>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return null;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * §2.11 — the opt-in surface for Web Push. The server already computes budget
 * pacing and review reminders; this is the switch that wires a device into
 * receiving them.
 *
 * It is deliberately lazy about everything env-dependent:
 *  - No public VAPID key → the toggle is hidden (the server can't sign, so
 *    there is nothing to subscribe against).
 *  - Unsupported browser (no Notification / no serviceWorker / no pushManager)
 *    → hidden. No broken button, no error toast.
 *  - Permission denied → reflected in the label, with a pointer to the browser
 *    settings, rather than a silent dead control.
 *
 * Subscribe/unsubscribe round-trip through /api/push, which owns the DB row
 * and the session check.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "enabled" | "disabled" | "denied";

export function PushSetup() {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(vapidKey);

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setStatus(existing ? "enabled" : "disabled");
    } catch {
      setStatus("disabled");
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    if (!supported || !vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled");
        toast.error("Notifications permission was not granted");
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const raw = subscription.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: raw.endpoint, keys: raw.keys } }),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setStatus("enabled");
      toast.success("Notifications enabled");
    } catch (error) {
      console.error(error);
      toast.error("Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe().catch(() => {});
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
      }
      setStatus("disabled");
      toast.success("Notifications disabled");
    } catch (error) {
      console.error(error);
      toast.error("Could not disable notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!supported || status === "loading" || status === "unsupported") return null;

  if (status === "denied") {
    return (
      <p className="text-xs text-muted-foreground">
        Notifications are blocked in this browser. Enable them in the site settings to get budget and review reminders.
      </p>
    );
  }

  const enabled = status === "enabled";
  return (
    <Button variant={enabled ? "secondary" : "outline"} size="sm" disabled={busy} onClick={enabled ? disable : enable} className="h-8 gap-1.5">
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : enabled ? (
        <BellOff className="h-3.5 w-3.5" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      {enabled ? "Disable notifications" : "Enable notifications"}
    </Button>
  );
}

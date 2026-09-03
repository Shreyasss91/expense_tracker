"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registers public/sw.js in production and keeps it current. Dev is skipped
 * on purpose — Next's HMR and a caching worker fight over the same URLs.
 *
 * §3.5 — the update path. Previously this registered once on load and never
 * checked again, so every future deploy served from a stale cache until the
 * user cleared site data. Now:
 *
 *  - On load and on every visibility change to visible, `registration.update()`
 *    asks the server for a new sw.js byte compare.
 *  - `updatefound` → the installing worker finishes → since sw.js calls
 *    skipWaiting(), the new worker activates immediately and we tell the
 *    user with a toast offering reload. `controllerchange` (for users who
 *    arrived at a mid-session update) reloads once.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          // A worker from an earlier page load may already be waiting.
          if (registration.waiting) {
            navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
            toast.info("Update installed", {
              description: "A new version is ready.",
              action: { label: "Reload", onClick: () => window.location.reload() },
            });
            return;
          }
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                // sw.js's skipWaiting() activates it the moment it installs;
                // the controllerchange listener below reloads the page once.
                navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
              }
            });
          });
          // Check for updates on load and whenever the tab becomes visible.
          const check = () => void registration.update().catch(() => undefined);
          check();
          document.addEventListener("visibilitychange", onVisibility);
          function onVisibility() {
            if (document.visibilityState === "visible") check();
          }
        })
        .catch(() => {
          // best-effort — the app works fine without it
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

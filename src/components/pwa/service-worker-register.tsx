"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js in production. Dev is skipped on purpose — Next's
 * HMR and a caching worker fight over the same URLs.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // best-effort — the app works fine without it
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

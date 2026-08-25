import Link from "next/link";

export const metadata = { title: "Offline — Family Ledger" };

/** Service-worker fallback for navigations with no network and no cached copy. */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="text-4xl">📒</span>
      <h1 className="mt-3 text-lg font-semibold">You&apos;re offline</h1>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        The ledger needs a connection to load. Entries you add while offline are
        queued and sync automatically once you&apos;re back.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Try again
      </Link>
    </div>
  );
}

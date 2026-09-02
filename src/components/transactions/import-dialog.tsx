"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ImportSource, ImportSummary } from "@/lib/import-types";

/**
 * §2.10 — the restore half of "export and backup". Export was one-way; this is
 * the way back.
 *
 * Two-step by design. A restore writes rows into the live ledger, so the sheet
 * first shows exactly what the file contains — how many rows are new, how many
 * are already present, which members/categories it couldn't match — and only
 * then offers a button. Nothing is written on preview.
 *
 * Reads it can accept:
 *   .json             the full-fidelity backup (preferred — keeps ids)
 *   16-column CSV     the "CSV — full" export (also keeps ids)
 *   7-column CSV      the canonical seed.csv shape (no ids; matched on
 *                     date+time+member+amount+note so a re-run is a no-op)
 */
const SOURCE_LABEL: Record<ImportSource, string> = {
  json: "JSON backup",
  "csv-extended": "CSV — full (16 columns)",
  "csv-canonical": "CSV — 7-column",
};

type Phase = "idle" | "reading" | "preview" | "committing";

async function post(file: File, mode: "preview" | "commit"): Promise<Response> {
  const text = await file.text();
  return fetch(`/api/import?mode=${mode}`, {
    method: "POST",
    // The parser is chosen by filename extension, so it rides in a header.
    headers: { "content-type": "text/plain;charset=UTF-8", "x-filename": file.name },
    body: text,
  });
}

export function ImportButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setFile(null);
    setSummary(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(next: File) {
    setError(null);
    setSummary(null);
    setFile(next);
    setPhase("reading");
    try {
      const res = await post(next, "preview");
      const body = (await res.json()) as { ok?: boolean; error?: string; summary?: ImportSummary };
      if (!res.ok || !body.ok || !body.summary) {
        setError(body.error ?? "Could not read that file");
        setPhase("idle");
        return;
      }
      setSummary(body.summary);
      setPhase("preview");
    } catch {
      setError("Upload failed — check the connection and try again");
      setPhase("idle");
    }
  }

  async function commit() {
    if (!file) return;
    setPhase("committing");
    try {
      const res = await post(file, "commit");
      const body = (await res.json()) as { ok?: boolean; error?: string; inserted?: number; skipped?: number };
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Restore failed");
        setPhase("preview");
        return;
      }
      toast.success(`Restored ${body.inserted ?? 0} entries${body.skipped ? ` · ${body.skipped} already present` : ""}`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("Restore failed");
      setPhase("preview");
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" />
        Import
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) void handleFile(next);
        }}
      />

      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <SheetContent side="right" className="gap-3 overflow-y-auto">
          <div className="pr-8">
            <h2 className="text-base font-semibold">Restore from a backup</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Import a CSV or JSON export back into the ledger. Nothing is written until you confirm.
            </p>
          </div>

          {!summary && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={phase === "reading"}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
            >
              <FileUp className="h-6 w-6" />
              <span className="font-medium text-foreground">
                {phase === "reading" ? "Reading file…" : "Choose a .json or .csv export"}
              </span>
              <span className="text-xs">Up to 5 MB</span>
            </button>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          {summary && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">{file?.name}</p>
                <p className="text-xs text-muted-foreground">{SOURCE_LABEL[summary.source]}</p>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Rows in file" value={summary.total} />
                <Stat label="Will be added" value={summary.ready} tone={summary.ready > 0 ? "good" : "muted"} />
                <Stat label="Already present" value={summary.duplicate} tone="muted" />
                <Stat label="Unreadable" value={summary.invalid} tone={summary.invalid > 0 ? "warn" : "muted"} />
              </dl>

              {summary.unresolvedCategory > 0 && (
                <Note tone="warn">
                  {summary.unresolvedCategory} row(s) name a category that doesn&apos;t exist (
                  {summary.unresolvedCategoryNames.join(", ")}) — they&apos;ll import as uncategorized.
                </Note>
              )}
              {summary.unresolvedMember > 0 && (
                <Note tone="warn">
                  {summary.unresolvedMember} row(s) name a member that doesn&apos;t exist (
                  {summary.unresolvedMemberNames.join(", ")}) — those rows will be skipped.
                </Note>
              )}
              {summary.attachmentsReferenced > 0 && (
                <Note tone="muted">
                  This backup references {summary.attachmentsReferenced} receipt file(s). Photos aren&apos;t stored in
                  the backup, so they&apos;ll need re-attaching after the restore.
                </Note>
              )}

              {summary.issues.length > 0 && (
                <details className="rounded-lg border p-3 text-xs">
                  <summary className="cursor-pointer font-medium">
                    {summary.issues.length} row-level problem(s)
                  </summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {summary.issues.map((issue) => (
                      <li key={`${issue.row}-${issue.message}`}>
                        Row {issue.row}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" disabled={summary.ready === 0 || phase === "committing"} onClick={commit}>
                  {phase === "committing" ? "Restoring…" : `Restore ${summary.ready} entries`}
                </Button>
                <Button variant="outline" onClick={reset} disabled={phase === "committing"}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Re-running the same file is safe — rows already in the ledger are matched on their id (JSON / full CSV)
                or on date + time + member + amount + note (7-column CSV).
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "muted" }) {
  const toneClass =
    tone === "good"
      ? "text-primary"
      : tone === "warn"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <div className="rounded-lg border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone: "warn" | "muted" }) {
  return (
    <p
      className={`flex gap-2 rounded-md px-3 py-2 text-xs ${
        tone === "warn" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      }`}
    >
      {tone === "warn" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

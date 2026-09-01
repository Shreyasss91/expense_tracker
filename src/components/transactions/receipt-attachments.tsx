"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  RECEIPT_MAX_PER_TRANSACTION,
  formatBytes,
} from "@/lib/attachments";
import {
  deleteReceipt,
  prepareReceipt,
  uploadReceipt,
  validateReceipt,
  type UploadedReceipt,
} from "@/lib/receipt-client";

interface Staged {
  key: string;
  file: File;
  previewUrl: string;
}

/**
 * §2.9 — receipt capture / preview / remove.
 *
 * Two modes, because capture happens at two different moments:
 *  - `transactionId` set (the edit dialog): files upload immediately and the
 *    list is the authoritative one.
 *  - `transactionId` null (Quick Add, before the row exists): files are staged
 *    locally with object-URL previews and handed to the parent through
 *    `onPendingChange`; the parent uploads them once the server returns a real
 *    transaction id. Staging keeps capture instant — the user is not blocked
 *    on a round trip while the rest of the form is still being filled in.
 */
export function ReceiptAttachments({
  transactionId,
  initial = [],
  onUploadedChange,
  onPendingChange,
  disabled = false,
  label = "Receipts",
}: {
  transactionId: string | null;
  initial?: UploadedReceipt[];
  onUploadedChange?: (items: UploadedReceipt[]) => void;
  onPendingChange?: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [items, setItems] = useState<UploadedReceipt[]>(initial);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Object URLs are released when the staged entry is removed or on unmount;
  // leaking them pins the whole decoded image in memory for the tab's lifetime.
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;

  // Re-sync when a different row is opened (the edit dialog keeps one instance
  // mounted and swaps the row underneath it).
  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    const current = stagedRef.current;
    return () => {
      for (const s of current) URL.revokeObjectURL(s.previewUrl);
    };
  }, []);

  function setStagedNext(next: Staged[]) {
    setStaged(next);
    onPendingChange?.(next.map((s) => s.file));
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const room = RECEIPT_MAX_PER_TRANSACTION - items.length - staged.length;
    if (room <= 0) {
      toast.error(`At most ${RECEIPT_MAX_PER_TRANSACTION} receipts per transaction`);
      return;
    }

    const accepted: File[] = [];
    for (const file of incoming.slice(0, room)) {
      const problem = validateReceipt(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      accepted.push(await prepareReceipt(file));
    }
    if (incoming.length > room) {
      toast.error(`Only ${room} more ${room === 1 ? "receipt" : "receipts"} can be added here`);
    }
    if (accepted.length === 0) return;

    if (transactionId === null) {
      setStagedNext([
        ...staged,
        ...accepted.map((file) => ({
          key: `${file.name}-${crypto.randomUUID()}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
      return;
    }

    setBusy(true);
    const uploaded: UploadedReceipt[] = [];
    let failure: string | null = null;
    for (const file of accepted) {
      try {
        uploaded.push(await uploadReceipt(transactionId, file));
      } catch (error) {
        failure = error instanceof Error ? error.message : "Upload failed";
        break;
      }
    }
    setBusy(false);
    if (uploaded.length > 0) {
      const next = [...items, ...uploaded];
      setItems(next);
      onUploadedChange?.(next);
    }
    if (failure) toast.error(failure);
  }

  async function removeUploaded(id: string) {
    setBusy(true);
    try {
      await deleteReceipt(id);
      const next = items.filter((i) => i.id !== id);
      setItems(next);
      onUploadedChange?.(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the receipt");
    }
    setBusy(false);
  }

  function removeStaged(key: string) {
    const target = staged.find((s) => s.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    setStagedNext(staged.filter((s) => s.key !== key));
  }

  const total = items.length + staged.length;
  const canAdd = total < RECEIPT_MAX_PER_TRANSACTION && !disabled && !busy;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {label}
          {total > 0 ? ` · ${total}/${RECEIPT_MAX_PER_TRANSACTION}` : " (optional)"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={!canAdd}
          onClick={() => inputRef.current?.click()}
          aria-label="Attach a receipt"
        >
          <Upload className="size-3" />
          {busy ? "Uploading…" : "Attach"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        // `capture` is a hint, not a restriction: on mobile it opens the camera
        // directly, while desktop still shows a normal file picker.
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          // reset so re-picking the same file fires change again
          e.target.value = "";
        }}
      />

      {total === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Photograph the bill at capture time — month-end reconciliation becomes a glance.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.id} className="relative">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block h-16 w-16 overflow-hidden rounded-lg border bg-muted"
                aria-label={`Open receipt (${formatBytes(item.sizeBytes)})`}
              >
                {item.contentType.startsWith("image/") ? (
                  // Receipts are user-supplied photos streamed from an authed
                  // proxy route; next/image's optimiser cannot read through it,
                  // and re-encoding a 64px thumbnail would cost more than it saves.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <Paperclip className="size-5 text-muted-foreground" />
                  </span>
                )}
              </a>
              <button
                type="button"
                onClick={() => void removeUploaded(item.id)}
                disabled={busy}
                aria-label="Remove receipt"
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-destructive shadow-sm"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}

          {staged.map((s) => (
            <li key={s.key} className="relative">
              {/* Not yet uploaded — a blob: object URL, so next/image has
                  nothing to optimise and no loader could resolve it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.previewUrl}
                alt=""
                className="h-16 w-16 rounded-lg border object-cover opacity-70"
              />
              <button
                type="button"
                onClick={() => removeStaged(s.key)}
                aria-label="Remove staged receipt"
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-destructive shadow-sm"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

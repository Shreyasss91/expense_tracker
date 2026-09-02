import "server-only";

/**
 * §2.10 — scheduled monthly backup delivery.
 *
 * The audit's ask: "a scheduled monthly email/Telegram of the CSV". The
 * Telegram digest foundation already exists (see src/lib/telegram-digest.ts,
 * same idempotency pattern via app_settings), so this reuses its shape and
 * adds the actual *file* — a CSV attachment, not just a summary message.
 *
 * The artefact is deliberately the CANONICAL 7-column CSV: it is the one
 * format that round-trips with `db:seed` and with /api/import, so a backup
 * sitting in an inbox is directly restorable rather than merely readable.
 *
 * Both channels are env-gated and independent. Neither configured is a 503,
 * not a success — a backup job that silently does nothing is worse than one
 * that fails loudly:
 *
 *   Telegram   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   (sendDocument)
 *   Email      RESEND_API_KEY + BACKUP_EMAIL_TO + BACKUP_EMAIL_FROM
 *
 * Email is a scaffold in the same sense as the Blob storage in §2.9: the code
 * path is complete and correct against Resend's documented API, but it needs
 * those three variables (and no extra dependency — it is one fetch).
 */
import { format, parse } from "date-fns";
import { db } from "@/db";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { collectExportRows } from "@/lib/export-rows";
import {
  CANONICAL_CSV_HEADER,
  EXPORT_ROW_CAP,
  backupFilename,
  canonicalCsvLine,
} from "@/lib/export-format";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthKeySchema } from "@/lib/validations";
import { previousMonthInIST } from "@/lib/telegram-digest";

const SENT_KEY_PREFIX = "backup_sent:";

export type DeliveryStatus = "sent" | "skipped" | "failed";

export interface BackupResult {
  ok: boolean;
  status?: number;
  error?: string;
  month: string;
  rows: number;
  /** True when the row cap cut the month short — the backup is incomplete. */
  truncated: boolean;
  bytes: number;
  channels: { telegram: DeliveryStatus; email: DeliveryStatus };
  detail?: string;
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const month = monthKeySchema.parse(monthKey);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * The canonical CSV for one month — header, then rows in ledger order.
 * Built from the batched iterator rather than one giant SELECT, so a busy
 * month can't OOM the cron function (§1.10).
 *
 * `totalPaise` is summed from the typed rows, never by re-parsing the CSV —
 * a note containing a comma would silently shift the amount column.
 */
export async function buildMonthCsv(
  month: string,
): Promise<{ csv: string; rows: number; truncated: boolean; totalPaise: number }> {
  const { start, end } = monthBounds(month);
  const { rows, truncated } = await collectExportRows({ from: start, to: end }, { cap: EXPORT_ROW_CAP });
  const lines = rows.map(canonicalCsvLine);
  const totalPaise = rows.reduce((sum, row) => sum + rupeesToPaise(row.amount), 0);
  return { csv: [CANONICAL_CSV_HEADER, ...lines].join("\n") + "\n", rows: rows.length, truncated, totalPaise };
}

function summaryLine(month: string, rows: number, totalPaise: number, truncated: boolean): string {
  const label = format(parse(`${month}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy");
  const total = rows === 0 ? "no entries" : `${rows} ${rows === 1 ? "entry" : "entries"} · ${formatINR(totalPaise)}`;
  const warning = truncated ? " (truncated — see the cap in export-format.ts)" : "";
  return `Family Ledger · ${label} — ${total}${warning}`;
}

async function sendTelegram(csv: string, filename: string, caption: string): Promise<DeliveryStatus> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return "skipped";

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("document", new Blob([csv], { type: "text/csv; charset=utf-8" }), filename);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!response.ok || body?.ok !== true) {
      console.error("Telegram backup upload failed", response.status, body?.description);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("Telegram backup upload threw", error);
    return "failed";
  }
}

/**
 * Email delivery through Resend's REST API. Chosen over an SMTP library
 * because it is one fetch and zero dependencies; swap the endpoint/body if the
 * household uses another provider — nothing else in the file changes.
 */
async function sendEmail(csv: string, filename: string, subject: string): Promise<DeliveryStatus> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.BACKUP_EMAIL_TO;
  const from = process.env.BACKUP_EMAIL_FROM;
  if (!apiKey || !to || !from) return "skipped";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: `${subject}\n\nThe CSV is attached. It is in the app's canonical 7-column format, so it can be imported straight back with /api/import or db:seed.`,
        attachments: [{ filename, content: Buffer.from(csv, "utf8").toString("base64") }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error("Backup email failed", response.status, await response.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("Backup email threw", error);
    return "failed";
  }
}

/**
 * Build and deliver one month's CSV backup. Idempotent per (month): a second
 * run for the same month is a no-op, so a cron retry after a partial failure
 * cannot double-deliver (it *can* re-deliver after a failure, which is the
 * right way round).
 */
export async function sendMonthlyBackup(month = previousMonthInIST()): Promise<BackupResult> {
  const parsedMonth = monthKeySchema.safeParse(month);
  if (!parsedMonth.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid month",
      month,
      rows: 0,
      truncated: false,
      bytes: 0,
      channels: { telegram: "skipped", email: "skipped" },
    };
  }
  const key = parsedMonth.data;

  const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const hasEmail = Boolean(process.env.RESEND_API_KEY && process.env.BACKUP_EMAIL_TO && process.env.BACKUP_EMAIL_FROM);
  if (!hasTelegram && !hasEmail) {
    return {
      ok: false,
      status: 503,
      error: "No backup channel is configured",
      month: key,
      rows: 0,
      truncated: false,
      bytes: 0,
      channels: { telegram: "skipped", email: "skipped" },
    };
  }

  const sentKey = `${SENT_KEY_PREFIX}${key}`;
  if (await getAppSetting(db, sentKey)) {
    return {
      ok: true,
      month: key,
      rows: 0,
      truncated: false,
      bytes: 0,
      channels: { telegram: "skipped", email: "skipped" },
      detail: "already_sent",
    };
  }

  const { csv, rows, truncated, totalPaise } = await buildMonthCsv(key);
  const filename = backupFilename(key, "csv");
  const caption = summaryLine(key, rows, totalPaise, truncated);

  const [telegram, email] = await Promise.all([
    hasTelegram ? sendTelegram(csv, filename, caption) : Promise.resolve<DeliveryStatus>("skipped"),
    hasEmail ? sendEmail(csv, filename, caption) : Promise.resolve<DeliveryStatus>("skipped"),
  ]);

  const bytes = Buffer.byteLength(csv, "utf8");
  const anyFailed = telegram === "failed" || email === "failed";

  // Only mark sent when at least one channel actually delivered — otherwise a
  // total failure would burn the idempotency key and silently skip next month.
  if (!anyFailed) await setAppSetting(db, sentKey, new Date().toISOString());

  return {
    ok: !anyFailed,
    status: anyFailed ? 502 : 200,
    ...(anyFailed ? { error: "At least one backup channel failed; the month is not marked as sent" } : {}),
    month: key,
    rows,
    truncated,
    bytes,
    channels: { telegram, email },
  };
}

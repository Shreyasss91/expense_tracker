"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveWhatsAppDigest, sendDigestManual } from "@/actions/digest";
import { formatWhatsAppPhone } from "@/lib/digest-format";

/**
 * Digest surface (owner schedule — 7th/14th/21st/28th + month-end at 10 PM).
 *
 * Telegram sends are fully automatic from the cron; these controls are for
 * configuration and manual sends. WhatsApp is Click-to-Chat: "sending" opens
 * wa.me with the digest pre-filled and the household taps Send in WhatsApp.
 *
 * Two variants share this file:
 *   - DigestSettingsCard (full)  — Settings: number + auto toggle + manual sends.
 *   - DigestDashboardCard (compact) — dashboard: ready-banner + quick sends.
 */

interface DigestDayInfo {
  /** e.g. "1–7 Sep" / "September 2026" */
  label: string;
  /** Pre-filled wa.me link for today's due digest (null = WhatsApp not ready). */
  waUrl: string | null;
}

interface BaseProps {
  telegramConfigured: boolean;
  /** Normalized digits (e.g. "919876543210") or null when unset. */
  whatsappPhone: string | null;
  digestToday: DigestDayInfo | null;
}

interface SettingsProps extends BaseProps {
  whatsappEnabled: boolean;
  /** Month options, newest first, { key: 'yyyy-MM', label } — same 36-month window as the ledger. */
  months: { key: string; label: string }[];
}

type BusyKey = string | null;

function SendButton({
  busyKey,
  onSend,
  channel,
  label,
  className,
}: {
  busyKey: BusyKey;
  onSend: () => void;
  channel: "telegram" | "whatsapp";
  label: string;
  className?: string;
}) {
  const busy = busyKey === `${channel}-${label}`;
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={onSend}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : channel === "whatsapp" ? <MessageCircle className="size-3.5" /> : <Send className="size-3.5" />}
      {channel === "whatsapp" ? "WhatsApp" : "Telegram"}
    </Button>
  );
}

export function DigestSettingsCard({ telegramConfigured, whatsappPhone, whatsappEnabled, digestToday, months }: SettingsProps) {
  const router = useRouter();
  const [phoneInput, setPhoneInput] = useState(whatsappPhone ? formatWhatsAppPhone(whatsappPhone) : "");
  const [enabled, setEnabled] = useState(whatsappEnabled);
  const [month, setMonth] = useState<string>(months[0]?.key ?? "");
  const [busy, setBusy] = useState<BusyKey>(null);

  async function save() {
    setBusy("save");
    const res = await saveWhatsAppDigest({ phone: phoneInput, enabled });
    setBusy(null);
    if (res.ok) {
      setPhoneInput(formatWhatsAppPhone(res.phone));
      toast.success("WhatsApp digest settings saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save settings");
    }
  }

  async function send(channel: "telegram" | "whatsapp", period: "month" | "mtd" | "ready") {
    const key = `${channel}-${period}`;
    setBusy(key);
    const res = await sendDigestManual({ channel, period, month: period === "month" ? month : undefined });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "Could not send digest");
      return;
    }
    if (channel === "whatsapp" && "url" in res && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast.success("WhatsApp opened — tap Send to deliver the digest");
    } else {
      toast.success("Digest sent on Telegram");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="digest-auto" className="text-sm font-medium">
            Automatic weekly digest
          </Label>
          <p className="text-xs text-muted-foreground">
            On the 7th, 14th, 21st, 28th (weekly) and the last day of the month (monthly), at 10 PM —
            Telegram delivers automatically, WhatsApp pings your devices and the dashboard shows a
            one-tap send.
          </p>
        </div>
        <Switch
          id="digest-auto"
          checked={enabled}
          disabled={busy !== null}
          onCheckedChange={(next) => {
            setEnabled(next);
            void (async () => {
              setBusy("toggle");
              const res = await saveWhatsAppDigest({ phone: phoneInput, enabled: next });
              setBusy(null);
              if (!res.ok) {
                setEnabled(!next);
                toast.error(res.error ?? "Could not save setting");
              } else {
                toast.success(next ? "Automatic digest on" : "Automatic digest off");
                router.refresh();
              }
            })();
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="digest-phone" className="text-xs text-muted-foreground">
            WhatsApp number (recipient)
          </Label>
          <Input
            id="digest-phone"
            inputMode="tel"
            placeholder="+91 98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className="w-56"
          />
        </div>
        <Button onClick={save} disabled={busy !== null} className="gap-1.5">
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
          Save number
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {whatsappPhone ? (
          <>
            WhatsApp: <span className="font-medium text-foreground">{formatWhatsAppPhone(whatsappPhone)}</span>
          </>
        ) : (
          "WhatsApp is not configured — enter a number above. Manual sends open WhatsApp with the digest pre-filled; you tap Send."
        )}
        {" · "}
        {telegramConfigured ? (
          "Telegram: connected (env vars)"
        ) : (
          "Telegram: not configured — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable automatic sends"
        )}
      </p>

      {digestToday && (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <p className="text-sm font-semibold">📊 {digestToday.label} digest is due today</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {digestToday.waUrl ? (
              <a href={digestToday.waUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-1.5">
                  <MessageCircle className="size-3.5" />
                  Send on WhatsApp
                </Button>
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">
                {whatsappPhone ? "WhatsApp sends are off — turn on the automatic toggle above." : "Save a WhatsApp number to enable one-tap sending."}
              </span>
            )}
            <SendButton busyKey={busy} channel="telegram" label="ready" onSend={() => void send("telegram", "ready")} className="px-3" />
          </div>
        </div>
      )}

      <div className="space-y-3 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Send now (manual — always allowed)</p>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">full month</span>
          <SendButton busyKey={busy} channel="telegram" label="month" onSend={() => void send("telegram", "month")} />
          <SendButton busyKey={busy} channel="whatsapp" label="month" onSend={() => void send("whatsapp", "month")} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">This month (1st → today)</span>
          <SendButton busyKey={busy} channel="telegram" label="mtd" onSend={() => void send("telegram", "mtd")} />
          <SendButton busyKey={busy} channel="whatsapp" label="mtd" onSend={() => void send("whatsapp", "mtd")} />
        </div>
      </div>
    </div>
  );
}

export function DigestDashboardCard({ telegramConfigured, whatsappPhone, digestToday }: BaseProps) {
  const [busy, setBusy] = useState<BusyKey>(null);

  async function send(channel: "telegram" | "whatsapp", period: "month" | "mtd" | "ready") {
    const key = `${channel}-${period}`;
    setBusy(key);
    const res = await sendDigestManual({ channel, period });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "Could not send digest");
      return;
    }
    if (channel === "whatsapp" && "url" in res && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast.success("WhatsApp opened — tap Send to deliver the digest");
    } else {
      toast.success("Digest sent on Telegram");
    }
  }

  return (
    <CardBody>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Digest</p>
        <a href="/settings#whatsapp-digest" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Configure
        </a>
      </div>

      {digestToday ? (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-2.5">
          <p className="text-xs font-medium">📊 {digestToday.label} digest is due</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {digestToday.waUrl ? (
              <a href={digestToday.waUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs">
                  <MessageCircle className="size-3" />
                  Send on WhatsApp
                </Button>
              </a>
            ) : (
              <span className="text-[11px] leading-tight text-muted-foreground">
                {whatsappPhone ? "WhatsApp sends are off — enable in Settings." : "Add a WhatsApp number in Settings to one-tap send."}
              </span>
            )}
            <SendButton busyKey={busy} channel="telegram" label="ready" onSend={() => void send("telegram", "ready")} className="h-7 px-2.5 text-xs" />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Next automatic digest: the 7th, 14th, 21st, 28th and the last day of the month at 10 PM.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground">This month (1st → today):</span>
        <SendButton busyKey={busy} channel="whatsapp" label="mtd" onSend={() => void send("whatsapp", "mtd")} className="h-7 px-2.5 text-xs" />
        <SendButton busyKey={busy} channel="telegram" label="mtd" onSend={() => void send("telegram", "mtd")} className="h-7 px-2.5 text-xs" />
        {!telegramConfigured && <span className="text-[11px] text-muted-foreground">(Telegram needs env vars)</span>}
      </div>
    </CardBody>
  );
}

/** Slim card wrapper matching the dashboard's Card look without importing Card in both variants. */
function CardBody({ children }: { children: ReactNode }) {
  return <div className="space-y-2 rounded-xl border bg-card p-3">{children}</div>;
}
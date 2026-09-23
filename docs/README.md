# Documentation index

Everything a reader, an implementer or a future agent needs is in this folder. It is organised by
**what a document is for**, not by when it was written — the one exception is `audits/`, which is
dated because a point-in-time record is the whole point of it.

| Folder | What lives there | Standing |
|---|---|---|
| [`specs/`](specs/) | The normative specification, its numbered amendments, and the per-feature companion spec | **Normative.** `specs/master-spec.md` is ❄️ **FROZEN** |
| [`plans/`](plans/) | Implementation plans and runbooks for one component, with the reasoning attached | Normative for the component it covers |
| [`runbooks/`](runbooks/) | Printable, tick-box procedures for a sitting at a device, each step labelled with the device and tool it belongs to | Normative; defers to its plan on every point of substance |
| [`audits/`](audits/) | Dated full-project audits and their findings | **Historical.** A snapshot of the day it names, never updated |
| [`changelog.md`](changelog.md) | The amendment log: every authorized deviation from the frozen spec | **Governance record.** Annotated, never rewritten |

---

## Start here

| If you want to… | Read |
|---|---|
| Understand what the product is | [`specs/master-spec.md`](specs/master-spec.md) — §1 first, then the section you need |
| Know why a decision was made, and when | [`changelog.md`](changelog.md) — newest entries first |
| Build or change a feature | The `specs/` companion for it, then the relevant `plans/` |
| Set up the phone that posts the nightly WhatsApp feed | [`runbooks/phone-setup-checklist.md`](runbooks/phone-setup-checklist.md), with [`plans/whatsapp-agent-termux.md`](plans/whatsapp-agent-termux.md) as the *why* |
| Know what a past audit found | `audits/`, by date |

---

## The documents

### `specs/`

| File | What it is |
|---|---|
| [`master-spec.md`](specs/master-spec.md) | The frozen master specification (v1.3). **Do not edit it.** Every amendment to it is recorded in [`changelog.md`](changelog.md), because the spec is frozen and entries exist only because the owner explicitly authorized each change |
| [`daily-ledger-whatsapp-feed.md`](specs/daily-ledger-whatsapp-feed.md) | The companion spec for the daily ledger-change WhatsApp feed: the 24-hour window, the endpoint contract, the message format, and the one authorized deviation (a mutating `POST /api/digest/day`, §15.1) |
| [`amendment-07-member-reassignment.md`](specs/amendment-07-member-reassignment.md) | Amendment 7: member identity is authoritative for **creation** only; editing an existing transaction may intentionally reassign its member |

### `plans/`

| File | What it is |
|---|---|
| [`whatsapp-agent-termux.md`](plans/whatsapp-agent-termux.md) | The Termux + Baileys phone agent: every decision, the scheduler, the retry ladder, the exit codes, and the acceptance tests that need a real device. §12 analyses the **deferred** alternative host (pair once on a home box instead of the phone); §13 records the Baileys dependency pin and what v7 changes |

### `runbooks/`

| File | What it is |
|---|---|
| [`phone-setup-checklist.md`](runbooks/phone-setup-checklist.md) | The printable, tick-box run sheet for the one sitting on Dad's phone — derived from the plan's §3, §4 and §7, with a *Where:* line on every step so it is clear which machine takes each command |

### `audits/`

| File | What it is |
|---|---|
| [`2026-09-01.md`](audits/2026-09-01.md) | The 1 September 2026 full-project audit and its remediation |
| [`2026-09-17.md`](audits/2026-09-17.md) | The 17 September 2026 audit and its findings |

An audit is a record of what was true on its date. It is not corrected when the code moves on — for
the current state, read the spec it audited and the changelog entries that followed it.

---

## Governance in one place

1. **`specs/master-spec.md` is frozen.** No deviations, no "helpful" additions. A genuine conflict
   between it and reality is **raised, not patched**.
2. **Every authorized change is recorded in [`changelog.md`](changelog.md)**, in the house style:
   the decision, the reasoning, what was verified, and what was deliberately *not* changed.
3. **Superseded entries are annotated, never rewritten.** An earlier data point stays in the record
   rather than being overwritten, so a movement like `51 → 63 → 93` remains legible. This is why
   dated entries may name a file under a path it no longer has — see below.
4. **A companion spec may not contradict the master spec.** Where one could, it says so explicitly
   and records the owner authorization that permits the deviation.
5. **Secrets never appear in any of these files** — master spec §7, and the security section of the
   phone agent's own README.

---

## A note on paths (September 2026)

`docs/` was reorganised into `specs/`, `plans/`, `runbooks/` and `audits/`, and the filenames became
lowercase kebab-case. Cross-references were updated mechanically, **including inside dated changelog
and audit entries**, so any reference you find in this tree currently resolves.

The rename map, for anything that predates the move — an old bookmark, a link in a commit message,
a quote in a chat:

| Was | Is now |
|---|---|
| `docs/SPEC.md` | [`docs/specs/master-spec.md`](specs/master-spec.md) |
| `docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md` | [`docs/specs/daily-ledger-whatsapp-feed.md`](specs/daily-ledger-whatsapp-feed.md) |
| `docs/SPEC_AMENDMENT_7_MEMBER_REASSIGNMENT.md` | [`docs/specs/amendment-07-member-reassignment.md`](specs/amendment-07-member-reassignment.md) |
| `docs/PLAN_WHATSAPP_AGENT_TERMUX.md` | [`docs/plans/whatsapp-agent-termux.md`](plans/whatsapp-agent-termux.md) |
| `docs/PHONE_SETUP_CHECKLIST.md` | [`docs/runbooks/phone-setup-checklist.md`](runbooks/phone-setup-checklist.md) |
| `docs/AUDIT-2026-09-01.md` | [`docs/audits/2026-09-01.md`](audits/2026-09-01.md) |
| `docs/AUDIT-2026-09-17.md` | [`docs/audits/2026-09-17.md`](audits/2026-09-17.md) |
| `docs/CHANGELOG.md` | [`docs/changelog.md`](changelog.md) |

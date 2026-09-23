# Implementation Plan — Termux + Baileys WhatsApp Agent (Dad's Samsung phone)

| | |
|---|---|
| **Document status** | 📝 DRAFT — implementation plan + operational runbook, awaiting build |
| **Date** | 18 September 2026 |
| **Device** | Dad's **Samsung** phone (One UI), Android |
| **Owner decisions** | Samsung · Termux:Boot **yes** · retry **capped** · sender = Dad's number · pairing-code linking |
| **Companion spec** | `docs/specs/daily-ledger-whatsapp-feed.md` — **§6 is the contract** for what the agent must do. This document is the *how* and the *operate* |
| **Supersedes** | SPEC §6.5's "**prefer QR by default**" — see [§1.1](#11-superseded-qr-linking). A QR cannot be scanned by the same phone displaying it |

> **Division of responsibility.** The companion spec owns the *contract*: the window, the
> message format, the endpoints, the markers, the security rules. This document owns the
> *device*: app installs, Samsung's background-killer settings, the agent's module structure,
> the group-JID discovery run, the 22:00 scheduler, and the failure runbook.
>
> **Nothing here changes the app side.** The app-side half of the companion spec (§5, its
> "Part A") ships independently of anything in this document.

---

## 1. Confirmed Constraints & Decisions

### 1.1 Superseded: QR linking

The companion spec's §6.5 said *"Prefer QR by default; support `--pair`"*. **That is wrong and
is superseded by this document.**

**Why:** the agent runs on Dad's phone. A QR code rendered by Termux *on that phone* cannot be
scanned by that same phone. There is one phone and one camera.

> **Normative (this document):** the **pairing code** flow is the **only** supported linking
> method. The agent exposes no QR mode. The alternative — render the QR on a laptop, link,
> then copy the `auth/` folder to the phone — is explicitly rejected: it copies live WhatsApp
> session credentials over an untrusted path and breaks the moment WhatsApp re-keys.

The pairing-code flow is arguably *easier* anyway: WhatsApp → **Linked devices** → **Link with
phone number instead** → type the 8-digit code shown in Termux.

### 1.2 Decision table

| # | Decision | Value | Rationale |
|---|---|---|---|
| P1 | Device | Dad's **Samsung** (One UI) | Owner's phone; near-stock Android with Samsung-specific extra steps |
| P2 | Linking | **Pairing code** | QR is physically impossible on one phone (§1.1) |
| P3 | Auto-start | **Termux:Boot installed** | A reboot would otherwise silently stop the feed |
| P4 | Retry | **Capped and persisted**: ≈2, 5, 15, 30 min after a failure, then stop for the night | Self-heals a blip; cannot hammer WhatsApp during an outage. **Persisted to disk** so a restart cannot re-run a consumed ladder (§6.4) |
| P5 | Send time | **22:00 IST** daily | Matches the existing digest cron |
| P6 | Sender | Dad's WhatsApp number | Owner decision D9 |
| P7 | Destination | A **new dedicated group** (Dad, Mom, Son) | Owner decision D8 |
| P8 | Empty window | Post **nothing** | Owner decision D7 |
| P9 | Stale window | **Refuse to post** | Owner decision / spec §5.1 |
| P10 | Scheduler | **In-process timer + 60 s self-healing tick**, wrapped by `start.sh` | Not `termux-job-scheduler` — see §6.3 |
| P11 | Transport | Baileys (`@whiskeysockets/baileys`, unofficial) | Accepted risk, recorded in the changelog |
| P12 | Single instance | A **lock file** in `sent/` guards every mode | Stops a `--now` run from racing the live scheduler into a double post or a corrupt session (§5.9) |

### 1.3 What is NOT this agent's job

Restating the companion spec's §6.6, because it is the most likely thing to get wrong:

- **No formatting.** It posts the server's string verbatim. No rupee formatting, no category
  names, no date maths.
- **No database access.**
- **No knowledge of the window** beyond echoing back the `windowKey` it received.
- **No second target group.**
- It never reads incoming messages. The channel is one-directional.

---

## 2. Deliverables

### 2.1 Committed to the repository

**Built 18 September 2026.** These files exist in the repository; nothing in this section is
still to be written.

```text
tools/whatsapp-agent/
├── README.md            # the human-facing setup, distilled from §3 below
├── agent.mjs            # the agent (§5)
├── agent-test.ts        # repo-side contract test — `npm run test:whatsapp-agent` (§7)
├── rehearse.mjs         # laptop rehearsal vs a stub — `npm run rehearse:whatsapp-agent` (§7)
├── package.json         # dependencies: baileys, and deliberately nothing else
├── .npmrc               # `legacy-peer-deps` — keeps `sharp` out of the install (§3.4)
├── config.example.json  # committed template — placeholders only
├── start.sh             # wake-lock + crash-restart wrapper
└── boot/termux-boot.sh  # copy of the Termux:Boot script (§3.8)
```

`.npmrc` is a **deliverable, not a convenience.** Baileys declares `sharp` as a *non-optional*
peer dependency, so a plain `npm install` resolves the entire `sharp` platform matrix — a native
module, and precisely the class of dependency that breaks an install on Termux. The agent sends
plain text, so no peer dependency is ever imported at runtime. Removing that file turns the
documented `npm install` into a native build failure on the phone.

`agent-test.ts` sits in the agent's directory but runs from the **repository root** and is not
shipped to the phone — it imports the server's real window implementation to pin the two halves
together (§7).

### 2.2 Present on the phone only — **never committed**

| Path | Contents | Protection |
|---|---|---|
| `config.json` | API base URL, bearer token, group JID | `chmod 600`, gitignored |
| `auth/` | Baileys multi-file session state | gitignored |
| `sent/<windowKey>.json` | Local anti-double-post markers | gitignored (`sent/` wholesale) |
| `sent/retry-state.json` | The **persisted retry ladder** (§6.4) | gitignored |
| `sent/agent.lock` | Single-instance lock, holding the owning PID (§5.9) | gitignored |
| `agent.log` | Rotating run log | gitignored |

> **Runtime state lives under `sent/` deliberately.** The directory is already gitignored, so
> the lock and the retry state need no new ignore rule. A file is a **marker** only when its
> name is exactly `<windowKey>.json`; `agent.lock` and `retry-state.json` are never markers.

> **Mandatory, and easy to forget:** add all four to `.gitignore` **before** the first commit
> that touches this directory, then confirm with `git status` that nothing under `auth/` or
> `config.json` is staged. `auth/` contains credentials equivalent to a logged-in WhatsApp
> session; `config.json` contains the bearer token.

---

## 3. One-Time Phone Setup

Do these in order. Steps 3.2 (Samsung battery) and 3.8 (boot) are the ones that decide
whether this runs for months or dies on day three.

> **Doing this for real?** [`docs/runbooks/phone-setup-checklist.md`](../runbooks/phone-setup-checklist.md) is this
> section as a printable tick-box run sheet, ending with the eight acceptance checks worth doing
> on the day. Print it and work down it — transcribing steps from prose onto a phone is where
> things get skipped, and a skipped step here fails silently and days later.

### 3.1 Install the apps

1. **Termux** — from **F-Droid** or the GitHub releases page. **Not** the Play Store build:
   it is deprecated and will not install a current Node.
2. **Termux:Boot** — also from F-Droid (see §3.8). Termux:Boot only works when it is
   installed from the *same* source as Termux, so install both from F-Droid.

### 3.2 Samsung (One UI) background-killer settings — **do not skip**

Samsung is considerably better than Xiaomi here, but its defaults will still eventually kill
Termux. Names shift slightly between One UI versions; the setting is always one of these.

| Setting | Where (One UI) | Set it to |
|---|---|---|
| Battery usage | Settings → **Apps → Termux → Battery** | **Unrestricted** |
| Remove from "Sleeping apps" | Settings → **Battery and device care → Battery → Background usage limits** | Ensure Termux is **not** in *Sleeping apps*; add it to **Never sleeping apps** |
| Unused-app sleeping | Same screen → *Put unused apps to sleep* | **Off** — or confirm Termux is exempted |
| Auto-optimise daily | Battery and device care → ⋮ → **Automation** | **Off** (or confirm Termux is excluded) |
| Keep the app in memory | Open **Recents**, tap the Termux card's icon → **Keep open** / *Lock this app* | **On** |
| Auto time | Settings → **General management → Date and time** | **Automatic date and time** on |
| Repeat for Termux:Boot | Same battery screens | **Unrestricted** |

> **Why the lock matters:** without it, a low-memory moment can evict the process and the
> nightly post stops with no visible symptom — the log simply has no line for that day.

Also grant Termux **notification** permission when asked; `start.sh` acquires a wake-lock,
which surfaces a persistent notification, and a denied notification permission makes the
wake-lock harder to reason about.

### 3.3 Termux packages

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
node --version          # expect a current LTS major
```

Termux needs **no** native build toolchain for this agent. Baileys is **pure JavaScript**, and
none of its optional peer dependencies is installed (§3.4) — that is precisely why this design
works on Android at all.

### 3.4 Get the agent onto the phone

Either clone the repo:

```sh
git clone https://github.com/Shreyasss91/expense_tracker.git ~/expense_tracker
cd ~/expense_tracker/tools/whatsapp-agent
```

…or copy just the `tools/whatsapp-agent` folder over (the agent has no dependency on the rest
of the repo). Then:

```sh
npm install
```

**The package name is `@whiskeysockets/baileys` — normative.** Baileys is published to npm
under that scope; the unscoped `baileys` package is the abandoned older line, and most
tutorials predate the move. A fresh implementer must not have to guess or "verify at install
time":

```sh
npm install @whiskeysockets/baileys
```

Pin the major version in `package.json`.

Two consequences that matter on Termux:

- **Node.js ≥ 20 is required.** Baileys enforces this with a `preinstall` check that fails with
  a clear message, so an old `node` surfaces at install rather than at runtime.
- **Install no optional peer dependency.** `jimp`/`sharp`, `link-preview-js`, `ffmpeg` and
  `audio-decode` only unlock image/sticker thumbnails, link previews, video thumbnails and audio
  processing. This agent sends **plain text only**, so none of them is needed — and `sharp` is
  exactly the native dependency that would otherwise break the Termux install.

### 3.5 Configure

```sh
cp config.example.json config.json
chmod 600 config.json
```

Fill in `apiUrl`, `token` and **`phone`** now. Leave `groupJid` empty — §4 discovers it.

```jsonc
{
  "apiUrl": "https://<your-deployment>.vercel.app",
  "token": "<DIGEST_AGENT_TOKEN>",
  "phone": "919876543210",     // Dad's number — E.164 DIGITS ONLY, no "+", no spaces
  "groupJid": "",              // discovered in §4
  "sendAt": "22:00",
  "timezone": "Asia/Kolkata"
}
```

> **`phone` is normative, not optional.** `--link` cannot request a pairing code without it, so
> a reader who copies a template lacking the field gets a failure on the very first command. It
> is the same field name in `config.example.json` (committed) and `config.json` (device-only);
> `--phone <E164>` overrides it. `loadConfig()` validates it as **digits only** (`/^\d{8,15}$/`)
> and fails with exit `2` otherwise — never strip characters silently, because a silently
> mangled number requests a code for somebody else's phone.

Generate the token (on any machine) with 32 random bytes:

```sh
openssl rand -hex 32
```

Set the **same** value on Vercel as `DIGEST_AGENT_TOKEN`, then redeploy.

### 3.6 Create the group

From **Dad's phone**, create a new WhatsApp group with Mom and Son. Give it a clear name —
it will appear in the group list during discovery in §4.

Do **not** create it from Mom's phone: the sender is Dad's account, and a group Dad is not in
cannot be posted to.

### 3.7 Link the device (pairing code)

```sh
node agent.mjs --link
```

The agent prints an **8-digit pairing code** and the E.164 number it is requesting it for.
On the phone:

1. WhatsApp → **Settings** → **Linked devices** → **Link a device**
2. Choose **"Link with phone number instead"**
3. Type the 8-digit code

On success the agent writes the session into `auth/` and exits `0`. The device now appears in
WhatsApp's Linked devices list, exactly as a WhatsApp Web session would.

#### When the code is requested — normative

**Do not call `requestPairingCode()` immediately after creating the socket.** That is the
single most common way this step fails, and it fails with a `Connection Closed` error that
looks like a WhatsApp-side problem rather than an ordering mistake (Baileys issue #1382).
Baileys' own documentation is explicit: *"The `qr` field in `connection.update` fires even in
pairing code mode. Use it as your trigger to call `requestPairingCode` rather than calling it
immediately after creating the socket, because the socket may not be ready yet."*

The exact sequence, in order:

1. If `sock.authState.creds.registered === true` → the session is already linked; **do not
   request a code**. Log `already linked`, wait for `open`, exit `0`. (Guards the common case
   of re-running `--link` out of habit.)
2. Wait for the **first `qr` event** on `connection.update` and use it purely as a **trigger**.
   The QR **string is never rendered or printed** — a QR is unusable here (§1.1) and printing
   one only invites someone to try scanning it.
3. `const code = await sock.requestPairingCode(phone)` → print the 8-digit code.
4. On `connection === 'open'` → log success, exit `0`.
5. If no `qr` arrives within **60 s** of connecting, or no `open` arrives within **5 min** of
   printing the code → log the recovery guidance (*"re-run `node agent.mjs --link`; if the code
   was already used, check WhatsApp → Linked devices"*) and exit `8` — a `--link` timeout
   (§5.8). Do **not** loop.
6. Never set the deprecated `printQRInTerminal` option.

**Requirements and caveats:**

- The number must be in E.164 digits with **no leading `+`** (e.g. `919876543210`). Provide it
  via `--phone` or the `phone` field in the config (§3.5 — the field is normative).
- Baileys' documentation notes the pairing-code flow links **one device per phone number**. If a
  pairing-code device already exists for Dad's number, remove it in WhatsApp → **Linked
  devices** first, or the new request may not take.
- WhatsApp allows only a handful of linked devices (**4**). If the list is full, remove a
  stale entry first.
- If the code expires, re-run `--link`. Codes are short-lived by design.
- **One-time only.** The session persists in `auth/` across restarts. There is no need to
  re-link after a reboot, a Termux restart, or a config edit.

### 3.8 Install the boot hook

```sh
mkdir -p ~/.termux/boot
cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
chmod +x ~/.termux/boot/termux-boot.sh
```

The script is deliberately minimal — it releases any stale wake-lock, takes a fresh one, and
launches the wrapper:

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/expense_tracker/tools/whatsapp-agent"
nohup ./start.sh >> boot.log 2>&1 &
```

Then open **Termux:Boot once** (launch it from the app drawer after installing) — the app does
nothing until it has been launched at least once, and this is the single most common reason a
boot hook silently does nothing.

> **Test it, do not assume it.** Reboot the phone, wait two minutes, and confirm the process is
> alive (§7, Test 8). An untested boot hook is not a feature.

### 3.9 Start it

```sh
cd ~/expense_tracker/tools/whatsapp-agent
./start.sh
```

---

## 4. The Group-JID Discovery Run

The agent addresses the group by **JID**, not by phone number. A group JID looks like
`1203630xxxxxxxxx@g.us`. It must be discovered from the linked account — there is no formula
that derives it from the group's name or members.

### 4.1 Prerequisite

The device must already be linked (§3.7). `--groups` opens the existing session; it does not
link.

### 4.2 Why it must be done after linking

The group list comes from the account's own state (`groupFetchAllParticipating()` on the
Baileys socket). Before linking, the account is anonymous and the call has nothing to return.

### 4.3 The run

```sh
cd ~/expense_tracker/tools/whatsapp-agent
node agent.mjs --groups
```

Expected output — one line per group, name first, JID last so the JID is easy to copy:

```text
Waiting for connection…
Connected as 91••••••3210
3 groups:
  Family Ledger               1203630xxxxxxxxx@g.us
  Family                      1203630yyyyyyyyy@g.us
  School – Parents            1203630zzzzzzzzz@g.us
```

Then paste the intended JID into `config.json` and **verify**:

```sh
node agent.mjs --groups | grep "$(node -e "console.log(require('./config.json').groupJid)")"
```

A match means the configured JID exists and the account is a participant.

### 4.4 Behavioural notes — normative

- `--groups` **exits 0** after printing. It is not a long-running mode.
- It **never sends** anything.
- **Allow for sync delay.** Immediately after a first link, WhatsApp streams history and the
  group list may be incomplete for a few seconds. If the new group is missing, wait ~30 s and
  re-run — do not conclude the group is unreachable.
- **A JID is not permanent.** If the group is ever deleted and recreated with the same name,
  the new group has a **new JID**. The nightly post would then fail; the fix is to re-run
  `--groups` and update `config.json`. Recreating the group only happens deliberately, so the
  practical risk is low — but it belongs in the runbook (§9).
- The group name is **never** used for addressing. Two groups may share a name; only the JID
  is authoritative. Do not "helpfully" match on name.

---

## 5. The Agent

### 5.1 Module breakdown — `agent.mjs`

One file is appropriate at this size. Functions and their single responsibilities:

| Function | Responsibility | Notes |
|---|---|---|
| `loadConfig()` | Read + validate `config.json` | Fail loudly on a missing `apiUrl`, `token` or `phone`; validate `sendAt` is `HH:MM`, `timezone` present, `phone` digits-only. Never log the token. |
| `log(level, msg, meta?)` | Timestamped (IST) line to stdout and `agent.log` | Rotate past ~1 MB |
| `acquireLock()` / `releaseLock()` | `sent/agent.lock` — exclusive create, holding the owning PID | §5.9. Taken by **every** mode; contention exits `7` |
| `connect()` | `useMultiFileAuthState('auth')` + `makeWASocket` | Returns `{ sock, saveCreds }`; wires the `creds.update` listener. **No QR option** (§1.1) |
| `runLink(phone)` | Wait for the first `qr` event as a **trigger**, `requestPairingCode(phone)`, print the code, wait for `open`, exit | One-shot; persists `auth/`. The **ordering is normative** (§3.7) |
| `runListGroups()` | Print `name → jid` for every group, exit | §4 |
| `lastBoundary(now)` | The **most recent** 22:00 IST instant `≤ now` | Pure. This is the window the agent targets, and it must mirror SPEC §5.1 exactly |
| `nextBoundary(now)` | The next **22:00 IST** instant as a UTC instant | Pure; **never** uses the device timezone |
| `windowKeyFor(endInstant)` | `"<startDateIst>..<endDateIst>"` for a 24 h window ending at a boundary | Byte-identical to the server's `window.key` — this is the idempotency contract |
| `effectiveNow()` | Resolve the evaluation instant | `--at` → that instant; otherwise the wall clock |
| `shouldEvaluate(now)` | The **pre-network gate**: local key, marker, exhaustion, `nextAttemptAt` | §6.1. Returns `{ run, key, state }`; `run: false` means **no fetch at all** |
| `hasLocalMarker(key)` / `writeLocalMarker(key)` | `sent/<key>.json` | Primary anti-double-post guard; written temp-file + `rename` (§5.9) |
| `loadRetryState()` / `saveRetryState(s)` | `sent/retry-state.json` | **Persisted** ladder, so a restart cannot reset it (§6.4) |
| `recordFailure(state, now)` | Advance the ladder and persist it | **Never** writes a marker |
| `clearState(key)` | Drop the ladder state for a finished window | Called on success and on every non-failure outcome |
| `fetchDigest(now)` | `GET {apiUrl}/api/digest/day` with the bearer token, 20 s timeout | Appends `?at=` when `--at` was given; status codes handled per §5.4 |
| `post(text)` | `sock.sendMessage(groupJid, { text })` | Verbatim; no formatting |
| `confirm(key)` | `POST {apiUrl}/api/digest/day` with `{ windowKey, status }` | Best-effort — see §5.6 |
| `tick()` | One evaluation of "should I post right now?" | §6.1; the whole scheduler is this function plus a timer |
| `main()` | CLI dispatch + the timer loop | `--link`, `--groups`, `--now`, `--at`, `--dry-run` |

### 5.2 CLI surface

| Flag | Behaviour |
|---|---|
| *(none)* | Long-running scheduler mode — the production path (§6) |
| `--link` | Pairing-code linking, then exit (§3.7) |
| `--groups` | Print group JIDs, then exit (§4) |
| `--now` | Run one evaluation **immediately, at the real wall clock**, then exit |
| `--at <ISO>` | Run one evaluation **as if `now` were that instant**, then exit. The instant is also passed to the endpoint as `?at=` (SPEC §5.5.2), so the **window, the freshness judgement and the rendered text** are all computed for that instant |
| `--dry-run` | With `--now` or `--at`: fetch and print the message, **send nothing**, write no markers |
| `--phone <E164>` | Number for `--link` (else `config.phone`) |

`--dry-run`, `--now` and `--at` exist so the whole path can be exercised without spamming the
family group. They are the agent's test harness (§7).

**`--at` is not a convenience — it is what makes the tests runnable.** `FEED_GRACE_MS` is 6 h
(SPEC §5.1), so the window ending at the most recent boundary is **stale for 18 hours of every
day**. Without `--at`, a real-send rehearsal is only possible between 22:00 and 04:00, and any
test run at another hour is refused as stale — which left the acceptance tests with no
procedure a human could actually follow.

**Every mode takes the single-instance lock (§5.9), so a one-shot mode cannot be run while the
scheduler is alive.** Stop it first (`pkill -f agent.mjs`). That is deliberate: two processes
sharing one `auth/` directory corrupt the session, and two processes evaluating one window can
both post.

### 5.3 Connecting — and the 401 rule

Baileys emits a `connection.update` event. Two cases matter:

- `connection === "open"` → the session is live. Arm the scheduler.
- `connection === "close"` **with `lastDisconnect.error.output.statusCode === 401`** → WhatsApp
  has **unlinked the device** (someone removed it from Linked devices, or the session was
  invalidated).

> **Normative:** on a 401, do **not** reconnect in a loop. Log a clear, greppable line
> (`RE-LINK REQUIRED: run 'node agent.mjs --link'`) and **exit `3`** (§5.8). A silent retry loop
> against an invalidated session looks identical to a healthy agent from the outside, which is
> the worst possible failure mode.

For any other close reason, reconnect with exponential backoff (e.g. 5 s doubling to a 5 min
cap).

### 5.4 The fetch, and its status codes

```js
const res = await fetch(`${cfg.apiUrl}/api/digest/day`, {
  headers: { authorization: `Bearer ${cfg.token}` },
  signal: AbortSignal.timeout(20_000),
});
```

| Status | Meaning | Agent action |
|---|---|---|
| `200` | Normal | Evaluate the body (§5.5) |
| `401` | Token missing or wrong | Log loudly, **exit `4`** (§5.8). **Do not retry in a tight loop** — a wrong token will not fix itself |
| `503` | `DIGEST_AGENT_TOKEN` absent on the server | Log loudly, **exit `4`** — not a transient condition, so it never reaches the ladder |
| `4xx` other | Bad request (should not happen) | Log, **exit `1`** (generic fatal) |
| `5xx` / network error | Transient | Feed the retry ladder (§6.4). **Do not exit** — exiting loses the remaining attempts |
| *(fetch throws / times out)* | Transient | Same as above: `recordFailure()` (§6.4), not an exit |

The response body is the contract from the companion spec §5.5.2.

### 5.5 Deciding whether to post — the exact order

Evaluate **in this order**, and stop at the first match:

| # | Condition | Action |
|---|---|---|
| 1 | `hasLocalMarker(localKey)` | Already posted this window → log, finish. `localKey` is computed **locally** (§6.1) and asserted equal to `body.window.key` |
| 2 | `body.alreadySent === true` | The server recorded it → log, finish |
| 3 | `body.disabled === true` | Owner switched the feed off → log, finish |
| 4 | `body.stale === true` | Window too old → log **"stale, not posting"**, finish |
| 5 | `body.empty === true` or `body.text === null` | Nothing changed → log, finish |
| 6 | otherwise | `post(body.text)` → on success write the local marker, then `confirm()` |

**Order matters.** Checking `stale` before `empty` is not cosmetic: a stale *and* empty window
is a different log line from a fresh empty one, and that distinction is what makes the log
diagnosable at 22:00.

**These six steps are the second gate, not the first.** Marker, exhaustion and `nextAttemptAt`
are all checked **before any network call** (§6.1), because the tick runs every 60 s and must
not poll a database-backed endpoint all night to re-learn an answer it already knows.

### 5.6 Confirmation is best-effort — never re-send because it failed

After a successful `post()`:

1. Write `sent/<windowKey>.json` — **always, first**, as a temp file followed by `rename()`
   (§5.9). This is the real guard.
2. `POST` the confirmation. On failure: log it and **do not** re-send the message.

The consequence is deliberate and worth stating plainly: **if the confirmation POST fails, the
message still went out, and the 22:15 fallback push will fire anyway** because the server has
no record. The household gets one unnecessary nudge. That is strictly better than double-posting
the ledger into the family group.

### 5.7 Logging

- Every line: `[YYYY-MM-DD HH:mm:ss IST] LEVEL message`.
- **Never** log the token, the `Authorization` header, or a full response body at info level.
- Always log the `windowKey` on every decision line — it is the only field that ties the log to
  the server's record.
- Rotate at ~1 MB by truncating (a single file is enough; do not add a logging framework).

```text
[2026-09-18 22:00:01 IST] INFO tick window=2026-09-17..2026-09-18
[2026-09-18 22:00:02 IST] INFO fetch ok added=3 edited=1 deleted=1
[2026-09-18 22:00:04 IST] INFO posted window=2026-09-17..2026-09-18
[2026-09-18 22:00:05 IST] INFO confirmed window=2026-09-17..2026-09-18
```

### 5.8 Process exit codes — normative

`start.sh` restarts the agent after a crash, but must **not** restart a state that only a human
can fix. Distinct codes make that decision mechanical instead of a judgement call.

| Code | Meaning | `start.sh` action |
|---|---|---|
| `0` | Clean finish (one-shot modes). The scheduler itself does not exit between ticks | Restart the process |
| `1` | Generic fatal — an unexpected crash or unhandled state. **Not** "the retry ladder is exhausted": exhaustion is a state the agent sits in, never an exit (§6.4) | Restart after 30 s |
| `2` | `config.json` missing, unreadable, or invalid | **No restart** — a human must fix the file |
| `3` | **RE-LINK REQUIRED** — WhatsApp returned 401 on the socket | **No restart** — re-run `--link` |
| `4` | API auth failure — `/api/digest/day` returned 401 or 503 | **No restart** — fix the token |
| `7` | Another instance holds `sent/agent.lock` | **No restart** — a human is running a one-shot mode (§5.9) |
| `8` | `--link` timed out (no `qr` trigger, or the code was never confirmed) | **No restart** — one-shot mode; re-run `--link` (§3.7) |
| `5`, `6`, `9` | Reserved | — |

Codes `2`, `3`, `4` and `7` all mean the same thing operationally: **the agent cannot heal
itself.** Restarting them produces a log that looks busy and healthy while nothing is ever
delivered — the worst failure mode available to this component. The non-restart branches in
§6.5 exist specifically to make that impossible. (`8` belongs to a one-shot mode that
`start.sh` never invokes; it is listed so the code space is documented in one place.)

---

### 5.9 Single-instance lock and atomic state writes — normative

Every mode — scheduler, `--link`, `--groups`, `--now`, `--at`, `--dry-run` — acquires a **lock
file** before doing anything else.

- Acquisition is `fs.openSync('sent/agent.lock', 'wx')` (exclusive create). On success, write
  the PID and continue.
- On `EEXIST`: read the PID and test liveness (`process.kill(pid, 0)`; `/proc/<pid>` is
  available in Termux if a fallback is wanted).
  - **Dead PID** → the lock is stale. Log it, `unlink` the file, retry **once**.
  - **Live PID** → log `another instance is running (pid N) — exiting` and exit **`7`** (§5.8).
- Release on normal exit **and** from `process.on('exit')` / `SIGINT` / `SIGTERM` handlers, so a
  `Ctrl-C` does not leave a lock that needs manual removal.

**Why this is normative rather than a nicety.** `--now` is documented as a test mode, and a
reader will naturally run it while the scheduler is running. Two processes sharing one `auth/`
directory corrupt the session, and two processes evaluating the same window race each other's
check-then-write on the marker and **both post**. A caveat in a README is not a fix for that;
a lock is.

**Markers and retry state are written atomically**, for the same reason: write to
`<name>.tmp`, `fsync` if convenient, then `rename()` over the final name. A power cut must not
leave a half-written `sent/<key>.json`, because a truncated marker still reads as "sent" and
would silently suppress the night's post.

#### Stopping the agent — the exact procedure

Killing Node is **not enough**: `start.sh` is a `while true` wrapper and restarts it after 30 s.
Both must go:

```sh
pkill -f agent.mjs     # the node process
pkill -f start.sh      # the wrapper — otherwise node comes back in 30 s
cat sent/agent.lock    # should be gone; if not, the agent died uncleanly
```

`pkill` is provided by Android's `toybox` on current releases; if it is missing, `pkg install
procps`. The always-available alternative is to pull down the **wake-lock notification** in the
Android shade and tap **Exit**, which terminates the Termux session and therefore the wrapper.
This procedure is referenced by the acceptance tests (§7), which all require the scheduler to be
stopped first.

---

## 6. The 22:00 IST Scheduler

### 6.1 The algorithm

Two triggers, one condition — deliberately redundant so that a suspended timer cannot lose a
night:

1. **A precise `setTimeout`** to the next 22:00 IST boundary computed via `nextBoundary()`.
2. **A 60 s interval** that re-evaluates the same condition.

Both call the same `tick()`. The interval exists because Android may suspend timers while the
device is dozing; on wake, the interval notices "it is past 22:00 and there is no marker for
this window" and posts. The timer exists so the normal case fires within a second of 22:00
rather than within a minute.

#### The tick must not fetch once a minute

The endpoint is a database query. Polling it ~1,440 times a day to answer a question whose
answer changes once a day is both wasteful and the origin of a fetch storm. The gate is
therefore computed **locally, before any network call**:

```js
function shouldEvaluate(now) {
  const key = windowKeyFor(lastBoundary(now));   // §6.2 — local, no fetch
  let state = loadRetryState();                  // §6.4 — persisted
  if (state.key !== key) state = freshState(key);            // a new night resets the ladder
  if (hasLocalMarker(key)) return { run: false, key, state }; // already posted
  if (state.exhausted) return { run: false, key, state };     // done for tonight
  if (state.nextAttemptAt && now < state.nextAttemptAt) return { run: false, key, state };
  return { run: true, key, state };
}
```

**Why the key is computed locally instead of read from the response.** The ladder, the marker
and the lock are all keyed by the window, so the agent must know the key *before* it has a
response. Reading it from the body — as an earlier draft of this document implied — makes the
ladder impossible to key at all (there is no key until a fetch succeeds, and no fetch until the
ladder permits it). `windowKeyFor(lastBoundary(now))` is specified to produce **byte-identical**
output to the server's `window.key`, so the first successful response is **asserted** against
it and a mismatch is logged loudly as a contract violation.

#### `tick()` — normative shape

```js
async function tick() {
  const now = effectiveNow();                       // wall clock, or --at (§5.2)
  const gate = shouldEvaluate(now);
  if (!gate.run) return;                            // zero network calls on this path

  let body;
  try {
    body = await fetchDigest(now);                  // §5.4 — sends ?at= when --at was given
  } catch (err) {
    return recordFailure(gate.state, now);          // §6.4 — a THROWN fetch feeds the ladder
  }

  if (body.window.key !== gate.key) log('error', `window key mismatch: server=${body.window.key} local=${gate.key}`);

  if (body.alreadySent) return clearState(gate.key);            // §5.5 step 2
  if (body.disabled)    return clearState(gate.key);            // step 3
  if (body.stale) { log('warn', 'stale, not posting'); return clearState(gate.key); }  // step 4
  if (body.empty || !body.text) return clearState(gate.key);    // step 5

  try {
    await post(body.text);                          // step 6
  } catch (err) {
    return recordFailure(gate.state, now);          // §6.4 — and NO marker is written
  }

  writeLocalMarker(gate.key);                       // §5.6 — always first
  await confirm(gate.key);                          // best-effort, never re-sends
  clearState(gate.key);
}
```

Three properties of that shape are deliberate and must be preserved:

- **The gate is checked before the fetch, and the fetch's failure feeds the ladder.** The
  earlier draft started with `await fetchDigest()` and consulted the retry schedule *after* it,
  so the one failure the ladder was written for — a thrown fetch — never reached it.
- **Every non-failure outcome clears the ladder state.** A window that resolved to
  `alreadySent`, `disabled`, `stale` or `empty` is *finished*, not broken; re-fetching it all
  evening is pointless.
- **Only a failure keeps the ladder state, and a failure never writes a marker** — that is what
  keeps the fallback push honest (§5.6, §6.4).

### 6.2 The boundary calculation — normative

The boundary is always **22:00 in `Asia/Kolkata`**, regardless of the device's timezone.

```js
// IST is a fixed +05:30 with no DST, so the offset is a constant — but it is still
// applied explicitly rather than read from the device.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nextBoundary(now = new Date()) {
  // Shift into IST, floor to the day, add 22 h, shift back to UTC.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const boundaryIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 22, 0, 0, 0);
  let boundary = boundaryIst - IST_OFFSET_MS;
  if (boundary <= now.getTime()) boundary += 24 * 60 * 60 * 1000;   // today's has passed
  return new Date(boundary);
}
```

The scheduler additionally needs the **most recent** boundary — the one that has already
passed, which is the window it is responsible for:

```js
function lastBoundary(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const boundaryIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 22, 0, 0, 0);
  const boundary = boundaryIst - IST_OFFSET_MS;
  return new Date(boundary <= now.getTime() ? boundary : boundary - 24 * 60 * 60 * 1000);
}
```

> **Normative:** `lastBoundary()` must reproduce SPEC §5.1 step 4 exactly — *"the most recent
> boundary that has already passed"*. This is what makes an **early** fire harmless: at 21:30 the
> target is the *previous* window, which is almost certainly already marked, so the agent posts
> nothing. Do **not** "fix" it by clamping forward to tonight's boundary — that would post a
> partial window and then let the marker suppress the rest of the day.

Neither helper may do any of the following:

- Use `new Date().getHours()` or any device-local accessor.
- Use the `timezone` config field to *shift* anything — that field exists only so a future
  reader sees the intent; the offset is applied as above.
- Assume the device has DST. India has none.

`windowKeyFor(boundary)` then produces `"<startDateIst>..<endDateIst>"` for the 24 h window
**ending** at that boundary — i.e. the same key the server computes. Getting the server and the
agent to agree on this string is the entire idempotency contract; it is the first thing to check
if a double-post is ever observed.

### 6.3 Why not `termux-job-scheduler`

`termux-job-scheduler` is the "native" way to schedule on Android, and it is tempting. It is
rejected here because:

- it is coarse (Android's JobScheduler enforces a minimum interval and batches work, so a
  "22:00" job can run at 22:20 or later);
- it cannot express the **sub-minute retry ladder** of §6.4;
- it gives no in-process socket, so Baileys would have to re-link and re-sync on every wake —
  slow, and a much larger WhatsApp protocol footprint than one long-lived session;
- its failure modes are invisible from inside the app.

The long-lived process is also the *reason* the design is low-risk for the account: it looks
exactly like a WhatsApp Web session, which is what it is.

### 6.4 The retry ladder — owner decision P4

If a **fetch** or a **send** fails transiently, retry at **+2, +5, +15 and +30 minutes** relative
to the first failure, then **stop for the night** and let the 22:15 fallback push do its job.

| Attempt | Time (from first failure) | Cumulative | State after this attempt fails |
|---|---|---|---|
| 1 (initial) | 22:00 | — | `attempts = 1`, next at +2 min |
| 2 | +2 min | 22:02 | `attempts = 2`, next at +5 min |
| 3 | +5 min | 22:07 | `attempts = 3`, next at +15 min |
| 4 | +15 min | 22:22 | `attempts = 4`, next at +30 min |
| 5 | +30 min | 22:52 | `attempts = 5`, **exhausted** |
| — | then stop | — | no further fetch until the next boundary |

#### The ladder is **persisted** — normative

`sent/retry-state.json`, one object, replaced atomically on every update:

```jsonc
{
  "key": "2026-09-17..2026-09-18",
  "attempts": 3,
  "firstFailureAt": "2026-09-18T16:30:02.114Z",
  "nextAttemptAt": "2026-09-18T16:52:00.000Z",
  "exhausted": false
}
```

Earlier revisions said the ladder "lives in memory". **That was unbuildable, and it inverted
P4.** `start.sh` restarts the agent whenever it exits `1`; an in-memory ladder whose exhaustion
caused an exit `1` was therefore re-created *empty* on every restart, and the schedule ran again
from +2 minutes — forever. An outage that should have cost four retries would have hammered the
API and WhatsApp all night while the log looked busy and healthy. Persisting the state is the
fix, and it is also what makes the restart-on-crash behaviour safe.

#### Exhaustion is a **state**, not an exit — normative

`exhausted: true` means *"no more attempts for this window"*. The agent **does not exit**. It
returns to the tick, and from then until the boundary every tick short-circuits inside
`shouldEvaluate()` with **zero network calls** (§6.1). When the key rolls over at 22:00 the state
is replaced with a fresh one and the new night runs normally.

Exit code `1` consequently no longer carries the meaning "retry ladder exhausted" (§5.8). A
non-zero exit would kill the process, and nothing would remain alive to pick up tomorrow's
window.

#### Rules

- **Transient** means: a thrown or aborted fetch, a `5xx`, or a failed `sock.sendMessage`.
  These — and only these — advance the ladder.
- **Never retry** a `401` or `503` (wrong or missing token): those exit `4` immediately (§5.8). A
  wrong token cannot fix itself, and retrying it just delays the human who has to fix it.
- A **successful** send clears the state and writes the marker.
- Any **non-failure** outcome (`alreadySent`, `disabled`, `stale`, `empty`) also clears it: the
  window is finished, not broken.
- Cap the **tick cadence**, not merely the attempts: while a window is failing, the 60 s tick may
  not fetch — only `nextAttemptAt` may (§6.1). Without that, "capped retries" would still mean a
  request every minute for the rest of the night.
- The ladder deliberately extends **past** the 22:15 fallback push. Both may fire: the household
  gets a nudge *and* the post may still land at 22:22. A late post plus a nudge beats a silent
  loss.
- **A failed attempt must not write any marker.** Writing one for a failed send would suppress
  both the remaining retries and the fallback push — the single worst bug this agent could have.

### 6.5 `start.sh` — the crash-restart wrapper

```sh
#!/data/data/com.termux/files/usr/bin/sh
set -u
cd "$(dirname "$0")"

termux-wake-lock
trap 'termux-wake-unlock' EXIT

while true; do
  node agent.mjs >> agent.log 2>&1
  code=$?

  # 2, 3, 4 and 7 mean "a human must act" — restarting them only produces a
  # busy-looking log with no delivery. 7 additionally means another instance
  # holds the lock, so restarting would just loop. See §5.8.
  case "$code" in
    2|3|4|7)
      echo "[$(date)] fatal exit $code — not restarting" >> agent.log
      termux-wake-unlock
      exit "$code"
      ;;
  esac

  echo "[$(date)] agent exited $code — restarting in 30s" >> agent.log
  sleep 30
done
```

The `case` guard exists so a revoked session or a bad token does not produce an infinite
restart loop that looks like a healthy agent in `ps`. The full code table is §5.8.

> **Why an ordinary crash-restart is now safe.** This wrapper restarts on `1` unconditionally,
> and it restarts on `0` too (falling through the `case`). That used to be dangerous — a restart
> wiped the in-memory retry ladder and re-armed the schedule — but the ladder is persisted
> (§6.4) and exhaustion is a state rather than an exit, so a restart reloads a consumed ladder
> and the gate blocks every network call until the next boundary.

### 6.6 Battery reality check

One message a day is nothing. The real cost is the **persistent WebSocket**, which keeps a
socket open and consumes a small but continuous amount of battery. On a phone charged nightly
this is a non-issue; it is documented so it is not later mistaken for a bug.

---

## 7. Verification & Acceptance Tests

Run these **before** trusting the agent. They use `--at` so they run **at any hour** (see the
note below), `--dry-run` so the family group is not spammed, and every mode takes the
single-instance lock (§5.9) — so **stop the scheduler first** using §5.9's *Stopping the agent*
procedure.

**First, and needing no phone at all — the contract test:**

```sh
npm run test:whatsapp-agent     # from the REPOSITORY ROOT, not from this directory
```

**93 assertions, green as of 21 September 2026.** It covers the one thing a mistake in would be
invisible until it silently double-posted a night: `windowKeyFor(lastBoundary(t))` must be
byte-identical to the server's `feedWindowForInstant(t).key`, checked at hand-picked edge
instants (the boundary, one millisecond either side of it, month and year rollovers, leap days)
and across 400 seeded random instants — comparing the agent against the server's **real**
implementation rather than against a copy of its own arithmetic. It also covers the retry
ladder (including exhaustion and window roll-over), the pre-network gate, config validation, the
`.env.local` → `config.json` builder behind `npm run init:whatsapp-agent-config` — including that a
`--force` regenerate cannot blank a `groupJid` the file already holds, and that no JID is carried
across a changed `apiUrl` — and CLI parsing, all of which were factored out of `agent.mjs` to be
testable without files, sockets
or a device.

It is not a substitute for the table below. It cannot reach linking, sending, the socket 401
path, the boot hook, or anything about WhatsApp itself — only these acceptance tests can.

**Second, still needing no phone — the rehearsal:**

```sh
npm run rehearse:whatsapp-agent     # from the REPOSITORY ROOT
```

**51 checks.** It runs the **real agent, unmodified**, against a **local stub server**, so the
agent's whole decision path can be watched before anyone touches Dad's phone: config and argument
validation (exit `2`), the API status handling (`401`/`503` fatal at exit `4`, a `500` fed to the
ladder instead), the ladder **persisting across a process boundary** — which is the property that
makes `start.sh`'s restart safe — the four gate outcomes (empty, disabled, stale,
already-recorded) each distinguished, `--dry-run` proven inert (no marker, no confirmation POST),
a window-key mismatch logged loudly, the lock refusing a second process with exit `7` and being
released afterwards, and the token never appearing in a log line.

It needs **no WhatsApp account, no Baileys install and no network.** It is also mutation-tested:
sabotaging `finish()` so a dry run writes a marker makes it fail with exit `1` and names the four
broken assertions — a suite that cannot fail is not evidence.

What it does **not** cover, and must not be read as covering: linking, delivery, the socket 401
path and the boot hook. It also does not validate the server — the stub returns fixed bodies, and
the server's real behaviour is `verify:digest-feed`'s job while the window contract is
`agent-test.ts`'s.

#### Acceptance tests

| # | Test | How | Expected |
|---|---|---|---|
| 1 | Config validation | Rename `config.json` temporarily, run the agent | Clear "missing config" error, exit `2`, no stack-trace dump |
| 2 | Auth | `curl -s -o /dev/null -w "%{http_code}" "<apiUrl>/api/digest/day?at=<a past boundary>"` (no header) | `401` |
| 3 | Auth, correct | `curl -s -H "Authorization: Bearer $TOKEN" "<apiUrl>/api/digest/day?at=<a past boundary with known changes>"` | `200` with a non-null `text` field |
| 4 | Render only | Scheduler stopped (§5.9), then `node agent.mjs --at "<the same past boundary>" --dry-run` | Prints the rendered message for that window; group receives **nothing**; **no** marker written |
| 5 | Lock | With the scheduler **running**, run `node agent.mjs --now` in a second Termux session | Exits `7` with `another instance is running`; nothing posted; session untouched |
| 6 | Real send (rehearsal) | Scheduler stopped (§5.9), then `node agent.mjs --at "<same past boundary>"` — with `groupJid` pointed at a **test group**, or accepting one odd message in the real group | Message appears; `sent/<key>.json` written; server marker recorded for that window |
| 7 | Idempotency | Immediately re-run the exact same `--at` command | Logs "already sent"; **no** second message |
| 8 | Reboot survival | Reboot the phone; wait 2 min; `pgrep -f agent.mjs` | A live process — this is the Termux:Boot test (§3.8) |
| 9 | Empty window | `node agent.mjs --at "<a past boundary with no changes>" --dry-run` | Logs "nothing to post"; no message |
| 10 | Stale window | `node agent.mjs --at "<now + 40h>" --dry-run` | `stale: true`; logs "stale, not posting" |
| 11 | Bad token | Run once with a deliberately wrong token in `config.json` | `401` handling: loud log, exit `4`, **no** retry loop, and `start.sh` does not restart it |
| 12 | Ladder survives a restart | Point `apiUrl` at `http://127.0.0.1:9` (a closed port → immediate `ECONNREFUSED`), start the agent, let attempt 1 fail | `sent/retry-state.json` shows `attempts: 1` and a `nextAttemptAt`; the log has exactly **one** failed fetch. Restart the process → still **one**, until `nextAttemptAt` passes |
| 13 | Fallback push | On a night with no post, confirm a web push at 22:15 | Push received on an opted-in device |
| 14 | Log hygiene | `grep -i "$TOKEN" agent.log` | **No matches** |

> **Why every test above uses `--at` rather than `--now`.** `FEED_GRACE_MS` is 6 h (SPEC §5.1),
> so the window ending at the most recent boundary is **stale for 18 hours of every day**. A test
> that relies on the wall clock can only exercise the real-send path between 22:00 and 04:00 —
> which is exactly when a human is *not* doing setup, and which is why an earlier revision of
> this plan listed tests with no procedure anyone could follow. `--at` forwards the instant to
> the endpoint's `at` parameter (SPEC §5.5.2), so the window, its freshness and the rendered text
> are all computed for that instant, at any hour. `--now` remains as "evaluate immediately with
> the real clock".
>
> **Testing a send without polluting history.** Choose a **past** window with `--at`: the server
> marker is keyed by window, so a rehearsal on a past window leaves tonight's genuine post
> completely unaffected. The message does still land in the group, so point `groupJid` at a
> **test group** if you would rather not explain it. To erase the trace afterwards, delete the
> server marker (`digest_sent:whatsapp_feed:<windowKey>`) and the local `sent/<windowKey>.json`.
>
> Do **not** rehearse with `--now` while the scheduler is alive: that path targets the **current**
> window and would suppress the evening's real post. The §5.9 lock makes it fail safely rather
> than double-post, but it is still the wrong test.

---

## 8. Go-Live Sequence

The two halves are independent; the app side must exist before the agent can do anything.

1. **App side first** (companion spec Phase 1–6). Verify `GET /api/digest/day` returns `401`
   unauthenticated and `200` with a token.
2. Set `DIGEST_AGENT_TOKEN` on Vercel. Redeploy.
3. Add the placeholder to `.env.example` and commit.
4. On the phone: install Termux + Termux:Boot (§3.1), apply the Samsung settings (§3.2).
5. Install packages, copy the agent, `npm install` (§3.3–3.4).
6. Write `config.json` with `apiUrl` + `token` (§3.5).
7. Create the group from Dad's phone (§3.6).
8. Link with the pairing code (§3.7).
9. Discover and paste the group JID (§4).
10. Install and **test** the boot hook (§3.8, Test 8).
11. Start `./start.sh` (§3.9).
12. Run tests 4–7 and 11 from §7. All of them are runnable **before** 22:00, because `--at`
    names the window explicitly — do not wait for the evening to test.
13. **Watch the first real night.** At 22:00 confirm the group message; at 22:15 confirm **no**
    fallback push arrived (a push means the post did not record — investigate).

---

## 9. Failure-Mode Runbook

| Symptom | Likely cause | Fix |
|---|---|---|
| No post, and `agent.log` has no line for the day | Process was killed (Samsung battery manager) | Re-apply §3.2 (Unrestricted, Never sleeping apps, Keep open in Recents); then `./start.sh` |
| No post, log stops mid-run | Node crashed | `start.sh` restarts within 30 s — check `agent.log` for the stack |
| `RE-LINK REQUIRED` in the log | Device unlinked from WhatsApp (removed manually, or session invalidated) | `node agent.mjs --link` and re-enter a pairing code. Investigate *why* it was unlinked |
| Post fails, fallback push fires **every** night | The confirmation POST never succeeds — bad token, or blocked network | Test 3 (§7); verify `DIGEST_AGENT_TOKEN` matches on both sides |
| Fallback push fires, but the message **is** in the group | Confirmation POST failed after a successful send | Expected per §5.6; check connectivity/token. Do **not** disable the fallback |
| `401` on every fetch | Token rotated on Vercel but not in `config.json` (or vice versa) | Rotate both together: Vercel env + `config.json`, then restart the agent |
| `503` on every fetch | `DIGEST_AGENT_TOKEN` not set on Vercel | Set it and redeploy |
| Message posted for the wrong day | Phone clock badly wrong | Enable automatic date/time (§3.2). The *content* is server-computed, so only timing is affected |
| Nothing posted and the log says "stale, not posting" | Phone was off through a boundary | Working as designed (P9). The fallback push is the alert |
| Group post fails with an unknown-JID error | The group was deleted and recreated — new group, **new JID** | Re-run `--groups` and update `config.json` (§4.4) |
| Two messages in one night | A marker was deleted by hand, or the server/local keys disagree | Compare the log's `windowKey` with the server marker key. The key maths is the one thing both sides must agree on (§6.2) |
| `agent.log` grows unbounded | Rotation missing | Implement the ~1 MB truncate (§5.7) |

---

## 10. Security Hygiene

1. `config.json` → `chmod 600`; gitignored. It holds the bearer token.
2. `auth/` → gitignored. It holds WhatsApp session credentials.
3. Verify with `git status` **before every commit** that touches `tools/whatsapp-agent/`.
4. Never paste the token into a chat, an issue, a commit message, or a log line.
5. **Lost or replaced phone = credential compromise.** Two actions, in order:
   a. remove the device from WhatsApp → Settings → Linked devices;
   b. rotate `DIGEST_AGENT_TOKEN` on Vercel **and** in `config.json`.
6. The token grants read access to the current ledger window only — the endpoint accepts no
   filters and returns no more than that. Keep it that way (companion spec §10.2).
7. Accepted and recorded risk: Baileys is unofficial. The linked number could be restricted.
   Mitigating factors already in the design — a real companion device, a residential IP, one
   message per day, a single fixed destination group. The owner chose Dad's primary number
   over a spare and has accepted the residual risk.

---

## 11. Open Items

> **Where this stands, 18 September 2026.** The **code is written, committed and green** —
> `agent.mjs`, the repo-side contract test (93 assertions), the laptop rehearsal (51 checks),
> `start.sh`, the boot hook, the config template and the README are all in the repository. What
> remains is **device work that no agent in a terminal can perform**: §3's one-time setup, the
> two runs that need a linked WhatsApp session (`--link`, `--groups`), and the acceptance tests
> in §7. Everything up to the first `./start.sh` is one sitting on Dad's phone, and
> [`docs/runbooks/phone-setup-checklist.md`](../runbooks/phone-setup-checklist.md) is the run sheet for it.

| Item | Status |
|---|---|
| `phone` field name | **Resolved** — `phone` is normative in `config.json` (and in the committed `config.example.json`), validated digits-only; `--phone` overrides it |
| Whether to notify on the phone (a Termux notification) when a **stale** window is skipped | Open, optional — the 22:15 push already covers the household |
| Optional monthly agent-side self-test (e.g. a silent `--dry-run` weekly) | Out of scope for v1 |
| Whether the fallback push should also fire when the feed is disabled | **Decided: no** — a deliberate off switch must not generate noise |

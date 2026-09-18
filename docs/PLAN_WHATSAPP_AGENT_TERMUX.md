# Implementation Plan — Termux + Baileys WhatsApp Agent (Dad's Samsung phone)

| | |
|---|---|
| **Document status** | 📝 DRAFT — implementation plan + operational runbook, awaiting build |
| **Date** | 18 September 2026 |
| **Device** | Dad's **Samsung** phone (One UI), Android |
| **Owner decisions** | Samsung · Termux:Boot **yes** · retry **capped** · sender = Dad's number · pairing-code linking |
| **Companion spec** | `docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md` — **§6 is the contract** for what the agent must do. This document is the *how* and the *operate* |
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
| P4 | Retry | **Capped**: ≈2, 5, 15, 30 min after a failure, then stop for the night | Self-heals a blip; cannot hammer WhatsApp during an outage |
| P5 | Send time | **22:00 IST** daily | Matches the existing digest cron |
| P6 | Sender | Dad's WhatsApp number | Owner decision D9 |
| P7 | Destination | A **new dedicated group** (Dad, Mom, Son) | Owner decision D8 |
| P8 | Empty window | Post **nothing** | Owner decision D7 |
| P9 | Stale window | **Refuse to post** | Owner decision / spec §5.1 |
| P10 | Scheduler | **In-process timer + 60 s self-healing tick**, wrapped by `start.sh` | Not `termux-job-scheduler` — see §6.3 |
| P11 | Transport | Baileys (unofficial) | Accepted risk, recorded in the changelog |

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

```text
tools/whatsapp-agent/
├── README.md            # the human-facing setup, distilled from §3 below
├── agent.mjs            # the agent (§5)
├── package.json         # dependencies
├── config.example.json  # committed template — placeholders only
├── start.sh             # wake-lock + crash-restart wrapper
└── boot/termux-boot.sh  # copy of the Termux:Boot script (§3.8)
```

### 2.2 Present on the phone only — **never committed**

| Path | Contents | Protection |
|---|---|---|
| `config.json` | API base URL, bearer token, group JID | `chmod 600`, gitignored |
| `auth/` | Baileys multi-file session state | gitignored |
| `sent/` | Local anti-double-post markers | gitignored |
| `agent.log` | Rotating run log | gitignored |

> **Mandatory, and easy to forget:** add all four to `.gitignore` **before** the first commit
> that touches this directory, then confirm with `git status` that nothing under `auth/` or
> `config.json` is staged. `auth/` contains credentials equivalent to a logged-in WhatsApp
> session; `config.json` contains the bearer token.

---

## 3. One-Time Phone Setup

Do these in order. Steps 3.2 (Samsung battery) and 3.8 (boot) are the ones that decide
whether this runs for months or dies on day three.

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

Termux needs **no** native build toolchain for this agent. Baileys is **pure JavaScript** —
that is precisely why this design works on Android at all.

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

**Verify the dependency name at install time.** The Baileys package has moved between
`baileys` and `@whiskeysockets/baileys` over its history, and older tutorials name the old
one. Confirm what the registry currently serves before pinning:

```sh
npm view baileys version
```

Use the maintained package and pin the major version in `package.json`.

### 3.5 Configure

```sh
cp config.example.json config.json
chmod 600 config.json
```

Fill in `apiUrl` and `token` now. Leave `groupJid` empty — §4 discovers it.

```jsonc
{
  "apiUrl": "https://<your-deployment>.vercel.app",
  "token": "<DIGEST_AGENT_TOKEN>",
  "groupJid": "",
  "sendAt": "22:00",
  "timezone": "Asia/Kolkata"
}
```

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

**Requirements and caveats:**

- The number must be in E.164 digits with **no leading `+`** (e.g. `919876543210`). Provide it
  via `--phone` or a `phone` field in the config.
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
> alive (§7, Test 7). An untested boot hook is not a feature.

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
| `loadConfig()` | Read + validate `config.json` | Fail loudly on a missing token or `apiUrl`; validate `sendAt` is `HH:MM` and `timezone` is present. Never log the token. |
| `log(level, msg, meta?)` | Timestamped (IST) line to stdout and `agent.log` | Rotate past ~1 MB |
| `connect()` | `useMultiFileAuthState('auth')` + `makeWASocket` | Returns `{ sock, saveCreds }`; wires the `creds.update` listener. **No QR option** (§1.1) |
| `runLink(phone)` | Request a pairing code, print it, wait for `open`, then exit | One-shot; persists `auth/` |
| `runListGroups()` | Print `name → jid` for every group, exit | §4 |
| `nextBoundary(now)` | The next **22:00 IST** as a UTC instant | Pure; **never** uses the device timezone |
| `windowKeyFor(endInstant)` | `"<startDateIst>..<endDateIst>"` for a 24 h window ending at a boundary | Must match the server's key exactly — this is the idempotency contract |
| `hasLocalMarker(key)` / `writeLocalMarker(key)` | `sent/<key>.json` | Primary anti-double-post guard |
| `fetchDigest()` | `GET {apiUrl}/api/digest/day` with the bearer token, 20 s timeout | Returns the parsed body; status codes handled per §5.4 |
| `post(text)` | `sock.sendMessage(groupJid, { text })` | Verbatim; no formatting |
| `confirm(key)` | `POST {apiUrl}/api/digest/day` with `{ windowKey, status }` | Best-effort — see §5.6 |
| `tick()` | One evaluation of "should I post right now?" | §6; the whole scheduler is this function plus a timer |
| `main()` | CLI dispatch + the timer loop | `--link`, `--groups`, `--now`, `--dry-run` |

### 5.2 CLI surface

| Flag | Behaviour |
|---|---|
| *(none)* | Long-running scheduler mode — the production path (§6) |
| `--link` | Pairing-code linking, then exit (§3.7) |
| `--groups` | Print group JIDs, then exit (§4) |
| `--now` | Run one evaluation immediately, ignoring the clock — for testing |
| `--dry-run` | With `--now`: fetch and print the message, **send nothing**, write no markers |
| `--phone <E164>` | Number for `--link` (else `config.phone`) |

`--dry-run` and `--now` exist so the whole path can be exercised without spamming the family
group. They are the agent's test harness (§7).

### 5.3 Connecting — and the 401 rule

Baileys emits a `connection.update` event. Two cases matter:

- `connection === "open"` → the session is live. Arm the scheduler.
- `connection === "close"` **with `lastDisconnect.error.output.statusCode === 401`** → WhatsApp
  has **unlinked the device** (someone removed it from Linked devices, or the session was
  invalidated).

> **Normative:** on a 401, do **not** reconnect in a loop. Log a clear, greppable line
> (`RE-LINK REQUIRED: run 'node agent.mjs --link'`) and **exit non-zero**. A silent retry loop
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
| `401` | Token missing or wrong | Log loudly, exit non-zero. **Do not retry in a tight loop** — a wrong token will not fix itself |
| `503` | `DIGEST_AGENT_TOKEN` absent on the server | Log loudly, exit non-zero |
| `4xx` other | Bad request (should not happen) | Log, exit non-zero |
| `5xx` / network error | Transient | Feed the retry schedule (§6.4) |

The response body is the contract from the companion spec §5.5.2.

### 5.5 Deciding whether to post — the exact order

Evaluate **in this order**, and stop at the first match:

| # | Condition | Action |
|---|---|---|
| 1 | `hasLocalMarker(window.key)` | Already posted this window → log, finish |
| 2 | `body.alreadySent === true` | The server recorded it → log, finish |
| 3 | `body.disabled === true` | Owner switched the feed off → log, finish |
| 4 | `body.stale === true` | Window too old → log **"stale, not posting"**, finish |
| 5 | `body.empty === true` or `body.text === null` | Nothing changed → log, finish |
| 6 | otherwise | `post(body.text)` → on success write the local marker, then `confirm()` |

**Order matters.** Checking `stale` before `empty` is not cosmetic: a stale *and* empty window
is a different log line from a fresh empty one, and that distinction is what makes the log
diagnosable at 22:00.

### 5.6 Confirmation is best-effort — never re-send because it failed

After a successful `post()`:

1. Write `sent/<windowKey>.json` — **always, first**. This is the real guard.
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
| `1` | Generic fatal — crash, unexpected state, or a transient failure whose retry ladder is exhausted | Restart after 30 s |
| `2` | `config.json` missing, unreadable, or invalid | **No restart** — a human must fix the file |
| `3` | **RE-LINK REQUIRED** — WhatsApp returned 401 on the socket | **No restart** — re-run `--link` |
| `4` | API auth failure — `/api/digest/day` returned 401 or 503 | **No restart** — fix the token |
| `5`–`9` | Reserved | — |

Codes `2`, `3` and `4` all mean the same thing operationally: **the agent cannot heal
itself.** Restarting them produces a log that looks busy and healthy while nothing is ever
delivered — the worst failure mode available to this component. The non-restart branches in
§6.5 exist specifically to make that impossible.

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

```js
async function tick() {
  const body = await fetchDigest();                 // §5.4
  const key = body.window.key;

  if (retry.scheduleExhausted(key) && !retry.due(key)) return;  // §6.4
  if (hasLocalMarker(key)) return;                  // §5.5 step 1
  if (body.alreadySent) return;                     // step 2
  if (body.disabled) return;                        // step 3
  if (body.stale) { log('warn', 'stale, not posting'); return; }  // step 4
  if (body.empty || !body.text) return;             // step 5

  await post(body.text);                            // step 6
  writeLocalMarker(key);
  await confirm(key);
}
```

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

Three things this must **not** do:

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

If `post()` or the fetch fails transiently, retry at **+2, +5, +15 and +30 minutes** relative to
the first failure, then **stop for the night** and let the 22:15 fallback push do its job.

| Attempt | Time (from first failure) | Cumulative |
|---|---|---|
| 1 (initial) | 22:00 | — |
| 2 | +2 min | 22:02 |
| 3 | +5 min | 22:07 |
| 4 | +15 min | 22:22 |
| 5 | +30 min | 22:52 |
| — | then stop | — |

Rules:

- The ladder state lives **in memory**, keyed by `windowKey`. A process restart resets it —
  acceptable, because `start.sh` only restarts on a crash and a crash mid-ladder is rare.
- **Never retry** a `401` or `503` (wrong or missing token). Only transient failures retry.
- The ladder stops immediately on success.
- Note the ladder deliberately extends **past** the 22:15 fallback push. Both may fire: the
  household gets a nudge *and* the post may still land at 22:22. That is the intended
  behaviour — a late post plus a nudge beats a silent loss.
- **A failed retry must not write any marker.** Writing a marker for a failed send would
  suppress both the retries and the fallback push, which is the single worst bug this agent
  could have.

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

  # 2, 3 and 4 mean "a human must act" — restarting them only produces a
  # busy-looking log with no delivery. See §5.8.
  case "$code" in
    2|3|4)
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

### 6.6 Battery reality check

One message a day is nothing. The real cost is the **persistent WebSocket**, which keeps a
socket open and consumes a small but continuous amount of battery. On a phone charged nightly
this is a non-issue; it is documented so it is not later mistaken for a bug.

---

## 7. Verification & Acceptance Tests

Run these **before** trusting the agent. Several use `--dry-run` so the family group is not
spammed during setup.

| # | Test | How | Expected |
|---|---|---|---|
| 1 | Config validation | Rename `config.json` temporarily, run the agent | Clear "missing config" error, exit non-zero, no stack-trace dump |
| 2 | Auth | `curl -s -o /dev/null -w "%{http_code}" <apiUrl>/api/digest/day` (no header) | `401` |
| 3 | Auth, correct | `curl -s -H "Authorization: Bearer $TOKEN" <apiUrl>/api/digest/day` | `200` with a `text` field |
| 4 | Render only | `node agent.mjs --now --dry-run` | Prints the rendered message; group receives **nothing** |
| 5 | Real send | `node agent.mjs --now` on a day with known changes | Message appears in the group; `sent/<key>.json` written |
| 6 | Idempotency | Immediately run `node agent.mjs --now` again | Logs "already sent"; group receives **no** second message |
| 7 | Reboot survival | Reboot the phone; wait 2 min; `pgrep -f agent.mjs` | A live process — this is the Termux:Boot test (§3.8) |
| 8 | Empty window | `curl ... "?at=<a quiet past day>"` | `empty: true`, `text: null`; a `--now --dry-run` posts nothing |
| 9 | Stale window | `curl ... "?at=<now + 40h>"` | `stale: true`; a `--now --dry-run` logs "stale, not posting" |
| 10 | Bad token | Run once with a deliberately wrong token | `401` handling: loud log, non-zero exit, **no retry loop** |
| 11 | Fallback push | On a night with no post, confirm a web push at 22:15 | Push received on an opted-in device |
| 12 | Log hygiene | `grep -i "$TOKEN" agent.log` | **No matches** |

> **Testing a send without polluting history:** the server marker is keyed by window, so a
> real send on the current window is recorded and will suppress the evening's genuine post.
> For a rehearsal, prefer `--dry-run`, or point `config.json` at a **test group** JID
> temporarily. If you do post a rehearsal to the real group, delete the server marker
> (`digest_sent:whatsapp_feed:<windowKey>`) and the local `sent/<key>.json` before 22:00.

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
10. Install and **test** the boot hook (§3.8, Test 7).
11. Start `./start.sh` (§3.9).
12. Run tests 4–6 and 10 from §7.
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

| Item | Status |
|---|---|
| `--link` needs `phone` in config or `--phone` — decide the field name during implementation | Open, trivial |
| Whether to notify on the phone (a Termux notification) when a **stale** window is skipped | Open, optional — the 22:15 push already covers the household |
| Optional monthly agent-side self-test (e.g. a silent `--dry-run` weekly) | Out of scope for v1 |
| Whether the fallback push should also fire when the feed is disabled | **Decided: no** — a deliberate off switch must not generate noise |

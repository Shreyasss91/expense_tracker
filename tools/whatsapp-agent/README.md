# WhatsApp sender agent (Termux + Baileys)

Posts the daily **ledger-change feed** to one private family WhatsApp group, from Dad's phone,
once a night at **22:00 IST**.

This is the phone half of the daily-feed feature. The server half lives in the Next.js app and
is already deployed: it renders the message, decides whether tonight has anything to post, and
records that it was posted. This agent fetches that message and delivers it.

**Normative sources — read these, not this file, for anything with a rule in it:**

| Document | What it is |
|---|---|
| [`docs/PLAN_WHATSAPP_AGENT_TERMUX.md`](../../docs/PLAN_WHATSAPP_AGENT_TERMUX.md) | The implementation plan: every decision, the scheduler, the retry ladder, exit codes, acceptance tests. §3 is the setup this README distils. |
| [`docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md`](../../docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md) | What the window means and what the endpoint returns. |

If this README and the plan disagree, **the plan wins** — and the README should be fixed.

---

## What it actually does

Every 60 seconds the agent asks one question, locally and with no network traffic: *is the most
recent 22:00 IST boundary a window I have not handled yet, with a retry owed right now?* Almost
always the answer is no, and it goes back to sleep. When the boundary arrives it:

1. `GET <apiUrl>/api/digest/day` with the bearer token.
2. If the server says the window is empty, already sent, stale, or the feed is switched off —
   it logs why and stops. Nothing is sent.
3. Otherwise it posts `body.text` to the configured group, writes a local marker, then tells the
   server it succeeded.

**The message is rendered server-side.** The agent never composes or edits ledger text; it
delivers a string. That is deliberate — it keeps the formatting rules in one place, where they
are unit-tested.

**The window is 24 h, ending at 22:00 IST:** everything added between yesterday 22:00 and today
22:00, plus every edit and deletion made in that same span. Both halves of that come from the
server; the agent only asks for the right window.

### A failed post is retried; a successful one is never repeated

Retries are on a persisted ladder — roughly 2, 5, 15, then 30 minutes after the first failure.
Run out of attempts and the agent **stays alive and stops trying** until the window rolls over,
making **zero network calls** in the meantime. Exhaustion is a state, not a crash, so a restart
cannot re-arm the ladder.

The marker file is the real guard against double-posting: it is written *before* the
confirmation is sent, so if the confirmation fails, the group still gets exactly one message and
the app's **22:15 safety-net push** may fire an unnecessary nudge. One redundant notification is
deliberately preferred over two copies of the ledger in a family group.

---

## Requirements

- **Termux** from **F-Droid** or the GitHub releases page — **not** the Play Store build, which
  is deprecated and will not install a current Node.
- **Termux:Boot**, also from **F-Droid**. It only works when installed from the *same* source as
  Termux.
- **Node.js ≥ 20.** Baileys enforces this with a `preinstall` check, so an old Node fails at
  install rather than at 22:00.
- **No native build toolchain.** Baileys is pure JavaScript and this agent installs none of its
  optional peer dependencies. That is not an accident — see `.npmrc`, which is load-bearing:
  removing it makes `npm install` pull `sharp`, a native module, and fail on Android.

---

## Setup

### 1. Install the packages

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
node --version          # expect a current LTS major
```

### 2. Apply the Samsung/One UI battery settings — **do not skip**

This is the step that decides whether the agent runs for months or silently dies on day three.
Without it One UI freezes Termux in the background and no message is ever sent — with no error
anywhere, because the process simply stops being scheduled. The plan's §3.2 lists the exact
toggles (Unrestricted battery usage, *Never sleeping apps*, Keep open in Recents, automatic
date/time). Re-apply them after any OS update.

### 3. Get the agent onto the phone

Clone the repo, or copy just this folder over — the agent has no runtime dependency on the rest
of the repo:

```sh
git clone https://github.com/Shreyasss91/expense_tracker.git ~/expense_tracker
cd ~/expense_tracker/tools/whatsapp-agent
npm install
```

### 4. Configure

```sh
cp config.example.json config.json
chmod 600 config.json
```

```jsonc
{
  "apiUrl": "https://<your-deployment>.vercel.app",
  "token": "<DIGEST_AGENT_TOKEN>",
  "phone": "919876543210",     // Dad's number — DIGITS ONLY, no "+", no spaces
  "groupJid": "",              // discovered in step 6
  "sendAt": "22:00",
  "timezone": "Asia/Kolkata"
}
```

- **`phone` is required**, not optional: `--link` cannot request a pairing code without it. It is
  validated as digits only and must **not** be mangled silently — a stripped `+` requests a code
  for a different number.
- **`sendAt` and `timezone` are checked against the server's fixed boundary.** They must be
  exactly `"22:00"` and `"Asia/Kolkata"`. The window is computed from a constant +05:30 with no
  DST, so a config that claims a different hour would only be wrong.
- The token is the **same** `DIGEST_AGENT_TOKEN` set on Vercel. Generate one with
  `openssl rand -hex 32` and set it in **both** places — the server and this file.

### 5. Link the device (pairing code)

```sh
node agent.mjs --link
```

It prints an **8-digit pairing code** and the number it is requesting it for. On Dad's phone:
**WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead"**, then
type the code. On success the session is written to `auth/` and the process exits `0`.

This is **one-time**. The session survives reboots, Termux restarts and config edits.

Things that make it fail, and why:

- **The code is not requested immediately** on purpose. Baileys only exposes a ready socket once
  its `qr` event fires, and requesting a code too early fails with a misleading
  `Connection Closed`. The agent waits for that event, uses it purely as a trigger, and **never
  prints the QR itself**.
- **One pairing-code device per number.** If Dad's number already has one, remove it in
  **Linked devices** first.
- **WhatsApp allows only 4 linked devices** — free a slot if the list is full.
- **No `open` within 5 minutes → exit `8`** with recovery guidance. It does not loop; re-run
  `--link`. A half-linked session is worse than none.

### 6. Discover the group JID

A group is addressed by **JID** (`1203630xxxxxxxxx@g.us`), never by name — two groups can share
a name, and no formula derives a JID from a name. Create the group **from Dad's phone** (the
sender's account must be a participant) with Mom and Son, then:

```sh
node agent.mjs --groups
```

```text
Waiting for connection…
Connected as 91••••••3210
3 groups:
  Family Ledger               1203630xxxxxxxxx@g.us
  Family                      1203630yyyyyyyyy@g.us
```

Paste the JID into `config.json`. If the group is missing, wait ~30 s and re-run: immediately
after a first link WhatsApp is still streaming history. Then confirm the configured JID really
resolves:

```sh
node agent.mjs --groups | grep "$(node -e "console.log(require('./config.json').groupJid)")"
```

> **A JID is not permanent.** Delete the group and recreate it and the new one has a **new JID**,
> at which point the nightly post fails. Re-run `--groups` and update the config.

### 7. Install the boot hook

```sh
mkdir -p ~/.termux/boot
cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
chmod +x ~/.termux/boot/termux-boot.sh
```

Then **open Termux:Boot once** from the app drawer. The app does nothing until it has been
launched at least once — the single most common reason a boot hook silently does nothing.

**Test it, do not assume it:** reboot the phone, wait two minutes, then `pgrep -f agent.mjs`. The
boot script also fails *only* on reboot if its path is wrong, which is exactly when nobody is
watching — so check that too.

### 8. Start it

```sh
cd ~/expense_tracker/tools/whatsapp-agent
./start.sh
```

Run `./start.sh`, **not** `node agent.mjs`, for the long-running scheduler: the wrapper holds the
wake-lock (so Android does not freeze the socket) and restarts the agent after an ordinary crash.

---

## Commands

| Command | What it does |
|---|---|
| `./start.sh` | The production path: wake-lock + crash-restart wrapper, scheduler inside |
| `node agent.mjs` | The scheduler alone — no wake-lock, no restart. For debugging only |
| `node agent.mjs --link` | Pairing-code linking, then exit |
| `node agent.mjs --groups` | Print group JIDs, then exit |
| `node agent.mjs --now` | One evaluation at the real wall clock, then exit |
| `node agent.mjs --at <ISO>` | One evaluation **as if `now` were that instant**, then exit |
| `--dry-run` | With `--now`/`--at`: print the message, send nothing, write nothing |
| `--phone <E164>` | Number for `--link` (else `config.json`'s `phone`) |

**`--at` is what makes testing possible.** The server treats a window older than 6 hours as
stale, so the current window is unusable for a rehearsal for 18 hours of every day. `--at` names
the instant explicitly and passes it to the endpoint, so the window, its freshness and the
rendered text are all computed for **that** moment — at any hour.

**Every mode takes a single-instance lock.** A one-shot mode will exit `7` while the scheduler is
running, and that is a feature: two processes sharing one `auth/` directory corrupt the session,
and two evaluating the same window can both post.

---

## Running it

```sh
tail -f agent.log     # the agent's structured decisions — watch this
tail -f boot.log      # the wrapper's lifecycle, and node's stdout/stderr (crash stacks)
pgrep -f agent.mjs    # is it alive?
```

Every decision line carries the `windowKey`, which is the only field that ties a log line to the
server's record:

```text
[2026-09-18 22:00:01 IST] INFO tick window=2026-09-17..2026-09-18
[2026-09-18 22:00:02 IST] INFO fetch ok added=3 edited=1 deleted=1
[2026-09-18 22:00:04 IST] INFO posted window=2026-09-17..2026-09-18
[2026-09-18 22:00:05 IST] INFO confirmed window=2026-09-17..2026-09-18
```

`agent.log` truncates itself at ~1 MB. The token is never logged.

### Stopping it

`pkill` on the Node process is **not enough** — `start.sh` restarts it within 30 s. Both must go:

```sh
pkill -f agent.mjs     # the node process
pkill -f start.sh      # the wrapper — otherwise node comes back in 30 s
cat sent/agent.lock    # should be gone; if not, the agent died uncleanly
```

`pkill` comes from Android's `toybox`; if it is missing, `pkg install procps`. The always-available
alternative is to pull down the wake-lock notification in the Android shade and tap **Exit**.

You need this before any one-shot command: tests, `--groups`, `--link`, `--dry-run`.

### Exit codes

`start.sh` restarts after `0` and `1` and **refuses to restart** after the rest — because
restarting a state only a human can fix produces a log that looks busy and healthy while nothing
is ever delivered.

| Code | Meaning | Restarted? |
|---|---|---|
| `0` | Clean finish (one-shot modes) | yes |
| `1` | Unexpected crash — **not** "retries exhausted" | yes, after 30 s |
| `2` | `config.json` missing or invalid | **no** — fix the file |
| `3` | **RE-LINK REQUIRED** — WhatsApp returned 401 | **no** — run `--link` |
| `4` | API 401/503 — wrong or missing token | **no** — fix the token |
| `7` | Another instance holds `sent/agent.lock` | **no** — stop the running one |
| `8` | `--link` timed out | one-shot; just re-run it |

---

## Verifying it

**From the repository root**, this pins the agent's window arithmetic to the server's real
implementation — the one contract that, if broken, silently double-posts a night:

```sh
npm run test:whatsapp-agent
```

It compares the two implementations at hand-picked edge instants (boundaries, one millisecond
either side, month/year rollovers, leap days) and over 400 seeded random instants, then covers
the retry ladder, the pre-network gate, config validation and CLI parsing. It needs a repo
checkout, not the phone.

Then the plan's [§7 acceptance tests](../../docs/PLAN_WHATSAPP_AGENT_TERMUX.md), which are the
part no unit test can reach: linking, a real send into a **test group**, a reboot, the lock, and
the 401 path. Rehearse against a **past** window so tonight's genuine post is untouched.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No post, and `agent.log` has no line for the day | One UI killed the process | Re-apply §3.2, then `./start.sh` |
| Log stops mid-run | Node crashed | `start.sh` restarts within 30 s; check `boot.log` for the stack |
| `RE-LINK REQUIRED` | Device unlinked from WhatsApp | `node agent.mjs --link` — and find out *why* it was unlinked |
| `401` on every fetch | Token rotated on one side only | Rotate **both** (Vercel env + `config.json`), restart |
| `503` on every fetch | `DIGEST_AGENT_TOKEN` not set on Vercel | Set it and redeploy |
| "stale, not posting" | The phone was off through a boundary | Working as designed — the 22:15 push is the alert |
| Fallback push **every** night | The confirmation POST never succeeds | Check token and connectivity. Do **not** disable the fallback |
| Push fires but the message **is** in the group | Confirmation failed after a successful send | Expected; check connectivity. No re-send needed |
| Two messages in one night | A marker was deleted by hand, or keys disagree | Compare the log's `windowKey` with the server marker key |
| Post fails, unknown JID | The group was recreated — new group, new JID | Re-run `--groups`, update `config.json` |
| `agent.log` grows unbounded | — | It should not; rotation is built in. Report it |

---

## Security

1. `config.json` holds the bearer token → `chmod 600`, gitignored.
2. `auth/` holds a live WhatsApp session → gitignored.
3. **Check `git status` before every commit that touches this directory**, and confirm nothing
   under `auth/`, `sent/` or `config.json` is staged.
4. Never paste the token into a chat, an issue, a commit message, or a log line.
5. **A lost or replaced phone is a credential compromise.** Remove the device in WhatsApp →
   Linked devices, then rotate `DIGEST_AGENT_TOKEN` on Vercel **and** in `config.json`.
6. The token reads ledger data from the endpoint — treat it as a secret, because it is one.
7. **Accepted risk:** Baileys is unofficial, so WhatsApp could restrict the linked number. The
   design keeps the exposure small — a real companion device, a residential IP, one plain-text
   message a day, one fixed destination group. The owner chose Dad's primary number knowingly.

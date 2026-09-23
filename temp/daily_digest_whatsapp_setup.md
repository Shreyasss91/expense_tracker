# Daily digest WhatsApp feed — step-by-step setup, by device and tool

**Normative sources: [`docs/PLAN_WHATSAPP_AGENT_TERMUX.md`](../docs/PLAN_WHATSAPP_AGENT_TERMUX.md)
§3, §4, §7 and [`docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md`](../docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md).**

This document is not a new source of truth. It is
[`docs/PHONE_SETUP_CHECKLIST.md`](../docs/PHONE_SETUP_CHECKLIST.md) with one layer added that the
run sheet leaves implicit: **which device, and which tool, every command goes into.** Where this
file and any of the sources above disagree, they win and this file gets fixed.

---

## Legend

| Icon | Device | Tool |
|---|---|---|
| 💻 | Laptop (dev machine) | bash terminal, at the repository root — Git Bash on Windows |
| 🔌 | Laptop, targeting the phone | `adb` (Android platform-tools) over USB |
| 📟 | **Dad's phone** | **Termux** app — every `node`, `npm` and `pkg` command goes here |
| 💬 | Dad's phone | **WhatsApp** app |
| ⚙️ | Dad's phone | **Android Settings** / app drawer / F-Droid |

> **The one rule that prevents most confusion:** `npm run …` (repository scripts) go on the
> 💻 **laptop**. `node agent.mjs …` and `npm install` go in 📟 **Termux on the phone**. The names
> collide; the machines do not.

---

## Phase 0 — 💻 Laptop: pre-flight, before touching the phone

| # | Where | Command / action |
|---|---|---|
| 0.1 | 💻 + Vercel dashboard | `DIGEST_AGENT_TOKEN` is set on Vercel, and the deployment for the current `main` is **READY** |
| 0.2 | 💻 repo root | `npm run test:whatsapp-agent` → **exit 0** |
| 0.3 | 💻 repo root | `npm run rehearse:whatsapp-agent` → **exit 0** |
| 0.4 | 💻 repo root | `npm run verify:digest-feed` → **0 failures, exit 0** (talks to the real deployment) |
| 0.5 | 💻 `expense_tracker/.env.local` | Contains `PROD_URL`, `DIGEST_AGENT_TOKEN`, `DIGEST_AGENT_PHONE` |
| 0.6 | 💻 | `adb` (Android platform-tools) installed, USB debugging on, `adb devices` lists the phone |

**No check counts here, deliberately.** Each command prints one, but a count moves whenever an
assertion is added anywhere, for reasons unrelated to this phone. **Exit 0 and an empty failure
list are the invariant.** If a command exits non-zero it names the failing check — read that.

Values to have written down before starting:

| Value | Notes |
|---|---|
| Deployment URL (`apiUrl`) | `https://<your-deployment>.vercel.app` |
| `DIGEST_AGENT_TOKEN` | Same value as Vercel. Treat as a secret. Generate with `openssl rand -hex 32` |
| Dad's number | **E.164 digits only — no `+`, no spaces** |
| The new group's name | Created in Phase 4, from Dad's phone |

---

## Phase 1 — ⚙️ Phone: apps and battery settings

**F-Droid (on the phone)**

- Install **Termux** from F-Droid (or its GitHub releases) — **not** the Play Store build, which is
  deprecated and will not install a current Node.
- Install **Termux:Boot** from F-Droid — the **same source** as Termux, or the boot hook silently
  does nothing.
- **Open Termux:Boot once** from the app drawer. It does nothing until it has been launched at
  least once, and this is the single most common reason a boot hook fails.

**Android Settings (on the phone)** — skip this and the agent dies on day three with no error
anywhere, because the process simply stops being scheduled:

- Battery → **Unrestricted** for Termux
- Settings → Battery → Background usage limits → **Never sleeping apps** → add Termux
- Recents → Termux → **Keep open**
- Date and time → **automatic**

Re-apply these after any OS update.

---

## Phase 2 — 📟 Phone, Termux: packages and the agent code

All of the following is typed into a **Termux session on the phone**:

```sh
# 📟 Termux (phone)
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
node --version                 # expect a current LTS major (20 or newer)

git clone https://github.com/Shreyasss91/expense_tracker.git ~/expense_tracker
cd ~/expense_tracker/tools/whatsapp-agent
npm install
```

- `node --version` must report **≥ 20**. Baileys enforces it with a `preinstall` check, so an old
  Node fails here rather than at 22:00.
- `npm install` must complete **without building anything native** — no `sharp`, no compiler
  errors. **`.npmrc` is what makes that true; do not delete it.**

---

## Phase 3 — `config.json`: generate on the laptop, push, land it in Termux

### 3.1 💻 Laptop, repo root — generate from `.env.local`

```sh
# 💻 Laptop (repo root)
npm run init:whatsapp-agent-config        # add --force to overwrite an existing file
```

This exists because typing the token or the number one-thumbed is where the two failures this setup
fears most come from: a stray character in the token reads as "production rejects us", and a mangled
number requests a pairing code for a **different** phone.

It writes `tools/whatsapp-agent/config.json`, keeps any existing `groupJid` **only while
`PROD_URL` is unchanged** (a JID names a group, not a server), and prints the masked number to
compare against what `--link` prints in Phase 5.

### 3.2 🔌 Laptop, targeting the phone — push it

`config.json` lives in Termux's home, which adb cannot write to without root, so it is pushed via
shared storage:

```sh
# 💻 Laptop (repo root) — adb targets the phone over USB
adb push tools/whatsapp-agent/config.json /sdcard/Download/config.json
```

### 3.3 📟 Phone, Termux — land it and lock it down

```sh
# 📟 Termux (phone)
cp /sdcard/Download/config.json ~/expense_tracker/tools/whatsapp-agent/
cd ~/expense_tracker/tools/whatsapp-agent
chmod 600 config.json
cat config.json
```

Expect `apiUrl`, `token` and `phone` set, and `groupJid` still empty.

### 3.4 🔌 Laptop — delete the shared-storage copy

`/sdcard` is readable by other apps and this file holds the bearer token:

```sh
# 💻 Laptop
adb shell rm /sdcard/Download/config.json
```

**By hand, if you prefer (📟 Termux on the phone):** `cp config.example.json config.json`,
`chmod 600 config.json`, then edit with `nano config.json`. `sendAt` must be exactly `"22:00"` and
`timezone` exactly `"Asia/Kolkata"` — the window is computed from a fixed +05:30 with no DST, so a
different value would not change the schedule, only mislead.

**No adb or no USB?** Copy the file over MTP into `Download/`, do 3.3 in Termux, then delete it from
Downloads with the Files app.

---

## Phase 4 — 💬 Phone, WhatsApp: create the group

On **Dad's phone** — his account is the sender, and a group he is not in cannot be posted to —
create a new WhatsApp group with Mom and Son, named clearly.

---

## Phase 5 — link the device (Termux and WhatsApp, side by side)

### 5.1 📟 Termux (phone)

```sh
# 📟 Termux (phone)
node agent.mjs --link
```

It prints an **8-digit pairing code** and the number it is requesting it for. This is **one-time**;
the session written to `auth/` survives reboots, Termux restarts and config edits.

### 5.2 💬 WhatsApp (phone)

**Settings → Linked devices → Link a device → "Link with phone number instead"**, then type the
8-digit code.

- Success: the Termux process exits **`0`**, and the device is listed under Linked devices.
- **Exit `8`** = timed out → re-run `--link`.
- **`Connection Closed`** = the code was requested too early. Baileys only exposes a ready socket
  once its `qr` event fires, so the agent waits for it deliberately. Re-run.
- **One pairing-code device per number:** if Dad's number already has one, remove it in Linked
  devices first. **WhatsApp allows only 4 linked devices** — free a slot if the list is full.

---

## Phase 6 — find the group JID, and keep it in the laptop's copy

### 6.1 📟 Termux (phone) — stop the scheduler, then list groups

Every one-shot mode takes the single-instance lock and will exit `7` while the scheduler runs:

```sh
# 📟 Termux (phone)
pkill -f agent.mjs
pkill -f start.sh
node agent.mjs --groups
```

Output is name first, JID last, so the JID is easy to copy:

```text
3 group(s):

  Family Ledger               1203630xxxxxxxxx@g.us
  Family                      1203630yyyyyyyyy@g.us

Paste the intended JID into config.json as `groupJid`.
```

### 6.2 📟 Termux (phone) — paste it and prove it resolves

```sh
# 📟 Termux (phone)
nano config.json          # set "groupJid": "1203630xxxxxxxxx@g.us"

node agent.mjs --groups | grep "$(node -e "console.log(require('./config.json').groupJid)")"
```

A match means the configured JID exists and the account is a participant.

> Group list incomplete? Immediately after a first link WhatsApp is still streaming history — wait
> ~30 s and re-run. Do not conclude the group is unreachable.

### 6.3 💻 Laptop — put the JID in the laptop's copy too

The generator preserves `groupJid` from the **laptop's** file, because that is the file it reads and
rewrites. A JID that lives on the phone alone is one `--force` regenerate away from being written
back as empty, and the push that follows leaves the agent refusing to post. Neither copy warns you;
they never see each other.

```sh
# 💻 Laptop (repo root)
npm run init:whatsapp-agent-config -- --keep-jid     # a no-op except for that field
adb push tools/whatsapp-agent/config.json /sdcard/Download/config.json
adb shell rm /sdcard/Download/config.json
```

Then 📟 Termux: `cp /sdcard/Download/config.json ~/expense_tracker/tools/whatsapp-agent/` and
`chmod 600 config.json` again.

> **A JID is not permanent.** Delete the group and recreate it and the new one has a **new JID**, at
> which point the nightly post fails. Re-run `--groups` and update the config.

---

## Phase 7 — 📟 Phone, Termux: install the boot hook, then test it

```sh
# 📟 Termux (phone)
mkdir -p ~/.termux/boot
cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
chmod +x ~/.termux/boot/termux-boot.sh
```

**⚙️ Then reboot the phone**, wait two minutes, and back in Termux:

```sh
# 📟 Termux (phone), after the reboot
pgrep -f agent.mjs        # must show a live process
```

The hook fails *only* on reboot if its path is wrong — exactly when nobody is watching. An untested
boot hook is not a feature.

---

## Phase 8 — 📟 Phone, Termux: start it

```sh
# 📟 Termux (phone)
cd ~/expense_tracker/tools/whatsapp-agent
./start.sh
```

Run `./start.sh`, **not** `node agent.mjs`: the wrapper holds the wake-lock, so Android does not
freeze the socket, and restarts the agent after an ordinary crash. The wake-lock notification is
expected. Leave the Termux session.

---

## Phase 9 — prove it, before trusting it

Stop the scheduler first — every one-shot command takes the lock and will exit `7` otherwise:

```sh
# 📟 Termux (phone)
pkill -f agent.mjs
pkill -f start.sh      # the wrapper, or node is back within 30 s
```

Use `--at` with a **past** window so tonight's genuine post is untouched, and prefer a **test group**
for the real-send rehearsal.

| # | 📟 Termux command (phone) | Expected |
|---|---|---|
| 1 | `pkill` both, rename `config.json`, run the agent | exit `2`, clear message, no stack trace |
| 2 | `node agent.mjs --at "<past boundary>" --dry-run` | prints the message; the group gets **nothing** |
| 3 | `./start.sh`, then in a **second** Termux session `node agent.mjs --now` | exit `7`, "another instance is running" |
| 4 | scheduler stopped, `node agent.mjs --at "<same past boundary>"` | message appears; `sent/<key>.json` written |
| 5 | immediately re-run that same command | "already sent"; **no** second message |
| 6 | a deliberately wrong `token` in `config.json`, run once | exit `4`, loud log, **no** retry loop |
| 7 | `grep -i "<token>" agent.log` | **no matches** |
| 8 | restore the token; `./start.sh`; watch the first real 22:00 | message in the group; **no** 22:15 push |

`--at` is what makes this possible at any hour: the server treats a window older than 6 hours as
stale, so the current window is unusable for a rehearsal for 18 hours of every day.

To erase a rehearsal's trace afterwards: delete the server marker
(`digest_sent:whatsapp_feed:<windowKey>`) and the local `sent/<windowKey>.json`.

---

## Phase 10 — daily operation (📟 Termux, phone)

```sh
# 📟 Termux (phone)
tail -f agent.log      # the agent's structured decisions — watch this
tail -f boot.log       # the wrapper's lifecycle, and node's crash stacks
pgrep -f agent.mjs     # is it alive?
```

Every decision line carries the `windowKey`, the only field that ties a log line to the server's
record. `agent.log` truncates itself at ~1 MB, and the token is never logged.

### Stopping it

`pkill` on the Node process is **not enough** — `start.sh` restarts it within 30 s, so both must go:

```sh
# 📟 Termux (phone)
pkill -f agent.mjs     # the node process
pkill -f start.sh      # the wrapper — otherwise node comes back in 30 s
cat sent/agent.lock    # should be gone; if not, the agent died uncleanly
```

`pkill` comes from Android's toybox; if it is missing, `pkg install procps`. The always-available
alternative is to pull down the wake-lock notification in the Android shade and tap **Exit**.

### Exit codes

`start.sh` restarts after `0` and `1` and **refuses to restart** after the rest — restarting a state
only a human can fix produces a log that looks busy and healthy while nothing is ever delivered.

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

## When something misbehaves

| Symptom | Where to look |
|---|---|
| No post, and `agent.log` has no line for the day | One UI killed it → redo Phase 1 |
| `RE-LINK REQUIRED` in the log | 📟 `node agent.mjs --link`, then find out *why* it was unlinked |
| `401` on every fetch | Token rotated on one side only — rotate **both** (Vercel env + `config.json`), restart |
| `503` on every fetch | `DIGEST_AGENT_TOKEN` not set on Vercel — set it and redeploy |
| "stale, not posting" | The phone was off through a boundary — working as designed; the 22:15 push is the alert |
| The 22:15 push fires **every** night | The confirmation POST never succeeds — check token and connectivity. Do **not** disable the fallback |
| Push fires but the message **is** in the group | Confirmation failed after a successful send — expected, no re-send needed |
| Two messages in one night | A marker was deleted by hand, or the keys disagree — compare the log's `windowKey` with the marker's |
| Post fails with an unknown-JID error | The group was recreated — new group, new JID → re-run `--groups`, update `config.json` |

---

## Security, in one place

1. `config.json` holds the bearer token → `chmod 600`, gitignored, **never committed**.
2. `auth/` holds a live WhatsApp session → gitignored.
3. Check `git status` before every commit touching `tools/whatsapp-agent`, and confirm nothing under
   `auth/`, `sent/` or `config.json` is staged.
4. **Delete the `/sdcard/Download/config.json` copy** — Phase 3.4 exists for this reason.
5. Never paste the token into a chat, an issue, a commit message or a log line.
6. **A lost or replaced phone is a credential compromise.** Remove the device in WhatsApp → Linked
   devices, then rotate `DIGEST_AGENT_TOKEN` on Vercel **and** in `config.json`.
7. **Accepted risk:** Baileys is unofficial, so WhatsApp could restrict the linked number. The
   exposure is deliberately small — a real companion device, a residential IP, one plain-text
   message a day, one fixed destination group. The owner chose Dad's primary number knowingly.

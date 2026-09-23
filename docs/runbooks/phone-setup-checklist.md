# Phone setup checklist — the whole session, in order

**Normative source: [`docs/plans/whatsapp-agent-termux.md`](../plans/whatsapp-agent-termux.md) §3,
§4 and §7.** This is the printable run sheet for one sitting on Dad's phone; the plan explains
*why* each step exists, and `tools/whatsapp-agent/README.md` has the same material with the
reasoning attached. Where any of them disagree, the plan wins.

Print this. Work top to bottom. **Tick nothing you have not verified** — an unticked box is
useful information; a ticked box that was never checked is how a two-hour session becomes a
two-week mystery.

### Where each step happens

Every step below carries a **Where:** line. Most of the confusion this sheet creates is not about
*what* to type but *which machine* takes it, because the two vocabularies collide:

| Icon | Device | Tool |
|---|---|---|
| 💻 | Laptop (dev machine) | bash terminal, at the repository root — Git Bash on Windows |
| 🔌 | Laptop, targeting the phone | `adb` (Android platform-tools) over USB |
| 📟 | **Dad's phone** | **Termux** app — every `node`, `npm` and `pkg` command goes here |
| 💬 | Dad's phone | **WhatsApp** app |
| ⚙️ | Dad's phone | **Android Settings** / app drawer / F-Droid |

> **`npm run …` (repository scripts) belong on the 💻 laptop. `node agent.mjs …` and `npm install`
> belong in 📟 Termux on the phone.** Same words, different machines.

---

## Before touching the phone — 💻 laptop

**Where:** 💻 the laptop's terminal, at the repository root.

On a computer, with the repository checked out:

- [ ] **The app side is deployed and configured.** `DIGEST_AGENT_TOKEN` is set on Vercel and the
      deployment for the current `main` is **READY**.
- [ ] `npm run test:whatsapp-agent` → **all checks pass, exit 0**
      (the agent's window maths matches the server's)
- [ ] `npm run rehearse:whatsapp-agent` → **all checks pass, exit 0**
      (the agent's behaviour, against a stub)
- [ ] `npm run verify:digest-feed` → **0 failures, exit 0** (needs `DIGEST_AGENT_TOKEN` in
      `.env.local`; this one talks to the real deployment)
- [ ] `.env.local` has `PROD_URL`, `DIGEST_AGENT_TOKEN` and `DIGEST_AGENT_PHONE`, and
      `npm run init:whatsapp-agent-config` has written `tools/whatsapp-agent/config.json`
      (step 5 pushes it; add `--force` to overwrite an existing file)
- [ ] 🔌 **`adb` is installed (Android platform-tools) and the phone is connected** — `adb devices`
      lists it. Step 5 pushes `config.json` over it, so this is a prerequisite, not a convenience.

> **No check counts here, deliberately.** Each of these commands prints one, and this sheet used to
> quote them — but a count moves whenever an assertion is added, for reasons that have nothing to do
> with this phone. A run sheet that quotes one goes stale between sittings, and then a *correct* run
> reads as a broken one. **Exit 0 and an empty failure list are the invariant**; if a command exits
> non-zero it prints exactly which check failed, which is what you actually need to read.

**Fill these in now — you will need them on the phone, and looking them up mid-session is how
time disappears:**

| Value | Write it here |
|---|---|
| Deployment URL (`apiUrl`) | `https://__________________________.vercel.app` |
| `DIGEST_AGENT_TOKEN` *(same value as Vercel; treat it as a secret)* | `_______________________________` |
| Dad's number, **E.164 digits only — no `+`, no spaces** | `_______________________________` |
| The new group's name (create it in step 6) | `_______________________________` |

> The token and the number only need writing down if you fill `config.json` in **by hand**. The
> generator in step 5 reads both from `.env.local`, which is also the version that cannot mangle
> them on a phone keyboard.

> **The group must be created from Dad's phone**, because his account is the sender — a group he
> is not in cannot be posted to.

---

## On Dad's phone

### 1 · Install the apps — **from F-Droid, not the Play Store**

**Where:** ⚙️ F-Droid on the phone, then the app drawer, to open Termux:Boot once.

- [ ] **Termux** from F-Droid (or the GitHub releases page). The Play Store build is deprecated
      and will not install a current Node.
- [ ] **Termux:Boot** from F-Droid — the *same source* as Termux, or the boot hook silently
      does nothing.
- [ ] **Open Termux:Boot once** from the app drawer. It does nothing until it has been launched at
      least once. This is the single most common reason a boot hook fails.

### 2 · Samsung / One UI background settings — **do not skip**

**Where:** ⚙️ Android Settings on the phone.

- [ ] Battery → **Unrestricted** for Termux
- [ ] Settings → Battery → Background usage limits → **Never sleeping apps** → add Termux
- [ ] Recents → Termux → **Keep open**
- [ ] Date and time → **automatic**

This is the step that decides whether the agent runs for months or quietly stops on day three —
and when it stops, there is no error anywhere, because the process simply stops being scheduled.

### 3 · Packages

**Where:** 📟 Termux on the phone.

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
node --version          # expect a current LTS major (20 or newer)
```

- [ ] `node --version` reports **≥ 20**

### 4 · Get the agent onto the phone

**Where:** 📟 Termux on the phone.

```sh
git clone https://github.com/Shreyasss91/expense_tracker.git ~/expense_tracker
cd ~/expense_tracker/tools/whatsapp-agent
npm install
```

- [ ] `npm install` completed **without building anything native** (no `sharp`, no compiler
      errors). `.npmrc` is what makes that true — do not delete it.

### 5 · Configure

**Where:** three of them in one step — 💻 the generator runs on the laptop at the repo root; 🔌
`adb push` and `adb shell rm` run on the laptop against the connected phone; 📟 the `cp` and
`chmod` run in Termux on the phone. The commands below are grouped in that order.

**Preferred — generate the file on the laptop from `.env.local`**, so the token and the number are
never typed on a phone keyboard. A stray character in either is invisible on the phone: it shows
up as a `401` on every fetch, or as a pairing code sent to a **different** phone.

```sh
# 💻 laptop, repo root
npm run init:whatsapp-agent-config     # --force to overwrite an existing file
```

It keeps any `groupJid` already in the file **as long as `PROD_URL` has not changed**, and prints
the masked number to compare against the one `--link` prints in step 7. A changed deployment drops
the JID deliberately — a JID names a **group**, not a server, so carrying one across would feed the
new deployment's ledger to the old group's audience. `--keep-jid` overrides that when the move really
is the same family. Then push it — and **delete the copy from shared storage**, because `/sdcard` is
readable by other apps and this file holds the token:

```sh
# 🔌 laptop, targeting the phone over USB
adb push tools/whatsapp-agent/config.json /sdcard/Download/config.json

# 📟 Termux on the phone — land it and lock it down
cp /sdcard/Download/config.json ~/expense_tracker/tools/whatsapp-agent/
cd ~/expense_tracker/tools/whatsapp-agent
chmod 600 config.json

# 🔌 laptop again — /sdcard is readable by other apps
adb shell rm /sdcard/Download/config.json
```

By hand, if you prefer — the file is gitignored, and must never be committed:

```sh
# 📟 Termux on the phone
cp config.example.json config.json
chmod 600 config.json
```

Fill in `apiUrl`, `token` and **`phone`** from the table above. Leave `groupJid` empty for now.

- [ ] `config.json` has `apiUrl`, `token`, `phone` — and `phone` has **no `+`, no spaces**
- [ ] `chmod 600 config.json` done
- [ ] The `/sdcard/Download/config.json` copy is **deleted**

### 6 · Create the group

**Where:** 💬 WhatsApp on Dad's phone.

- [ ] From **Dad's phone**: new WhatsApp group with Mom and Son, named clearly

### 7 · Link the device (pairing code)

**Where:** 📟 Termux to request the code, 💬 WhatsApp on the phone to enter it. Both are on the
phone, but only one of them is a terminal.

```sh
# 📟 Termux on the phone
node agent.mjs --link
```

- [ ] The agent printed an **8-digit code** and Dad's number
- [ ] On Dad's phone: WhatsApp → **Settings** → **Linked devices** → **Link a device** →
      **"Link with phone number instead"** → type the code
- [ ] The agent exited **`0`**, and Dad's phone now lists the device under Linked devices

> If it fails with `Connection Closed`, the code was requested too early — the agent deliberately
> waits for the socket's `qr` event before asking. Re-run it. If it exits `8`, it timed out; also
> just re-run. If Dad's number already has a pairing-code device, remove it first; WhatsApp allows
> only 4 linked devices.

### 8 · Discover the group JID

**Where:** 📟 Termux for `--groups`; 💻 the laptop's `config.json` for the copy the generator
preserves.

```sh
# 📟 Termux on the phone
node agent.mjs --groups
```

- [ ] The group list printed, with the new group's **JID** (`1203630…@g.us`)
- [ ] That JID was pasted into `config.json`
- [ ] Verified it resolves:
      `node agent.mjs --groups | grep "$(node -e "console.log(require('./config.json').groupJid)")"`

- [ ] Kept the JID in the **laptop's** `config.json` too, if that is where step 5 generated it,
      and pushed again

> **Which copy holds the JID matters.** The generator preserves the `groupJid` from the **laptop's**
> copy, because that is the file it reads and rewrites. Paste the JID there and re-run
> `npm run init:whatsapp-agent-config` (a no-op except for that field) rather than editing only the
> phone — a JID that lives on the phone alone is one `--force` regenerate away from being written
> back as empty, and the push that follows leaves the agent refusing to post. Neither copy warns you;
> they never see each other.

> Group list incomplete? Immediately after a first link WhatsApp is still streaming history —
> wait ~30 s and re-run. Do not conclude the group is unreachable.

### 9 · Install the boot hook — and **test** it

**Where:** 📟 Termux on the phone, except the reboot itself, which is ⚙️ the phone.

```sh
mkdir -p ~/.termux/boot
cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
chmod +x ~/.termux/boot/termux-boot.sh
```

- [ ] Copied and made executable
- [ ] **Phone rebooted**, waited 2 minutes, then `pgrep -f agent.mjs` shows a live process

An untested boot hook is not a feature.

### 10 · Start it

**Where:** 📟 Termux on the phone.

```sh
cd ~/expense_tracker/tools/whatsapp-agent
./start.sh
```

- [ ] Running (leave the Termux session; the wake-lock notification is expected)

---

## Prove it before trusting it — 📟 Termux (phone)

**Where:** 📟 every command below runs in Termux on the phone.

**Stop the scheduler first** — every one-shot command takes the lock and will exit `7` otherwise:

```sh
pkill -f agent.mjs
pkill -f start.sh      # the wrapper, or node is back within 30 s
```

Use `--at` with a **past** window so tonight's genuine post is untouched, and prefer a **test
group** for the real-send rehearsal.

These are the eight worth doing on the day; the plan's §7 lists fourteen, including the
ladder-survives-a-restart and stale-window cases — run those too if anything is already suspect.

| # | Check | Expected | ✓ |
|---|---|---|---|
| 1 | `pkill` both, then rename `config.json` and run the agent | Exit `2`, clear message, no stack trace | |
| 2 | `node agent.mjs --at "<past boundary>" --dry-run` | Prints the message; group gets **nothing** | |
| 3 | Start `./start.sh`, then in a **second** Termux session run `node agent.mjs --now` | Exit `7`, `another instance is running` | |
| 4 | Scheduler stopped, `node agent.mjs --at "<same past boundary>"` | Message appears; `sent/<key>.json` written | |
| 5 | Immediately re-run that same command | "already sent"; **no** second message | |
| 6 | Put a deliberately wrong `token` in `config.json`, run once | Exit `4`, loud log, **no** retry loop | |
| 7 | `grep -i "<token>" agent.log` | **No matches** | |
| 8 | Restore the token; `./start.sh`; watch the first real 22:00 | Message in the group; **no** 22:15 push | |

To erase a rehearsal's trace afterwards: delete the server marker
(`digest_sent:whatsapp_feed:<windowKey>`) and the local `sent/<windowKey>.json`.

---

## After the sitting — 📟 Termux (phone)

Not part of the sitting, but the next thing you will want, and all of it is on the phone:

| I want to… | Run |
|---|---|
| Watch the agent's decisions | `tail -f agent.log` |
| Watch the wrapper, and any crash stack | `tail -f boot.log` |
| Check it is alive | `pgrep -f agent.mjs` |
| Stop it | `pkill -f agent.mjs` **and** `pkill -f start.sh` — the wrapper restarts node within 30 s |

`pkill` comes from Android's toybox; if it is missing, `pkg install procps`. The always-available
alternative is to pull down the wake-lock notification in the shade and tap **Exit**.

Which exit codes `start.sh` restarts and which it refuses to restart is tabulated in
`tools/whatsapp-agent/README.md` → *Exit codes* (and the plan's §5.8). The short version: only `0`
and `1` come back on their own.

---

## When something misbehaves

**Where:** 📟 almost all of this is Termux on the phone; `tools/whatsapp-agent/README.md` below is
the tool's own README, in the repository.

| Symptom | Where to look |
|---|---|
| No post, and `agent.log` has no line for the day | One UI killed it → redo step 2 (`tools/whatsapp-agent/README.md` → Troubleshooting) |
| `RE-LINK REQUIRED` in the log | `node agent.mjs --link`, then find out *why* it was unlinked |
| `401` on every fetch / `503` on every fetch | Token mismatch / not set on Vercel (`tools/whatsapp-agent/README.md` → Troubleshooting) |
| The 22:15 push fires **every** night | The confirmation POST never succeeds — check token and connectivity. Do **not** disable the fallback |
| Two messages in one night | A marker was deleted by hand, or the keys disagree — compare the log's `windowKey` with the marker's |
| Anything else | Plan §9 *Failure-Mode Runbook* |

**Logs:** `tail -f agent.log` (the agent's decisions) · `tail -f boot.log` (the wrapper, and any
crash stack).

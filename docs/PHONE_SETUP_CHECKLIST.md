# Phone setup checklist — the whole session, in order

**Normative source: [`docs/PLAN_WHATSAPP_AGENT_TERMUX.md`](PLAN_WHATSAPP_AGENT_TERMUX.md) §3,
§4 and §7.** This is the printable run sheet for one sitting on Dad's phone; the plan explains
*why* each step exists, and `tools/whatsapp-agent/README.md` has the same material with the
reasoning attached. Where any of them disagree, the plan wins.

Print this. Work top to bottom. **Tick nothing you have not verified** — an unticked box is
useful information; a ticked box that was never checked is how a two-hour session becomes a
two-week mystery.

---

## Before touching the phone

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

- [ ] **Termux** from F-Droid (or the GitHub releases page). The Play Store build is deprecated
      and will not install a current Node.
- [ ] **Termux:Boot** from F-Droid — the *same source* as Termux, or the boot hook silently
      does nothing.
- [ ] **Open Termux:Boot once** from the app drawer. It does nothing until it has been launched at
      least once. This is the single most common reason a boot hook fails.

### 2 · Samsung / One UI background settings — **do not skip**

- [ ] Battery → **Unrestricted** for Termux
- [ ] Settings → Battery → Background usage limits → **Never sleeping apps** → add Termux
- [ ] Recents → Termux → **Keep open**
- [ ] Date and time → **automatic**

This is the step that decides whether the agent runs for months or quietly stops on day three —
and when it stops, there is no error anywhere, because the process simply stops being scheduled.

### 3 · Packages

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
node --version          # expect a current LTS major (20 or newer)
```

- [ ] `node --version` reports **≥ 20**

### 4 · Get the agent onto the phone

```sh
git clone https://github.com/Shreyasss91/expense_tracker.git ~/expense_tracker
cd ~/expense_tracker/tools/whatsapp-agent
npm install
```

- [ ] `npm install` completed **without building anything native** (no `sharp`, no compiler
      errors). `.npmrc` is what makes that true — do not delete it.

### 5 · Configure

**Preferred — generate the file on the laptop from `.env.local`**, so the token and the number are
never typed on a phone keyboard. A stray character in either is invisible on the phone: it shows
up as a `401` on every fetch, or as a pairing code sent to a **different** phone.

```sh
npm run init:whatsapp-agent-config     # repo root; --force to overwrite an existing file
```

It keeps any `groupJid` already in the file, and prints the masked number to compare against the
one `--link` prints in step 7. Then push it — and **delete the copy from shared storage**, because
`/sdcard` is readable by other apps and this file holds the token:

```sh
adb push tools/whatsapp-agent/config.json /sdcard/Download/config.json
# in Termux:
#   cp /sdcard/Download/config.json ~/expense_tracker/tools/whatsapp-agent/
#   chmod 600 config.json
adb shell rm /sdcard/Download/config.json
```

By hand, if you prefer — the file is gitignored, and must never be committed:

```sh
cp config.example.json config.json
chmod 600 config.json
```

Fill in `apiUrl`, `token` and **`phone`** from the table above. Leave `groupJid` empty for now.

- [ ] `config.json` has `apiUrl`, `token`, `phone` — and `phone` has **no `+`, no spaces**
- [ ] `chmod 600 config.json` done

### 6 · Create the group

- [ ] From **Dad's phone**: new WhatsApp group with Mom and Son, named clearly

### 7 · Link the device (pairing code)

```sh
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

```sh
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

```sh
mkdir -p ~/.termux/boot
cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
chmod +x ~/.termux/boot/termux-boot.sh
```

- [ ] Copied and made executable
- [ ] **Phone rebooted**, waited 2 minutes, then `pgrep -f agent.mjs` shows a live process

An untested boot hook is not a feature.

### 10 · Start it

```sh
cd ~/expense_tracker/tools/whatsapp-agent
./start.sh
```

- [ ] Running (leave the Termux session; the wake-lock notification is expected)

---

## Prove it before trusting it

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

## When something misbehaves

| Symptom | Where to look |
|---|---|
| No post, and `agent.log` has no line for the day | One UI killed it → redo step 2 (`README.md` → Troubleshooting) |
| `RE-LINK REQUIRED` in the log | `node agent.mjs --link`, then find out *why* it was unlinked |
| `401` on every fetch / `503` on every fetch | Token mismatch / not set on Vercel (`README.md` → Troubleshooting) |
| The 22:15 push fires **every** night | The confirmation POST never succeeds — check token and connectivity. Do **not** disable the fallback |
| Two messages in one night | A marker was deleted by hand, or the keys disagree — compare the log's `windowKey` with the marker's |
| Anything else | Plan §9 *Failure-Mode Runbook* |

**Logs:** `tail -f agent.log` (the agent's decisions) · `tail -f boot.log` (the wrapper, and any
crash stack).

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
| ⚙️ | Dad's phone | **Android Settings**, the app drawer, the **F-Droid** app, and the phone's **browser** (Chrome) — anything that is a tap rather than a command |

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

**Where:** ⚙️ the phone's **browser**, then the **F-Droid** app, then ⚙️ Android Settings for one
permission at 1a and again at 1d, then ⚙️ the app drawer to open Termux:Boot once. **Nothing in
this step happens on the 💻 laptop.**

**First, the gate — confirm the phone can run any of this:**

- [ ] ⚙️ **Android Settings → About phone → Software information → Android version.** Everything
      here needs **Android 7.0 or newer**: Termux's current F-Droid builds all require it, and the
      agent needs Node ≥ 20, which is what 7.0+ makes possible. **On Android 5 or 6, F-Droid hides
      Termux while still showing Termux:Boot** — Termux:Boot needs only Android 5.0+ — so a phone
      below 7.0 produces exactly the *"only Termux:Boot appears"* symptom in *When something
      misbehaves*. If that is what the version says, **stop here**: nothing below installs, and no
      amount of retrying changes it.

#### 1a · Get F-Droid onto the phone — ⚙️ the browser

- [ ] Open **`https://f-droid.org`** in the phone's browser (Chrome) and tap **Download F-Droid**,
      then install the APK it downloads.
- [ ] Android will refuse that install until you allow it: ⚙️ **Settings → Apps → Special access →
      Install unknown apps → Chrome → Allow**. The wording moves around between One UI versions;
      it is the switch that permits *that app* to install APKs, and **you will need it again in
      1d** if Termux has to come from the website.

#### 1b · Install Termux — ⚙️ F-Droid

- [ ] Open **F-Droid → Search** and type the exact package name **`com.termux`** (the name search
      for "Termux" usually works too; the package name is what is reliable).
- [ ] What you should see — **verified against F-Droid on 24 September 2026**: version **0.118.3**,
      marked **suggested**, ~108 MiB, *"requires Android 7.0 or newer"*, architectures
      arm64-v8a / armeabi-v7a / x86 / x86_64. Tap **Install** and let it finish.
- [ ] Take the **suggested 0.118.3**, not the betas (`0.119.0-beta.2` / `-beta.3`). The betas only
      appear once *Include unstable versions* is enabled in F-Droid's settings, and nothing here
      needs them. 0.118.3 is also already past the `0.118.0` security fix that the token's
      `chmod 600` presumes.

#### 1c · Install Termux:Boot — ⚙️ F-Droid

- [ ] Still in **F-Droid → Search** → **`com.termux.boot`** → **0.8.1**, marked *suggested*, ~25 KiB
      → **Install**. It must come from **this same app** — the blockquote at the end of this step
      says why.

#### 1d · If Termux does not appear in F-Droid — ⚙️ F-Droid, then ⚙️ the browser

Three causes, in the order worth trying:

| Cause | What to do |
|---|---|
| **The phone is below Android 7.0** | The gate at the top of this step. F-Droid marks Termux *incompatible with your device* and filters it out of search, while Termux:Boot (5.0+) stays visible. Nothing fixes this |
| **F-Droid's index is stale** | ⚙️ F-Droid → **Updates** tab → **pull down to refresh**, and confirm ⚙️ F-Droid → Settings → Repositories has ***F-Droid*** enabled. Termux's listing was last published 29 May 2025, so an index from before then will simply not have it |
| **The app is filtered out of the listing** | Search the **exact package name `com.termux`** rather than the word "Termux" |

- [ ] **Then, and only then, the supported fallback:** open
      **`https://f-droid.org/packages/com.termux/`** in the phone's browser and tap **Download
      APK** on the **0.118.3** entry (~108 MiB — do it on wifi).
- [ ] **This is signature-safe, and that is the entire reason it is allowed.** The page says of
      that APK *"It is built and signed by F-Droid"* — the **same signing key** as the Termux:Boot
      you installed in 1c, so `sharedUserId com.termux` still matches and step 9's boot hook can
      run. Installing it is the same **Install unknown apps** permission as 1a.
- [ ] **Do not substitute any other source.** The **GitHub releases** are signed with upstream's
      **published test key** (and are `debuggable`), and **APK mirrors** — APKMirror, APKPure,
      Softonic and the like — cannot be verified at all. A mismatched signature gives you a Termux
      whose identity does not match Termux:Boot, and the symptom is not an error: **the boot hook
      silently does nothing.**
- [ ] F-Droid's own caveat about this route: installed from the website you get **no update
      notifications**, so re-check that page now and then.

#### 1e · Open Termux:Boot once — ⚙️ the app drawer

- [ ] Launch **Termux:Boot** from the app drawer. It does nothing until it has been started at
      least once, and that is the other common reason a boot hook fails — step 9 is the test.

**Termux already came from the Play Store?** Stop here and work *If Termux is already installed from
Google Play* below. The two builds cannot coexist, and switching costs a re-link.

> **Why F-Droid, and not the Play Store**, in the order the reasons cost: the Play build is **not an
> older Termux** but a separate, policy-stripped app (`termux-play-store`, **Android 11+ only**,
> *"missing functionality and bugs"* by upstream's description) which drops the shared identity the
> plugins need; **sources cannot be mixed**, so a Play Termux beside an F-Droid Termux:Boot gives a
> boot hook that fails **silently, by permission**; and Play auto-updates on its own schedule against
> a fork upstream does not support. The plan's §3.1 carries the full argument.

### 2 · Samsung / One UI background settings — **do not skip**

**Where:** ⚙️ Android Settings on the phone, ⚙️ **Recents** (the app switcher) for one item, and —
for 2b on Android 13 and below — 🔌 the 💻 laptop running `adb` against the connected phone.

This is the step that decides whether the agent runs for months or quietly stops on day three — and
when it stops there is no error anywhere, because the process simply stops being scheduled.

**There are two independent killers, and they look identical from `agent.log`:** One UI's battery
manager (**2a**) and AOSP's own process limits (**2b**, Android 12+). A missed night means checking
both, because they are fixed in different places.

#### 2a · One UI's battery manager — ⚙️ Settings

**Menu names move between One UI versions.** Where two paths are given, either will do — the second
is the older wording.

- [ ] ⚙️ **Per-app battery:** Settings → **Apps → Termux → Battery** → **Unrestricted** (the choices
      are *Unrestricted / Optimised / Restricted*).
- [ ] ⚙️ **Keep it out of the sleeping lists:** Settings → **Battery → Background usage limits**
      (older One UI: Settings → **Battery and device care → Battery** → *Background usage limits*).
      - [ ] *Sleeping apps* **and** *Deep sleeping apps*: **remove Termux** if it appears in either.
      - [ ] *Never sleeping apps* → **＋ Add** → **Termux** — and **Termux:Boot** as well.
- [ ] ⚙️ Same screen → ***Put unused apps to sleep*** → **off**, or confirm Termux is exempt.
- [ ] ⚙️ Settings → **Battery and device care** → **⋮ (More options) → Automation** →
      ***Auto optimize daily***: **off**. (Newer One UI may show that screen as *Battery* rather than
      *Battery and device care* — either wording, same screen. *Restart when needed* lives there too; an
      automatic reboot is survivable — step 9's boot hook is what brings the agent back — but the
      first one after this sitting is worth watching.)
- [ ] ⚙️ **Keep it in memory — Recents:** open Termux, press **Recents** (three vertical lines),
      then on the Termux card tap the **app icon at the top of the card** — not the card itself —
      → **Keep open**. Older One UI calls it *Lock this app* / *Keep open for quick launching*. The
      card then carries a small padlock.
- [ ] ⚙️ **Date and time:** Settings → **General management → Date and time** →
      ***Automatic date and time*** on.
- [ ] ⚙️ **Repeat the battery items for Termux:Boot.** It is the plugin that starts the agent after
      a reboot, so if *it* is allowed to sleep, step 9's boot hook can fail silently. (Termux:Boot
      has no `Battery → Unrestricted` of its own worth setting — the two list items above are what
      matter.)
- [ ] ⚙️ Allow the **notification** permission when Android asks for it on Termux. `start.sh` takes
      a wake-lock, which surfaces a persistent notification, and the wake-lock is what keeps the
      WhatsApp socket alive; a denied permission makes both harder to reason about.

#### 2b · AOSP's own process killer — the second, independent cause

From **Android 12** onward the OS kills processes on its own account, with nothing to do with One UI
or its battery settings. Upstream's description: *"Android OS will kill any (phantom) processes
**greater than 32** (limit is for all apps combined) and also kill any processes using excessive
CPU"*. In the terminal it shows as `[Process completed (signal 9) - press Enter]`; in `agent.log` it
is just a day with no line.

**What you do depends only on the Android version — and the toggle does *not* exist before 14:**

| Android | What to do | Notes |
|---|---|---|
| **14 or newer** | ⚙️ Settings → **Developer options** → ***Disable child process restrictions*** → **reboot** | On **Samsung it is a top-level Settings entry** near the bottom, not under *System* as on stock Android |
| **13 or 12L** | 🔌 `adb shell "settings put global settings_enable_monitor_phantom_procs false"`, once, then reboot | **No toggle on these versions.** A global setting, so it survives reboots |
| **12** | 🔌 `adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"`, then reboot | Same; no toggle |

- [ ] ⚙️ **Unlock Developer options first, if you need the toggle:** Settings → **About phone →
      Software information** → tap **Build number** **seven times**. (Samsung's own instructions;
      if a lock screen is set you are asked for your PIN.) Nothing on the phone says where this
      lives, which is why it is the most-missed step in this section.
- [ ] 🔌 `adb` is already a prerequisite — the pre-flight check and step 5 both use it, so the USB
      connection you need for Android 13 and below is the one you already have.
- [ ] ⚠️ **On Android 14+, this fix is fragile in a specific way: turning Developer options back
      **off** silently re-arms the killer**, and an OS update can do the same. Re-check the toggle
      after any One UI update — or prefer the `adb` command above, which is a global setting and is
      not undone that way. **This is also why an OS update is a reason to re-do 2a and 2b both.**

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

> **The one standing obligation this step creates.** WhatsApp logs a linked device out when the
> primary phone goes **unused for more than 14 days** (*"Linked devices work without your phone
> online, but will log out if your phone is unused for over 14 days"*). The agent does **not** need
> the phone at 22:00 — but it does need the phone to have been *used* at least once a fortnight. A
> phone in daily use satisfies this by itself; a phone in a drawer does not, and the feed then stops
> with `RE-LINK REQUIRED` and exit `3`. Nothing in this setup can remove that; it is in the plan as
> **P13**.

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

## If Termux is already installed from Google Play

**Where:** 💻 the laptop, ⚙️ Android Settings, 📟 Termux — noted per step below.

**This cannot be patched from where you are.** Termux and its plugins share one Android identity
and must all be signed with the same key, so a Play Termux and an F-Droid Termux:Boot are refused
by Android — and the Play build removed `sharedUserId` outright. Step 9's boot hook *cannot* work
on a Play install, and it fails silently. Switching is the only fix, and its real cost is **a
re-link**, so plan for that rather than discovering it.

### Rescue what exists only on the phone

Only two things are not reproducible, and both are on the 💻 laptop side of the work:

- [ ] **The group JID.** It is discovered on the phone and no formula derives it. Paste it into the
      **laptop's** `tools/whatsapp-agent/config.json` *now*, before wiping anything — the generator
      preserves it from that copy, so the reinstall needs a re-link but **not** a second JID
      discovery. (This is step 8's rule, applied early.)
- [ ] Anything under `~/expense_tracker` that is not in git. The clone is reproducible and the
      agent regenerates `config.json`; `auth/`, `sent/` and the logs are state that is *meant* to be
      rebuilt, and `auth/` is the one that will not survive.

Termux's own backup can carry `~/` across, but this runbook does not rely on a restored `auth/`
from a different Termux build. Assume you are redoing `--link`.

### Uninstall everything Termux — ⚙️ Android Settings

- [ ] Android Settings → **Applications**, search `termux`, and uninstall **Termux *and* every
      plugin** — Termux:Boot, and Termux:API / :Styling / :Widget if you ever installed them.
      Upstream's uninstall section insists on the double-check even when you are sure.
- [ ] After the F-Droid install, Google Play may keep trying to "update" Termux and keep failing
      (the Play build has no `sharedUserId` to update into). To stop the noise: open the Termux
      page in Google Play → ⋮ → disable **Enable auto update**.

### Reinstall and re-enter the sheet

- [ ] **⚙️** Reinstall **Termux and Termux:Boot from F-Droid** — if Termux will not appear in the
      F-Droid app, use the F-Droid **website** APK exactly as **step 1d** describes (it is the same
      signing key, so the plugins still match; a GitHub or mirror APK is not). Then open Termux:Boot
      once, and re-apply **step 2** — the battery settings and the Android 12+ restriction are
      per-install.
- [ ] **📟** Work **step 3 → step 10**. Step 5 does **not** need a new config: the laptop's
      `config.json` still holds the token, the number and now the JID, so it is one
      `npm run init:whatsapp-agent-config` and one `adb push`.
- [ ] **📟** `node agent.mjs --link` is required — `auth/` went with the uninstall.
- [ ] **📟** Step 9's boot-hook test (reboot, then `pgrep -f agent.mjs`) is the check that proves
      the source rules are now satisfied. If it still does nothing, the cause is one of the two in
      step 1.

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

**Once a fortnight:** open WhatsApp on **Dad's phone**. That is the whole task — opening it is the
requirement (step 7's note, plan P13). Miss it and WhatsApp logs the agent out along with every other
linked device, and the feed stops until step 7 is re-run.

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

## Could this run somewhere other than the phone?

**Yes — and it is written up in the plan's §12 — but it is not what this sheet sets up.** A linked
device does not need the phone online to send, so a home machine (Raspberry Pi, old laptop, mini PC,
NAS) could post the nightly message instead, and that deletes the whole family of silent-death causes
in step 2.

Two facts decide whether it is worth it:

- the primary phone must still be **used once every 14 days** (§7's note) — moving the runtime does
  *not* remove that dependency; and
- the host must hold a **long-lived socket**, so it cannot be Vercel, and a cloud VPS remains rejected
  (a datacenter IP is what gets flagged).

Pair on the machine that will run it — `auth/` is a live session and must never be copied between
hosts. **D12 still says Dad's phone**, so nothing here changes unless that decision does.

---

## When something misbehaves

**Where:** 📟 almost all of this is Termux on the phone; `tools/whatsapp-agent/README.md` below is
the tool's own README, in the repository.

| Symptom | Where to look |
|---|---|
| No post, and `agent.log` has no line for the day | **Two** independent killers — One UI's battery manager, or AOSP's process limits on Android 12+ → redo step 2 |
| `[Process completed (signal 9) - press Enter]` in the terminal | AOSP's phantom-process killer (Android 12+) → step 2's last item |
| Boot hook did nothing after a reboot, and Termux came from the Play Store | Play and F-Droid builds cannot be mixed → *If Termux is already installed from Google Play* |
| **Termux does not appear in F-Droid at all, but Termux:Boot does** | Termux needs **Android 7.0+** while Termux:Boot needs only 5.0+, so F-Droid hides the one and shows the other on an older phone — or the index is stale | Check ⚙️ Settings → About phone → Android version first. Then ⚙️ F-Droid → *Updates* → pull down to refresh, and search the exact name `com.termux`. Still missing → the F-Droid website APK (step 1d) |
| Termux is installed, but the boot hook never runs | The APK came from **GitHub, a mirror, or Play**, so its signature does not match Termux:Boot's | Uninstall Termux **and every plugin**, reinstall both from F-Droid (step 1, and the migration section above) |
| `RE-LINK REQUIRED` in the log | `node agent.mjs --link`, then find out *why* it was unlinked |
| `RE-LINK REQUIRED`, and the feed has been silent for days | Check when Dad's phone was **last used** — WhatsApp logs every linked device out after 14 days of it going unused (P13). Use the phone, then re-run step 7 |
| `401` on every fetch / `503` on every fetch | Token mismatch / not set on Vercel (`tools/whatsapp-agent/README.md` → Troubleshooting) |
| The 22:15 push fires **every** night | The confirmation POST never succeeds — check token and connectivity. Do **not** disable the fallback |
| Two messages in one night | A marker was deleted by hand, or the keys disagree — compare the log's `windowKey` with the marker's |
| Anything else | Plan §9 *Failure-Mode Runbook* |

**Logs:** `tail -f agent.log` (the agent's decisions) · `tail -f boot.log` (the wrapper, and any
crash stack).

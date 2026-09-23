#!/data/data/com.termux/files/usr/bin/sh
#
# Termux:Boot hook — makes the agent survive a phone reboot.
# Normative source: docs/plans/whatsapp-agent-termux.md §3.8.
#
# INSTALL:
#   mkdir -p ~/.termux/boot
#   cp ~/expense_tracker/tools/whatsapp-agent/boot/termux-boot.sh ~/.termux/boot/
#   chmod +x ~/.termux/boot/termux-boot.sh
#
# Then OPEN Termux:Boot once from the app drawer. The app does nothing until it
# has been launched at least once, and that is the single most common reason a
# boot hook silently does nothing.
#
# TEST IT — do not assume it: reboot the phone, wait two minutes, then
#   pgrep -f agent.mjs
# An untested boot hook is not a feature.

termux-wake-lock

# The repo path from the setup instructions. If you copied the agent somewhere
# else, edit this line — and note that a wrong path here fails ONLY on reboot,
# which is exactly when nobody is watching.
AGENT_DIR="$HOME/expense_tracker/tools/whatsapp-agent"
if [ ! -d "$AGENT_DIR" ]; then
  echo "[$(date)] agent directory not found: $AGENT_DIR — check the path in ~/.termux/boot/termux-boot.sh" >> "$HOME/boot.log"
  exit 1
fi
cd "$AGENT_DIR" || exit 1

# `nohup`, not `setsid`: setsid is not part of a default Termux install (it comes
# from util-linux), so the boot script would fail silently — and only ever after
# a reboot, when you are not watching.
nohup ./start.sh >> boot.log 2>&1 &

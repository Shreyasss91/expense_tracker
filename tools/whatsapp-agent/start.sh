#!/data/data/com.termux/files/usr/bin/sh
#
# Wake-lock + crash-restart wrapper for the WhatsApp sender agent.
# Normative source: docs/plans/whatsapp-agent-termux.md §6.5.
#
# Run this, not `node agent.mjs`, for the long-running scheduler. It holds a
# wake-lock so Android does not freeze the socket, and restarts the agent after a
# crash — but deliberately NOT after an exit a human has to fix.
#
# stdout/stderr of node go to boot.log rather than agent.log: the agent already
# writes its own structured lines to agent.log, so redirecting there too would
# duplicate every line and make that file twice as confusing to read. boot.log
# therefore holds the wrapper's lifecycle plus a copy of node's output, which is
# where a crash stack trace lands. Watch the agent with:  tail -f agent.log

set -u
cd "$(dirname "$0")" || exit 1

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  trap 'termux-wake-unlock' EXIT
else
  echo "[$(date)] termux-wake-lock not found — is this Termux? continuing without a wake-lock" >> boot.log
fi

while true; do
  node agent.mjs >> boot.log 2>&1
  code=$?

  # 2, 3, 4 and 7 all mean "the agent cannot heal itself": bad config, a
  # WhatsApp-unlinked device, a wrong token, or another instance holding the
  # lock. Restarting them produces a log that looks busy and healthy while
  # nothing is ever delivered — the worst failure mode available here.
  case "$code" in
    2|3|4|7)
      echo "[$(date)] fatal exit $code — not restarting. See docs/plans/whatsapp-agent-termux.md §5.8 / §9" >> boot.log
      if command -v termux-wake-unlock >/dev/null 2>&1; then termux-wake-unlock; fi
      exit "$code"
      ;;
  esac

  # 0 and 1: a clean finish or an ordinary crash. Safe to restart, because the
  # retry ladder is persisted and exhaustion is a state rather than an exit.
  echo "[$(date)] agent exited $code — restarting in 30s" >> boot.log
  sleep 30
done

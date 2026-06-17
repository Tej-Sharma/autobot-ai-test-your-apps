#!/usr/bin/env bash
# Spawn `claude --print` configured for mobile-mcp control of an iOS simulator.
# Sourced by bin/autobot.

set -euo pipefail

# Write a temporary .mcp.json that enables mobile-mcp scoped to a specific UDID.
# Args: <out-path> <udid>
claude_write_mcp_config() {
  local out="$1" udid="$2"
  cat > "$out" <<EOF
{
  "mcpServers": {
    "mobile-mcp": {
      "command": "npx",
      "args": ["-y", "@mobilenext/mobile-mcp@latest"],
      "env": {
        "DEVICE_UDID": "$udid",
        "PLATFORM": "ios"
      }
    }
  }
}
EOF
}

# Compose a prompt file from _shared-rules.md + the caller's pass-specific prompt.
# Echoes the path to a temp file the caller must `rm` afterward.
# Args: <pass-specific-prompt-file>
claude_compose_prompt() {
  local pass_prompt="$1"
  local out; out=$(mktemp)
  local autobot_home
  autobot_home="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  {
    cat "$autobot_home/templates/_shared-rules.md"
    echo
    echo "---"
    echo
    cat "$pass_prompt"
  } > "$out"
  echo "$out"
}

# Seed the journal-based memory for a run. Creates the run's screenshots/ dir,
# pre-touches the three per-run journals so the agent's first append never fails on a
# missing file, and seeds the cross-run state-graph (the screen-coverage map) if it
# doesn't exist yet. Called from the target repo's cwd, so .autobot is relative.
# Args: <report-dir>
claude_seed_run_dir() {
  local report_dir="$1"
  mkdir -p "$report_dir/screenshots"
  touch "$report_dir/journal.jsonl" "$report_dir/flaws.jsonl" "$report_dir/critique.jsonl"
  [ -f .autobot/state-graph.json ] || echo '{"nodes": [], "edges": []}' > .autobot/state-graph.json
}

# Echo the run-context bullets shared by every pass: where the journals, screenshots,
# and the persisted state graph live. All paths relative to the target repo cwd (which
# is where the spawned claude runs), matching how the agent references them.
# Args: <report-dir>
claude_run_context_paths() {
  local report_dir="$1"
  cat <<EOF
- Journal (step trace — append one JSON line per step): \`$report_dir/journal.jsonl\`
- Flaws journal (append the moment you notice a flaw): \`$report_dir/flaws.jsonl\`
- Critique verdicts (one line per screenshot, written in the critique pass): \`$report_dir/critique.jsonl\`
- Screenshots dir (save PNGs here as \`<flow-slug>__NN_<action>.png\`; reference them in journals as \`screenshots/<name>\`): \`$report_dir/screenshots/\`
- State graph (the screen-coverage map; PERSISTS across runs): \`.autobot/state-graph.json\`
EOF
}

# Locate the `mobilecli` binary that mobile-mcp drives the simulator through.
# Prefers the copy already in the npx cache (so we match mobile-mcp's version);
# falls back to fetching it via npx on a fresh machine. Echoes a runnable command,
# or empty string if neither is available.
claude_mobilecli_cmd() {
  local bin
  case "$(uname -m)" in
    arm64) bin="mobilecli-darwin-arm64" ;;
    *)     bin="mobilecli-darwin-amd64" ;;
  esac
  local found
  found=$(find "$HOME/.npm/_npx" -name "$bin" -type f 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    echo "$found"
  elif command -v npx >/dev/null 2>&1; then
    echo "npx -y mobilecli@latest"
  else
    echo ""
  fi
}

# Pre-warm WebDriverAgent before the drive pass. The first interactive call on a
# fresh simulator triggers a WDA build/install that can take 1–2 min; if that
# happens mid-drive, the agent sees "timed out waiting for WebDriverAgent" and can
# fall into an app open→exit→reopen recovery loop that looks broken to the user.
# Paying that cost here (with a clear message) keeps the drive pass clean.
# Best-effort: any failure just falls through — the prompt also has a wait-and-retry
# rule as a safety net. Set AUTOBOT_SKIP_WDA_PREWARM=1 to skip.
# Args: <mcp-config-path>
claude_prewarm_wda() {
  local mcp_config="$1"
  [ -n "${AUTOBOT_SKIP_WDA_PREWARM:-}" ] && return 0

  local udid
  udid=$(/usr/bin/python3 -c "
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
    print(cfg['mcpServers']['mobile-mcp']['env']['DEVICE_UDID'])
except Exception:
    pass
" "$mcp_config" 2>/dev/null || true)
  [ -z "$udid" ] && return 0

  local mc; mc=$(claude_mobilecli_cmd)
  [ -z "$mc" ] && return 0

  echo ">> Warming up WebDriverAgent on the simulator (first run can take 1–2 min)..." >&2
  # Install the on-device agent (idempotent / fast once present).
  $mc agent install --device "$udid" >/dev/null 2>&1 || true

  # Poll until WDA actually answers, so the drive agent never races the cold start.
  local deadline=$(( $(date +%s) + 180 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if $mc device info --device "$udid" >/dev/null 2>&1; then
      echo ">> WebDriverAgent ready." >&2
      return 0
    fi
    sleep 3
  done
  echo "   (WDA not confirmed ready after 180s — continuing; the drive agent will keep retrying)" >&2
  return 0
}

# Run claude with a prompt file, the MCP config, and tool allowlist.
# Args: <prompt-file> <mcp-config> <work-dir>
claude_run() {
  local prompt_file="$1" mcp_config="$2" work_dir="$3"
  # Default to Sonnet — much faster than Opus for UI exploration with comparable
  # judgement. Override with AUTOBOT_CLAUDE_MODEL=claude-opus-4-7 if needed.
  local model="${AUTOBOT_CLAUDE_MODEL:-claude-sonnet-4-6}"

  if ! command -v claude >/dev/null 2>&1; then
    echo "ERR: claude CLI not found on PATH. Install Claude Code first." >&2
    exit 1
  fi

  # Budgets:
  # - wall-clock: AUTOBOT_TIMEOUT_SECONDS (default 600 = 10min). Hard kill.
  # - dollars: AUTOBOT_MAX_BUDGET_USD (default 2). Claude self-aborts on exhaustion.
  local timeout_s="${AUTOBOT_TIMEOUT_SECONDS:-600}"
  local budget_usd="${AUTOBOT_MAX_BUDGET_USD:-2}"

  # macOS doesn't ship GNU `timeout`; prefer gtimeout, fall back to perl.
  local -a timeout_cmd
  if command -v gtimeout >/dev/null 2>&1; then
    timeout_cmd=(gtimeout "$timeout_s")
  elif command -v timeout >/dev/null 2>&1; then
    timeout_cmd=(timeout "$timeout_s")
  else
    timeout_cmd=(perl -e 'alarm shift; exec @ARGV' "$timeout_s")
  fi

  # Get WebDriverAgent up before the drive agent starts, so it doesn't hit a
  # cold-start timeout loop on its first interactive call.
  claude_prewarm_wda "$mcp_config"

  (
    cd "$work_dir"
    # Scope tools tightly:
    # - drop TaskCreate/TaskUpdate/TaskList (the agent shouldn't self-manage tasks here)
    # - drop ToolSearch (all required tools are loaded; searching wastes turns)
    # - keep only file ops + Bash + every mobile-mcp tool
    "${timeout_cmd[@]}" claude \
      --print \
      --model "$model" \
      --mcp-config "$mcp_config" \
      --strict-mcp-config \
      --permission-mode bypassPermissions \
      --max-budget-usd "$budget_usd" \
      --allowedTools "Bash" "Read" "Write" "Edit" "Glob" "Grep" "mcp__mobile-mcp" \
      --output-format stream-json \
      --include-partial-messages \
      --verbose \
      < "$prompt_file"
  )
}

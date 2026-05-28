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

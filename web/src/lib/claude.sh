#!/usr/bin/env bash
# Spawn `claude --print` configured for Playwright MCP control of a browser.
# Sourced by bin/webbot.

set -euo pipefail

# Compose a prompt file: _shared-rules.md + pass-specific prompt + run context.
# Echoes the path to a temp file the caller must `rm` afterward.
# Args: <pass-specific-prompt-file> <run-context-file>
claude_compose_prompt() {
  local pass_prompt="$1" run_context="$2"
  local out; out=$(mktemp)
  local webbot_home
  webbot_home="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  {
    cat "$webbot_home/templates/_shared-rules.md"
    echo; echo "---"; echo
    cat "$pass_prompt"
    echo; echo "---"; echo
    cat "$run_context"
  } > "$out"
  echo "$out"
}

# Write the run-context block every pass receives. All paths absolute — they cross
# a process boundary into the spawned claude.
# Args: <out-path> <app-url> <run-dir> <webbot-dir> [flow-file] [auth-block]
claude_write_run_context() {
  local out="$1" app_url="$2" run_dir="$3" webbot_dir="$4" flow_file="${5:-}" auth_block="${6:-}"
  cat > "$out" <<EOF
# Run context

- **App base URL**: $app_url
- **Run directory**: $run_dir
- **Journal (step trace)**: $run_dir/journal.jsonl
- **Flaws journal**: $run_dir/flaws.jsonl
- **Critique verdicts**: $run_dir/critique.jsonl
- **Screenshots**: saved by \`browser_take_screenshot\` into $run_dir/screenshots/
  (pass a flat \`filename\` like \`<flow-slug>__NN_<action-slug>.png\`; reference it
  in journals as \`screenshots/<that-filename>\`)
- **State graph (persists across runs)**: $webbot_dir/state-graph.json
- **Flow definitions**: $webbot_dir/CLAUDE.md
- **Critique rubric**: $webbot_dir/critique-rubric.md
- **Latest-report symlink to refresh**: $webbot_dir/reports/latest -> $run_dir
EOF
  if [ -n "$flow_file" ]; then
    cat >> "$out" <<EOF
- **flowFile (the test plan to execute)**: $flow_file
- **Counter file (create if a flow needs unique values)**: $webbot_dir/counter
EOF
  fi
  # Credentials + tester preferences (from .webbot/config.json, via webbot creds /
  # the init setup step). Present only when the user configured them.
  if [ -n "$auth_block" ]; then
    { echo; echo "$auth_block"; } >> "$out"
  fi
}

# Run claude with a prompt file, the MCP config, and a tight tool allowlist.
# Args: <prompt-file> <mcp-config> <work-dir>
claude_run() {
  local prompt_file="$1" mcp_config="$2" work_dir="$3"
  # Opus 4.8 default: the drive pass benefits from stronger judgement and the
  # journaling discipline keeps context small. WEBBOT_CLAUDE_MODEL=claude-sonnet-4-6
  # is a fine speed/cost override.
  local model="${WEBBOT_CLAUDE_MODEL:-claude-opus-4-8}"

  if ! command -v claude >/dev/null 2>&1; then
    echo "ERR: claude CLI not found on PATH. Install Claude Code first." >&2
    exit 1
  fi

  # Budgets:
  # - wall-clock: WEBBOT_TIMEOUT_SECONDS (default 900 = 15min). Hard kill.
  # - dollars: WEBBOT_MAX_BUDGET_USD (default 3). Claude self-aborts on exhaustion.
  local timeout_s="${WEBBOT_TIMEOUT_SECONDS:-900}"
  local budget_usd="${WEBBOT_MAX_BUDGET_USD:-3}"

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
    # - no TaskCreate/TaskUpdate (the journal files are the agent's memory)
    # - no ToolSearch (everything needed is loaded)
    # - file ops + Bash + every playwright MCP tool
    "${timeout_cmd[@]}" claude \
      --print \
      --model "$model" \
      --mcp-config "$mcp_config" \
      --strict-mcp-config \
      --permission-mode bypassPermissions \
      --max-budget-usd "$budget_usd" \
      --allowedTools "Bash" "Read" "Write" "Edit" "Glob" "Grep" "mcp__playwright" \
      --output-format stream-json \
      --include-partial-messages \
      --verbose \
      < "$prompt_file"
  )
}

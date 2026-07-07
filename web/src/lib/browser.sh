#!/usr/bin/env bash
# Playwright MCP config + storage-state helpers.
# Sourced by bin/webbot.

set -euo pipefail

# Write a temporary .mcp.json enabling Playwright MCP for this run.
# - --isolated: clean profile per run (reproducible); auth comes from storage-state
# - --output-dir: where browser_take_screenshot saves files → <run-dir>/screenshots
# When with_figma=1, a second server (the Figma Dev Mode MCP) is added so the design
# pass can pull rendered frames + design tokens. The transport is machine-global (the
# Figma desktop app's local server, or a custom URL) — only the *which file* binding is
# per-repo (config.json). Default URL is the local desktop server; override with
# WEBBOT_FIGMA_MCP_URL.
# Args: <out-path> <run-dir> <storage-state-path-or-empty> <grant-mic-0/1> <with-figma-0/1>
browser_write_mcp_config() {
  local out="$1" run_dir="$2" storage_state="${3:-}" grant_mic="${4:-0}" with_figma="${5:-0}"

  local -a extra=()
  if [ -n "$storage_state" ] && [ -f "$storage_state" ]; then
    extra+=("\"--storage-state\", \"$storage_state\",")
  fi
  if [ -n "${WEBBOT_HEADLESS:-}" ]; then
    extra+=("\"--headless\",")
  fi
  if [ -n "${WEBBOT_TRACE:-}" ]; then
    # Exposes browser_start_tracing/stop_tracing (full Playwright trace into
    # --output-dir) for failure forensics; the agent uses them when told to.
    extra+=("\"--caps\", \"devtools\",")
  fi
  # Voice-input flows: auto-accept the getUserMedia permission prompt so the page can
  # read the (BlackHole) system mic — real device, NOT synthetic. Set WEBBOT_NO_MIC_ARG=1
  # if your @playwright/mcp build rejects --browser-arg.
  if [ "$grant_mic" = 1 ] && [ -z "${WEBBOT_NO_MIC_ARG:-}" ]; then
    extra+=("\"--browser-arg\", \"--use-fake-ui-for-media-stream\",")
  fi

  # The Figma block, only for the design pass. An http transport pointed at the local
  # Dev Mode server (Figma desktop → Shift-D → Enable desktop MCP server) by default.
  local figma_block=""
  if [ "$with_figma" = 1 ]; then
    local figma_url="${WEBBOT_FIGMA_MCP_URL:-http://127.0.0.1:3845/mcp}"
    figma_block=",
    \"figma\": {
      \"type\": \"http\",
      \"url\": \"$figma_url\"
    }"
  fi

  mkdir -p "$run_dir/screenshots"
  cat > "$out" <<EOF
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y", "@playwright/mcp@latest",
        "--isolated",
        ${extra[@]+"${extra[@]}"}
        "--output-dir", "$run_dir/screenshots"
      ]
    }$figma_block
  }
}
EOF
}

# Is the Figma MCP transport reachable? Used by `webbot doctor` (informational — only the
# design pass needs it). Args: none (reads WEBBOT_FIGMA_MCP_URL or the desktop default).
figma_mcp_reachable() {
  local figma_url="${WEBBOT_FIGMA_MCP_URL:-http://127.0.0.1:3845/mcp}"
  # The server speaks MCP-over-HTTP; a plain GET returns *something* (often 4xx) when it's
  # up and connection-refused when it's not. Treat any HTTP response as reachable.
  curl -s -o /dev/null --max-time 3 "$figma_url" 2>/dev/null
}

# Capture auth into a storage-state file by letting the user log in manually.
# Opens a headed browser via playwright codegen; on close, cookies/localStorage are
# saved. Future runs inject this state so flows start logged in.
# Args: <app-url> <storage-state-out>
browser_capture_auth() {
  local app_url="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  echo ">> A browser will open. Log into the app, then CLOSE the browser window." >&2
  echo ">> Auth state will be saved to $out" >&2
  npx -y playwright codegen --save-storage="$out" "$app_url" >/dev/null 2>&1 || true
  if [ -f "$out" ]; then
    echo ">> Saved. Runs will now start authenticated." >&2
  else
    echo "WARN: no storage state was saved (window closed without logging in?)" >&2
    return 1
  fi
}

# Make sure a Chromium build is available for Playwright. Idempotent, ~1 min first time.
browser_ensure_chromium() {
  echo ">> Ensuring Playwright Chromium is installed..." >&2
  npx -y playwright install chromium >/dev/null 2>&1 || {
    echo "WARN: 'npx playwright install chromium' failed — Playwright MCP may download on first use." >&2
  }
}

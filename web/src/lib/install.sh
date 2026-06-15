#!/usr/bin/env bash
# One-shot dependency install. Sourced by bin/webbot.

set -euo pipefail

# Args: <webbot-home>
install_all() {
  local home="$1"
  echo ">> webbot install"

  local ok=1
  for bin in node npx curl; do
    if command -v "$bin" >/dev/null 2>&1; then
      echo "ok   $bin"
    else
      echo "MISS $bin — install Node.js 20+ first (https://nodejs.org)"; ok=0
    fi
  done
  if command -v claude >/dev/null 2>&1; then
    echo "ok   claude"
  else
    echo "MISS claude — install Claude Code: npm i -g @anthropic-ai/claude-code"; ok=0
  fi
  [ "$ok" = 1 ] || { echo "Install the missing tools above, then re-run."; exit 1; }

  browser_ensure_chromium

  # Symlink the CLI onto PATH.
  local link_dir="/usr/local/bin"
  [ -w "$link_dir" ] || link_dir="$HOME/.local/bin"
  mkdir -p "$link_dir"
  ln -sf "$home/bin/webbot" "$link_dir/webbot"
  echo "ok   linked $link_dir/webbot"

  # Install/refresh the Claude Code skill so "test my web app" routes to webbot.
  mkdir -p "$HOME/.claude/skills/webbot"
  cp "$home/src/skill/SKILL.md" "$HOME/.claude/skills/webbot/SKILL.md"
  echo "ok   Claude Code skill (~/.claude/skills/webbot)"

  case ":$PATH:" in
    *":$link_dir:"*) ;;
    *) echo "NOTE: add $link_dir to your PATH" ;;
  esac

  echo "all set. Run: webbot init <url-or-project-path>"
}

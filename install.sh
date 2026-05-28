#!/usr/bin/env bash
# autobot — one-shot bootstrap for a fresh Mac.
#
# Usage from a clean machine (no git checkout needed):
#   curl -fsSL <RAW_URL_TO_THIS_FILE> | bash
#
# Or, from a local clone:
#   ./install.sh
#
# What this does:
#   1. Ensure Homebrew is installed (offers to install if missing)
#   2. Clone (or update) the autobot repo into ~/.autobot
#   3. Run `autobot install` to install deps + symlink + skill

set -euo pipefail

REPO_URL="${AUTOBOT_REPO_URL:-https://github.com/Tej-Sharma/autobot-ios-tester.git}"
INSTALL_DIR="${AUTOBOT_INSTALL_DIR:-$HOME/.autobot}"

echo
echo "═══ autobot bootstrap ═══"
echo

# 1. Ensure Homebrew (the only hard prereq for everything else).
if ! command -v brew >/dev/null 2>&1; then
  echo "→ Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this shell.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

# 2. Clone or update the repo.
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing checkout at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "→ Cloning $REPO_URL → $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

# 3. Run the in-CLI installer.
chmod +x "$INSTALL_DIR/bin/autobot"
"$INSTALL_DIR/bin/autobot" install

echo
echo "═══ bootstrap done ═══"
echo
echo "Open a new terminal (or \`exec \$SHELL\`) so the PATH symlink takes effect."
echo

#!/usr/bin/env bash
# webbot — one-shot bootstrap for a fresh machine.
#
# webbot is the web-app tester that ships in the `web/` subfolder of the
# autobot-ios-tester repo (its sibling, autobot, tests iOS apps from the repo root).
#
# Usage from a clean machine (no git checkout needed):
#   curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/web/install.sh | bash
#
# Or, from a local clone:
#   ./web/install.sh
#
# What this does:
#   1. Clone (or update) the repo into ~/.webbot
#   2. Run `webbot install` (from the web/ subfolder) to install deps + symlink + skill

set -euo pipefail

REPO_URL="${WEBBOT_REPO_URL:-https://github.com/Tej-Sharma/autobot-ai-test-your-apps.git}"
REPO_BRANCH="${WEBBOT_REPO_BRANCH:-development}"
INSTALL_DIR="${WEBBOT_INSTALL_DIR:-$HOME/.webbot}"

echo
echo "═══ webbot bootstrap ═══"
echo

# webbot lives in web/ relative to the repo root. WEBBOT_HOME is the directory that
# holds bin/webbot — i.e. the web/ subfolder of the checkout.
WEBBOT_HOME=""

# If we're running from inside a checkout, use it directly — handles both
# `./web/install.sh` (script sits next to bin/webbot) and being run from elsewhere.
_script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$_script_dir" ] && [ -f "$_script_dir/bin/webbot" ]; then
  WEBBOT_HOME="$_script_dir"
  echo "→ Installing from local checkout at $WEBBOT_HOME"
elif [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing checkout at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
  WEBBOT_HOME="$INSTALL_DIR/web"
else
  echo "→ Cloning $REPO_URL ($REPO_BRANCH) → $INSTALL_DIR..."
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  WEBBOT_HOME="$INSTALL_DIR/web"
fi

if [ ! -f "$WEBBOT_HOME/bin/webbot" ]; then
  echo "ERR: could not locate bin/webbot under $WEBBOT_HOME" >&2
  exit 1
fi

chmod +x "$WEBBOT_HOME/bin/webbot"
"$WEBBOT_HOME/bin/webbot" install

echo
echo "═══ bootstrap done ═══"
echo
echo "Open a new terminal (or \`exec \$SHELL\`) so the PATH symlink takes effect."
echo

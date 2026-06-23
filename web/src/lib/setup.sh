#!/usr/bin/env bash
# Interactive setup helpers + persistent credential/preference store.
# Sourced by bin/webbot. Mirrors the prompting idiom of the sibling autobot
# wizard (src/lib/wizard.sh): all reads come from /dev/tty so prompting works
# even when stdin is a pipe, and is skipped cleanly when no terminal is attached.
#
# Persistent local state (reused by EVERY run, on top of the per-run journals):
#   .webbot/config.json
#     "credentials": [ {label,email,password,notes}, ... ]   # a list — many logins
#     "preferences": "free-form tester guidance"
# Secrets stay local: .webbot/ is gitignored.

set -euo pipefail

# Print a heading.
_w_h() { echo >&2; echo "═══ $* ═══" >&2; echo >&2; }

# Is a terminal available to prompt on?
_w_have_tty() { [ -e /dev/tty ] && [ -r /dev/tty ]; }

# Prompt for a single line. Echoes the answer. Args: <prompt> [default]
_w_ask() {
  local prompt="$1" default="${2:-}" answer
  if [ -n "$default" ]; then printf "%s [%s]: " "$prompt" "$default" >&2
  else printf "%s: " "$prompt" >&2; fi
  read -r answer </dev/tty
  [ -z "$answer" ] && [ -n "$default" ] && answer="$default"
  echo "$answer"
}

# Prompt for a secret (no echo). Echoes the answer. Args: <prompt>
_w_ask_secret() {
  local prompt="$1" answer
  printf "%s: " "$prompt" >&2
  read -rs answer </dev/tty
  echo >&2
  echo "$answer"
}

# Prompt for a multiline block (blank line ends it). Echoes all lines.
_w_ask_block() {
  local prompt="$1" line
  echo "$prompt (one per line; blank line to finish):" >&2
  local lines=()
  while IFS= read -r line </dev/tty; do [ -z "$line" ] && break; lines+=("$line"); done
  [ ${#lines[@]} -gt 0 ] && printf '%s\n' "${lines[@]}"
}

# Yes/no. Echoes "y" or "n". Args: <prompt> [default y|n]
_w_yn() {
  local prompt="$1" default="${2:-n}" answer
  printf "%s [%s/%s]: " "$prompt" \
    "$( [ "$default" = y ] && echo Y || echo y )" \
    "$( [ "$default" = n ] && echo N || echo n )" >&2
  read -r answer </dev/tty
  answer="${answer:-$default}"
  case "$answer" in y|Y|yes) echo y ;; *) echo n ;; esac
}

# Append one credential set to config.json. Args: <config> <label> <email> <password> <notes>
setup_add_credential() {
  /usr/bin/python3 -c "
import json, sys
f, label, email, pw, notes = sys.argv[1:6]
cfg = json.load(open(f))
cfg.setdefault('credentials', [])
cfg['credentials'].append({'label': label or 'login', 'email': email, 'password': pw, 'notes': notes})
json.dump(cfg, open(f, 'w'), indent=2)
" "$1" "$2" "$3" "$4" "$5"
}

# Set the preferences string on config.json. Args: <config> <preferences>
setup_set_preferences() {
  /usr/bin/python3 -c "
import json, sys
f, prefs = sys.argv[1], sys.argv[2]
cfg = json.load(open(f))
cfg['preferences'] = prefs
json.dump(cfg, open(f, 'w'), indent=2)
" "$1" "$2"
}

# How many credentials are stored. Args: <config>
setup_credential_count() {
  /usr/bin/python3 -c "
import json, sys
try: print(len(json.load(open(sys.argv[1])).get('credentials') or []))
except Exception: print(0)
" "$1" 2>/dev/null || echo 0
}

# Prompt for credentials + preferences and persist them. Args: <config>
# Non-interactive seeding via env (used by agent-driven runs):
#   WEBBOT_CRED_EMAIL / WEBBOT_CRED_PASSWORD [/ WEBBOT_CRED_LABEL]  → one login
#   WEBBOT_PREFS                                                    → preferences
# Skips silently (with a hint) when there's no terminal and no env seed.
setup_credentials() {
  local config="$1"

  # 1. Env seeding — works headless (agent spawns, CI).
  if [ -n "${WEBBOT_CRED_EMAIL:-}" ]; then
    setup_add_credential "$config" "${WEBBOT_CRED_LABEL:-primary}" \
      "$WEBBOT_CRED_EMAIL" "${WEBBOT_CRED_PASSWORD:-}" "seeded from env"
    echo ">> Stored credential for $WEBBOT_CRED_EMAIL (from env)." >&2
  fi
  [ -n "${WEBBOT_PREFS:-}" ] && setup_set_preferences "$config" "$WEBBOT_PREFS"

  # 2. Interactive prompting — only if a terminal is attached.
  if ! _w_have_tty; then
    if [ "$(setup_credential_count "$config")" = 0 ]; then
      echo ">> No terminal + no WEBBOT_CRED_EMAIL — skipping credential setup." >&2
      echo "   Add logins later with 'webbot creds add', or set WEBBOT_CRED_EMAIL/WEBBOT_CRED_PASSWORD." >&2
    fi
    return 0
  fi

  _w_h "Login credentials"
  cat >&2 <<EOF
If the app needs sign-in, give webbot a test login. It's stored locally in
$config (which is gitignored) and reused by every run — the agent types it into
the app's own login form. You can add several (e.g. an admin + a regular user).
EOF
  if [ "$(_w_yn "Add a login now?" y)" = y ]; then
    while :; do
      local label email pw notes
      label=$(_w_ask "Label (e.g. primary, admin)" "primary")
      email=$(_w_ask "Email / username")
      pw=$(_w_ask_secret "Password (hidden)")
      notes=$(_w_ask "Notes (optional, e.g. 'paid plan')" "")
      if [ -n "$email" ]; then
        setup_add_credential "$config" "$label" "$email" "$pw" "$notes"
        echo "  ✓ stored '$label' ($email)" >&2
      fi
      [ "$(_w_yn "Add another login?" n)" = y ] || break
    done
  fi

  _w_h "Tester preferences (optional)"
  cat >&2 <<EOF
Anything that should guide how the app is tested — persona to assume, choices to
make on onboarding/preference screens, sample data style, areas to focus or avoid.
Free-form; blank line to finish.
EOF
  local prefs; prefs=$(_w_ask_block "Preferences")
  [ -n "$prefs" ] && setup_set_preferences "$config" "$prefs"
}

# Emit a markdown block describing stored credentials + preferences, for the run
# context handed to the driving agent. Empty output if nothing is stored.
# Args: <config>
config_auth_block() {
  /usr/bin/python3 -c "
import json, sys
try: cfg = json.load(open(sys.argv[1]))
except Exception: sys.exit(0)
creds = cfg.get('credentials') or []
prefs = (cfg.get('preferences') or '').strip()
out = []
if creds:
    out.append('## Test credentials (type these into the app\'s OWN login/signup form)')
    out.append('')
    for c in creds:
        line = f\"- **{c.get('label','login')}** — email/username: \`{c.get('email','')}\`  password: \`{c.get('password','')}\`\"
        if c.get('notes'): line += f\"  ({c['notes']})\"
        out.append(line)
    out.append('')
    out.append('Use the FIRST credential unless a flow names another. Prefer email+password; '
               'do not use OAuth (Google/Apple) buttons unless a flow explicitly tests them. '
               'Confirm you reach an authenticated screen before continuing the flow.')
if prefs:
    out.append('')
    out.append('## Tester preferences (honor these throughout)')
    out.append('')
    out.append(prefs)
print('\n'.join(out))
" "$1" 2>/dev/null || true
}

# Print stored credentials (passwords masked) + preferences. Args: <config>
setup_show() {
  /usr/bin/python3 -c "
import json, sys
try: cfg = json.load(open(sys.argv[1]))
except Exception:
    print('(no config)'); sys.exit(0)
creds = cfg.get('credentials') or []
if not creds:
    print('credentials: (none) — add with: webbot creds add')
else:
    print(f'credentials ({len(creds)}):')
    for c in creds:
        pw = c.get('password') or ''
        masked = (pw[:1] + '•'*max(0, len(pw)-1)) if pw else '(empty)'
        n = f\"  [{c['notes']}]\" if c.get('notes') else ''
        print(f\"  - {c.get('label','login')}: {c.get('email','')} / {masked}{n}\")
prefs = (cfg.get('preferences') or '').strip()
print('preferences:', prefs if prefs else '(none)')
" "$1"
}

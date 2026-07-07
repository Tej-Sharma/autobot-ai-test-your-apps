#!/usr/bin/env bash
# Shim around go-ios so mobile-mcp's detection passes.
# mobile-mcp (ios.js) checks `ios version` JSON .version.startsWith("v"); go-ios 1.2.0
# now returns "1.2.0" (no "v"), so detection wrongly fails. We rewrite ONLY the version
# subcommand and pass every other invocation straight through to the real binary.
REAL=/Users/tejas1/.hermes/node/bin/ios
if [ "${1:-}" = "version" ] || [ "${1:-}" = "--version" ]; then
  echo '{"version":"v1.2.0"}'
  exit 0
fi
exec "$REAL" "$@"

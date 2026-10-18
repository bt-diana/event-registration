#!/usr/bin/env bash
# Runs typecheck, lint and tests for api/ and web/. Stops at the first failure.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
for app in api web; do
  [ -f "$root/$app/package.json" ] || continue
  for cmd in typecheck lint test; do
    echo "== $app: npm run $cmd"
    (cd "$root/$app" && npm run --silent "$cmd") || { echo "VERIFY FAILED: $app $cmd" >&2; exit 1; }
  done
done
echo "VERIFY OK"

#!/usr/bin/env bash
# SubagentStop hook for code-writer. Exit 2 sends the message back to the agent.
# 1) verify fails -> agent must fix it. 2) verify passes -> agent must run a review
#    and fix findings, then verify again. The second stop (stop_hook_active) is allowed.
input="$(cat)"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(bash "$root/scripts/verify.sh" 2>&1)" || {
  echo "Verify failed. Fix it before you stop:" >&2
  echo "$out" | tail -40 >&2
  exit 2
}
if echo "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi
echo "Verify passed (typecheck, lint, tests). Now review your changes: start the feature-dev:code-reviewer agent on the diff against the feature spec (correctness and requirements only), fix every real finding, and make sure scripts/verify.sh still passes before you stop." >&2
exit 2

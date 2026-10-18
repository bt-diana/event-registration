#!/usr/bin/env bash
# UserPromptSubmit hook. Adds a reminder to every prompt: start with a spec, and build UI from the design canvas.
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Project rules (hook): (1) Start every task that changes behaviour, code or UI with a spec. Read docs/specs/SPEC_TEMPLATE.md, then write or update the spec in docs/specs/ (use the spec-writer agent) BEFORE any code or tests. Do not treat SPEC_TEMPLATE.md behaviours as requirements. Questions, reviews and pure config or docs changes do not need a spec. (2) Implement UI from the design canvas https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76 (read it with the Artifact tool, action read) and docs/brand.md: match its screens, colours, type and spacing. If a screen is missing, add a new board to that canvas first; do not create a new design artifact."}}
EOF

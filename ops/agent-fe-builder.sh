#!/usr/bin/env bash
# fe-builder: the builder's permissions plus Next.js's built-in MCP (/_next/mcp, Next 16).
# Starts `next dev` on a private port for the agent's run, stops it on exit.
# Lives in ops/ (lead-only), so no ticket PR can widen the agent's permissions.
set -uo pipefail
PORT=${FE_BUILDER_PORT:-3210}
export NEXT_TELEMETRY_DISABLED=1
mkdir -p .sdlc-run
# Own process group, so the trap stops `next dev` and the server it forks.
# Agent variables are cleared for it alone: `next dev` otherwise writes a block into
# AGENTS.md (lead-only), which would dirty the tree and fail the ticket's scope check.
setsid env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE \
  npx --no-install next dev -H 127.0.0.1 -p "$PORT" > .sdlc-run/fe-builder-dev.log 2>&1 &
DEV=$!
trap 'kill -TERM -- "-$DEV" 2>/dev/null; wait "$DEV" 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/" \
  || echo "fe-builder: next dev not ready on $PORT; see .sdlc-run/fe-builder-dev.log" >&2

claude -p "$1" ${SDLC_BUILD_MODEL:+--model "$SDLC_BUILD_MODEL"} \
  --permission-mode acceptEdits --no-session-persistence \
  --strict-mcp-config \
  --mcp-config "{\"mcpServers\":{\"next\":{\"type\":\"http\",\"url\":\"http://127.0.0.1:$PORT/_next/mcp\"}}}" \
  --allowedTools Read Edit Write Glob Grep mcp__next \
    'Bash(.sdlc/bin/sdlc:*)' 'Bash(npm test:*)' 'Bash(npm run --silent lint)' \
    'Bash(npm run typecheck)' 'Bash(npx --no-install vitest:*)' 'Bash(npx --no-install tsc:*)' \
    'Bash(git status:*)' 'Bash(git diff:*)' 'Bash(git log:*)' 'Bash(git show:*)' \
  < /dev/null

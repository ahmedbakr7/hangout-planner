#!/usr/bin/env bash
# fe-builder: the builder's permissions plus Next.js's built-in MCP (/_next/mcp, Next 16).
# Starts `next dev` on a private port for the agent's run, stops it on exit.
# Lives in ops/ (lead-only), so no ticket PR can widen the agent's permissions.
set -uo pipefail
PORT=${FE_BUILDER_PORT:-3210}
export NEXT_TELEMETRY_DISABLED=1
mkdir -p .sdlc-run
# A server already on the port may be a stale `next dev` (the runner's SIGKILL skips the trap)
# serving old code; refuse to reuse it.
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "fe-builder: port $PORT is in use; stop the old server (ps -eo pid,args | grep 'next dev')" >&2
  exit 1
fi
# Own process group, so the trap stops `next dev` and the server it forks.
# Agent variables are cleared for it alone: `next dev` otherwise writes a block into
# AGENTS.md (lead-only), which would dirty the tree and fail the ticket's scope check.
setsid env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE \
  npx --no-install next dev -H 127.0.0.1 -p "$PORT" > .sdlc-run/fe-builder-dev.log 2>&1 &
DEV=$!
stop() {
  kill -TERM -- "-$DEV" 2>/dev/null
  for _ in 1 2 3 4 5; do kill -0 -- "-$DEV" 2>/dev/null || break; sleep 1; done
  kill -KILL -- "-$DEV" 2>/dev/null
  wait "$DEV" 2>/dev/null
}
trap stop EXIT
trap 'exit 143' TERM INT
# Ready = this server's own "Ready" line, then any HTTP answer (`/` loads data on the server
# and may 500 without the database). The log check stops another process on the port from
# passing for ours; a `next dev` that exits early fails at once.
ready=
for _ in $(seq 1 60); do
  kill -0 "$DEV" 2>/dev/null || break
  if grep -q 'Ready in' .sdlc-run/fe-builder-dev.log && curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "fe-builder: next dev exited or was not ready on $PORT within 60s; see .sdlc-run/fe-builder-dev.log" >&2
  exit 1
fi

# Every tool call and its result goes to a transcript; the runner's log gets the final
# message and any denied tool calls.
mkdir -p .sdlc-run/logs
TRANSCRIPT=.sdlc-run/logs/fe-builder-$(date +%Y%m%d-%H%M%S)-$$.jsonl
echo "fe-builder: transcript $TRANSCRIPT"
claude -p "$1" ${SDLC_BUILD_MODEL:+--model "$SDLC_BUILD_MODEL"} \
  --permission-mode acceptEdits --no-session-persistence \
  --output-format stream-json --verbose \
  --strict-mcp-config \
  --mcp-config "{\"mcpServers\":{\"next\":{\"type\":\"http\",\"url\":\"http://127.0.0.1:$PORT/_next/mcp\"}}}" \
  --allowedTools Read Edit Write Glob Grep mcp__next \
    'Bash(.sdlc/bin/sdlc:*)' 'Bash(npm test:*)' 'Bash(npm run --silent lint)' \
    'Bash(npm run typecheck)' 'Bash(npx --no-install vitest:*)' 'Bash(npx --no-install tsc:*)' \
    'Bash(git status:*)' 'Bash(git diff:*)' 'Bash(git log:*)' 'Bash(git show:*)' \
  < /dev/null > "$TRANSCRIPT"
rc=$?
node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
for (const line of lines) {
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== "result") continue;
  if (e.result) console.log(e.result);
  for (const d of e.permission_denials ?? []) console.log("fe-builder: denied " + d.tool_name + " " + JSON.stringify(d.tool_input));
}' "$TRANSCRIPT"
exit $rc

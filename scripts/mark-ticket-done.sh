#!/usr/bin/env bash
# Mark ticket YAML frontmatter status → done (product-root helper).
#
# Usage:
#   scripts/mark-ticket-done.sh T-001-01
#   scripts/mark-ticket-done.sh T-001-01 T-001-02
#   scripts/mark-ticket-done.sh --from-text "build T-001-28: confirmed ui"
#
# Conveyor /review Approve path: after lead squash-merges a build/test PR,
# call this with the ticket id(s) so status flips without a later bulk PR.
# GitHub Action (install from ops/mark-ticket-done.yml → .github/workflows/)
# does the same on pull_request closed+merged by parsing title/body/head for T-NNN-NN.
#
# Reuses kit frontmatter finder at .sdlc/scripts/lib/frontmatter.py (read-only;
# do not edit .sdlc/). Idempotent when status is already done.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FM_PY="${ROOT}/.sdlc/scripts/lib/frontmatter.py"
[[ -f "$FM_PY" ]] || { echo "mark-ticket-done: missing $FM_PY (kit pin)" >&2; exit 1; }

die() { echo "mark-ticket-done: $*" >&2; exit 1; }

extract_ids_from_text() {
  # Unique T-NNN-NN ids in appearance order
  grep -oE 'T-[0-9]+-[0-9]+' <<<"$1" | awk '!seen[$0]++'
}

mark_one() {
  local id="$1"
  [[ "$id" =~ ^T-[0-9]+-[0-9]+$ ]] || die "bad ticket id: $id"

  local path
  path="$(python3 "$FM_PY" find "$id")" || die "no ticket file for $id"

  python3 - "$path" "$id" <<'PY'
import re, sys
path, tid = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
if not text.startswith("---"):
    print(f"mark-ticket-done: FAIL — no frontmatter in {path}", file=sys.stderr)
    sys.exit(1)
parts = text.split("---", 2)
if len(parts) < 3:
    print(f"mark-ticket-done: FAIL — bad frontmatter in {path}", file=sys.stderr)
    sys.exit(1)
fm = parts[1]
m = re.search(r"(?m)^status:\s*(\S+)", fm)
if not m:
    print(f"mark-ticket-done: FAIL — no status field in {path}", file=sys.stderr)
    sys.exit(1)
cur = m.group(1)
if cur == "done":
    print(f"mark-ticket-done: OK ({path} already done)")
    sys.exit(0)
new_fm = re.sub(r"(?m)^status:\s*\S+", "status: done", fm, count=1)
open(path, "w", encoding="utf-8").write("---" + new_fm + "---" + parts[2])
print(f"mark-ticket-done: OK ({path} {cur} → done)")
PY
}

ids=()
if [[ "${1:-}" == "--from-text" ]]; then
  shift
  [[ $# -ge 1 ]] || die "usage: mark-ticket-done.sh --from-text <text>"
  text="$*"
  while IFS= read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(extract_ids_from_text "$text")
elif [[ $# -eq 0 ]]; then
  die "usage: mark-ticket-done.sh <T-NNN-NN>… | --from-text <text>"
else
  ids=("$@")
fi

if [[ ${#ids[@]} -eq 0 ]]; then
  echo "mark-ticket-done: no ticket ids found; nothing to do"
  exit 0
fi

for id in "${ids[@]}"; do
  mark_one "$id"
done

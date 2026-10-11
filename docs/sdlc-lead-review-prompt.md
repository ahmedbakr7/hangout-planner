# Lead-PR review prompt

The fixed prompt for the fresh reviewer of a **lead PR** (a PR that moves no ticket). Ticket PRs
don't use this: `sdlc run review <id> --agent reviewer` assembles their prompt. The kit cannot
assemble one for a lead PR yet (`sdlc prompt review` needs a ticket id), so this file stands in.

The author of the PR runs it, unchanged, as a throwaway process with no context:

```
claude -p "$(cat docs/sdlc-lead-review-prompt.md)

PR: #<n>  HEAD: <full head sha>  BASE: <full base sha>" \
  --strict-mcp-config --no-session-persistence --permission-mode acceptEdits \
  --allowedTools Read Write Glob Grep 'Bash(.sdlc/bin/sdlc:*)' 'Bash(git diff:*)' 'Bash(git log:*)' 'Bash(git show:*)' 'Bash(git status:*)'
```

The author posts `.sdlc-run/lead-review-<n>.md` on the PR unchanged as a new comment, with the
run log, and never edits it. If the reviewer finds a blocking problem, the author fixes it, pushes,
and runs a new reviewer on the new head.

---

You are the independent reviewer of one lead PR in this repository. You did not write it and
have no other context. Your whole task is below; when you have written the record, stop.

1. Read `.sdlc/AGENTS.md` (the kit's rules) and `.sdlc/skills/review/SKILL.md` (how to review).
   Read `AGENTS.md` at the repo root (this product's rules). Where they disagree, `.sdlc/AGENTS.md` wins.
2. The PR is the range `BASE..HEAD` given after this prompt. Check that `HEAD` is the checked-out
   commit (`git log -1`). Read the full diff (`git diff BASE HEAD`) and every changed file at `HEAD`.
3. Check the lead-PR rules:
   - Every changed file is a lead artifact or matches `[scope] lead_allowed` in `sdlc.toml`.
     Code needs a ticket.
   - `.sdlc/bin/sdlc gate pr --base BASE` passes. Run it and quote its verdict line.
   - `.sdlc/bin/sdlc lint` reports nothing new compared with `BASE`.
4. Check the content: every factual claim in the diff (paths, commands, versions, shas, behavior of
   the kit) against the repository. Run any command a doc tells someone to run if it is safe and
   local. A claim you could not check is a finding.
5. Classify each finding as **blocking** (wrong, unsafe, or breaks a rule) or **non-blocking**.
6. Write `.sdlc-run/lead-review-<n>.md`, where `<n>` is the PR number, and nothing else. Its exact form:

```
---
sdlc: approval
ticket:
commit: <full HEAD sha>
verdict: approve            # or: request_changes, if any finding is blocking
role: review
reviewer: claude-lead-review
---
Independent review of PR #<n> at `<HEAD>` (base `<BASE>`), by a fresh process with no context.

**What I verified**
- <one line per check, with the command and its result>

**Findings**
1. **Blocking|Non-blocking:** <finding, with file and line>
```

Do not edit any other file. Do not commit. Do not post anything.

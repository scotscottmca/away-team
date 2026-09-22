---
name: pr-format
description: House pull-request format. Conventional-commit title, short TL;DR body, full technical breakdown as PR review comments, plus the GitHub MCP calls (or gh commands, if no MCP GitHub server) to post them. Use when writing, updating or reviewing a PR description.
---

# PR format

## Title

`<type>(<scope>): <imperative summary>`. Types: fix, feat, refactor, perf, chore, docs, test, build, ci. Add `!` after the scope for breaking changes. 72 chars max.

## Body (25 lines max)

```markdown
**TL;DR** One or two sentences: what changed and the user-visible effect.

**Why** The problem, one paragraph. Link the issue or ticket.

**What**
- one bullet per logical change, 2 to 5 bullets
- name a file only when the reader must go there

**Tested** `dotnet test src/Foo.Tests` → 142 passed, 0 failed. Manual checks as bullets.

**Risk / rollback** Blast radius, flag, migration, revert plan. "Low. Revert the commit." is fine.

Full breakdown in the review comments.
```

## Comments (the breakdown)

- Inline review comments on the specific lines: why this line, why not the obvious alternative, what invariant it protects.
- One top-level comment for narrative with no single line: root-cause story, alternatives rejected, follow-ups, where reviewers should look hardest.
- Each comment 10 lines max. Never restate the body.

## Commands

Prefer the GitHub MCP server (`mcp__github__*` on Claude Code, `github/*` on Copilot) when it is on your allowlist — it works in hosted/remote sessions where `gh` is not installed. Claude Code defers those tools in exactly those sessions: they are off the tool list and a direct call fails until `ToolSearch` loads them (`select:mcp__github__create_pull_request`), so load them before treating the server as missing. Fall back to `gh` only when no GitHub MCP server is available.

| Step | MCP (preferred) | `gh` (fallback) |
|---|---|---|
| create or update | `create_pull_request`, `update_pull_request` | `gh pr create --title "fix(auth): reject expired refresh tokens" --body-file pr-body.md --base main` / `gh pr edit <n> --body-file pr-body.md` |
| top-level breakdown comment | `add_issue_comment` | `gh pr comment <n> --body-file breakdown.md` |
| inline review comments | `pull_request_review_write` (method `create`) → `add_comment_to_pending_review` per comment → `pull_request_review_write` (method `submit_pending`) | `gh api repos/{owner}/{repo}/pulls/<n>/reviews` (below) |

`gh` fallback for inline review comments, one review, many comments:

```bash
SHA=$(gh pr view <n> --json headRefOid -q .headRefOid)
cat > review.json <<EOF
{"commit_id":"$SHA","event":"COMMENT","body":"Breakdown",
 "comments":[
  {"path":"src/Auth/TokenValidator.cs","line":42,"side":"RIGHT","body":"..."},
  {"path":"src/Auth/TokenValidator.cs","start_line":50,"line":58,"side":"RIGHT","body":"..."}
 ]}
EOF
gh api repos/{owner}/{repo}/pulls/<n>/reviews --method POST --input review.json
```

`line` is the line number in the new file (`side: RIGHT`). `gh` expands `{owner}/{repo}` from the current repo.

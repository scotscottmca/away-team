---
name: pr-format
description: House pull-request format. Conventional-commit title, short TL;DR body, full technical breakdown as PR review comments, plus the gh commands to post them. Use when writing, updating or reviewing a PR description.
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

```bash
# create or update
gh pr create --title "fix(auth): reject expired refresh tokens" --body-file pr-body.md --base main
gh pr edit <n> --body-file pr-body.md

# top-level breakdown comment
gh pr comment <n> --body-file breakdown.md

# inline review comments: one review, many comments
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

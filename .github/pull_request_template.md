<!--
Title: <type>(<scope>): <imperative summary> — fix, feat, refactor, perf, chore, docs, test, build, ci.
`!` after the scope for a breaking change. 72 chars max.
Body: 25 lines. The full breakdown goes in review comments, not here. See skills/pr-format/SKILL.md.
-->

**TL;DR** One or two sentences: what changed and the user-visible effect.

**Why** The problem, one paragraph. Link the issue.

**What**
- one bullet per logical change, 2 to 5 bullets
- name a file only when the reader must go there

**Tested** `npm test` → N passed, 0 failed. Manual checks as bullets.

**Risk / rollback** Blast radius, migration, revert plan. "Low. Revert the commit." is fine.

<!-- Releases: a change under agents/, skills/, bin/, hooks/ or package.json publishes to npm on merge. -->

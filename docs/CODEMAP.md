# Code map: away-team
commit: ed90d21be147eb20d7f7bdb9b079f0d753f1a118   updated: 2026-09-22   by: mapper

## What this is
A multi-agent orchestrator framework for GitHub Copilot and Claude Code that beams down a crew of specialist agents (mapper, investigator, basher, pr-writer, reviewer) to fix bugs end-to-end. The orchestrator classifies requests, gates decisions, and relays structured reports from specialists. Built for installation into `~/.copilot/`, `~/.claude/`, or `.github/.copilot/` per repo, it delegates to a strong-tier root-cause specialist (investigator), then a balanced-tier fixer (basher), then a PR writer, minimizing tokens by keeping each agent's context narrow and read-only where appropriate.

## Stack
Node.js 20.19.0+, JavaScript, npm, Biome (linter), npm test (TAP).
GitHub Copilot and Claude Code as target platforms.
MCP servers (GitHub, Azure DevOps, Jira, generic) allowed; read-only enforcement via hooks.

## Build / test / run
- build: `npm run build` (renders `dist/copilot` and `dist/claude` from `agents/`, commits to dist/)
- test: `npm test` (runs `biome lint`, `npm run build`, then `node --test test/build-output.test.js`)
- lint: `npm run lint` (biome lint)
- install (global): `npx @scotscottmca/away-team` or `github:scotscottmca/away-team`
- install (project scope): `npx @scotscottmca/away-team --scope project` (writes to `.claude/` and `.github/`)
- run one test: `node --test test/build-output.test.js --grep <pattern>` (after `npm ci && npm run build`)

## Entry points
| Entry | Kind | Where | Notes |
|---|---|---|---|
| Orchestrator | Claude Code / Copilot agent | `agents/away-team.agent.md` | Routes to 5 specialists via delegation; gates with AskUserQuestion before edit/push |
| Mapper | Claude Code / Copilot agent | `agents/away-team-mapper.agent.md` | Writes `docs/CODEMAP.md` only; refreshes on diff if exists |
| Investigator | Claude Code / Copilot agent | `agents/away-team-investigator.agent.md` | Read-only (enforced by hook); returns `## Diagnosis` or `## Blocked` |
| Basher | Claude Code / Copilot agent | `agents/away-team-basher.agent.md` | Applies Diagnosis, writes commit, not push; returns `## Fix report` or `## Blocked` |
| PR writer | Claude Code / Copilot agent | `agents/away-team-pr-writer.agent.md` | Creates/updates PR, posts breakdown comments; returns `## PR report` or `## Blocked` |
| Reviewer | Claude Code / Copilot agent | `agents/away-team-reviewer.agent.md` | Answers open PR review threads: small fixes committed, larger ones proposed, a reply on each; returns `## Revision report` or `## Blocked` |
| Installer | CLI | `bin/away-team.js` | Detects platform, prompts for scope/target, renders dist/, installs to filesystem or skips plugins |

## Modules
### Orchestrator (agents/away-team.agent.md)
Routes "map", "investigate", "fix", "pr", "review" intents to specialists, and turns non-bug work away to the default agent; gates before basher (confidence, auth/crypto/billing/migration, no-fix case) and pr-writer / reviewer (confirm push, GitHub setup). Balanced tier, no model invocation (disable-model-invocation: true). Read-only Bash and MCP via hook. Relays only the latest report per specialist; never re-verifies or improvises. Subagents are stateless; every word costs ~5x input. Cannot run as a subagent (returns Blocked if harness says so).

### Mapper (agents/away-team-mapper.agent.md)
Writes `docs/CODEMAP.md` (entry points, module boundaries, data flow, invariants, verified build/test commands). Refreshes on diff if the map exists and `commit:` header is recent. Maxturns: 50. Cheap tier. Inventory only (no whole-file reads): project files, CI config, README, top-level dirs, entry-point traces, hot spots (6-month git log). Output: `## Map report` or `## Blocked`.

### Investigator (agents/away-team-investigator.agent.md)
Root-causes bugs or stack traces. Read-only (Bash + MCP reads only; Edit/Write/NotebookEdit not on tools list; `execute` and write-shaped MCP calls blocked by `readonly-guard.js` hook). Strong tier. Maxturns: 40. Reproduces, localizes via git log/blame, hypothesizes one at a time, verifies. Outputs `## Diagnosis` (symptom, root cause, evidence, confidence, fix recommendation, regression test, ruled-out hypotheses, risk) or `## Blocked`. Never edits; filing exceptions (`gh issue create`, MCP create) allowed.

### Basher (agents/away-team-basher.agent.md)
Applies a Diagnosis or fully-specified change. Regression test first, smallest root-cause fix, run affected tests, commit (no push). Balanced tier. Maxturns: 40. Grep every caller of what it changes; root cause is where all paths converge. Updates CODEMAP.md if module boundary/entry point/invariant moved. Output: `## Fix report` (change, why here, tests before/after, codemap, commit sha/msg) or `## Blocked`. Never pushes, opens PRs, spawns subagents, or touches auth/crypto/billing beyond the Diagnosis.

### PR writer (agents/away-team-pr-writer.agent.md)
Opens or refreshes a PR from current branch. Conventional-commit title, TL;DR body (25 lines max), full breakdown as inline review comments (with line-specific reasoning) and one top-level comment (narrative, rejected alternatives, follow-ups). Balanced tier. Maxturns: 20. Prefers GitHub MCP server; falls back to `gh` if no MCP. Never force-pushes, rewrites remote, or adds/removes remotes. Output: `## PR report` (URL, pushed yes/no, comment count) or `## Blocked`.

### Reviewer (agents/away-team-reviewer.agent.md)
Works through a PR's unresolved review threads. Classifies each as fix (small, local, unambiguous), propose (multi-file, contract, auth/crypto/billing/migration, design question) or answered. One commit per fix, test first for behaviour changes, pushes and replies only when the handoff says the push was confirmed, re-requests changes-requested reviewers. Never resolves threads or force-pushes. Balanced tier. Maxturns: 40; about eight fix threads per run. Output: `## Revision report` or `## Blocked`.

### Installer / Builder (bin/away-team.js)
`npx @scotscottmca/away-team` or `npm run build`. Renders agents from `agents/*.md` and skills from `skills/*/` to platform-specific output: `dist/copilot/` and `dist/claude/` (plugins), or `~/.copilot/`, `~/.claude/`, `.github/copilot/`, `.claude/` (direct install). Drops Claude-only keys (maxTurns, disallowedTools, permissionMode, skills, hooks) from Copilot render; drops Copilot-only keys (disable-model-invocation) from Claude. Resolves tier → model from `bin/models.js` per platform. Wires `readonly-guard.js` hook with `--agent` flags for each guarded agent.

### Model tier resolver (bin/models.js)
Ordered priority list: `cheap: [{claude: 'haiku', copilot: 'gpt-5.6-luna'}]`, `balanced: [{claude: 'sonnet', copilot: 'claude-sonnet-5'}]`, `strong: [{claude: 'opus', copilot: 'claude-opus-5'}]`. First row per platform wins; platform-specific key missing → skip for that platform. Edit per subscription plan, then `npm run build`.

### Read-only guard (hooks/readonly-guard.js)
PreToolUse hook (wired from each agent's frontmatter on npx install, or from `.claude/hooks/` via `hooks.json` on plugin build). Blocks write-shaped Bash on investigator and orchestrator: redirects outside temp (`/tmp`, `/var/tmp`, `$TMPDIR`, `$TEMP`, `$TMP`), file writes (`rm`, `mv`, `mkdir`, `sed -i`, `tee`, `>`, `>>`), mutating git subcommands (`commit`, `push`, `rebase`, etc.), mutating `gh` subcommands. Blocks write-shaped MCP tools (names containing `create`, `update`, `delete`, `comment`, `post`, `issue_write`, etc.). Exceptions: `gh issue create` and MCP create-issue allowed (filing). Exits 0 if agent is not guarded; exits 2 with reason on stderr to deny.

### Skills (skills/codemap, skills/pr-format)
`codemap/SKILL.md`: Template and rules for `docs/CODEMAP.md`. Entry points, modules, data flow, stores, contracts, invariants, testing map. Refresh by diff; under 400 lines; no line numbers; names not links.
`pr-format/SKILL.md`: Conventional-commit title, 25-line body (TL;DR, Why, What bullets, Tested, Risk), inline review comments (line-specific reasoning), top-level comment (narrative). Calls: MCP `create_pull_request`, `add_issue_comment`, `pull_request_review_write` + `add_comment_to_pending_review`; fallback `gh` commands.

### Test (test/build-output.test.js)
TAP test suite. Verifies frontmatter syntax in all agents (source and rendered), YAML parseable, descriptions quoted, no undefined values, no Claude-only keys in Copilot render, no Copilot-only keys in Claude render, all model IDs defined in `bin/models.js` used in agents, dist/ matches committed output, each specialist's expected report block present, read-only hooks tested (investigator and orchestrator reject write-shaped Bash and MCP, with expected error messages).

## Data flow
**User selects away-team orchestrator** → reads CODEMAP if exists → classifies intent:
- "Map this repo" → delegates to **mapper** → writes `docs/CODEMAP.md` → **Map report** → user sees commit sha, changed sections, unverified (?) marks
- "Why does X throw on Y?" / stack trace → **investigator** (read-only: reproduce, localize via git log/blame, one-at-a-time hypothesis, grep callers) → **Diagnosis** (symptom, root cause, path:line evidence, confidence, fix recommendation) → orchestrator gates (confidence high? auth/crypto/billing/migration? user asked for fix?) → stops if gate fails
- "Fix: <bug>" → **investigator** → **Diagnosis** → (gate) → **basher** → regression test (reproduces, fails), minimal fix at root-cause location (shared caller point), run affected tests → **Fix report** (change, tests before/after, commit sha) → orchestrator gates (push confirmed? GitHub set up?) → **pr-writer** → creates branch if needed, pushes, creates/updates PR, posts breakdown comments → **PR report** (URL, pushed yes/no, comment count)
- "Address the review on PR N" → (gate: confirm push, GitHub set up) → **reviewer** → unresolved threads classified fix / propose / answered → one commit per fix, affected tests, push, a reply on every thread, re-request changes-requested reviewers → **Revision report**
- "Add / build / implement / refactor" with no defect → no delegation; one line pointing at the default agent

**Installer flow:** `npx @scotscottmca/away-team [flags]` → detects platform (Copilot? Claude Code?) → prompts for scope (global / project) and target (copilot / claude / all) unless `--yes` → resolves tiers from `bin/models.js` → renders agents/ and skills/ to dist/ (both platforms) → if not `--skip-plugins`, calls plugin marketplaces; if global/project scope, writes to `~/.copilot/`, `~/.claude/`, `.github/`, `.claude/` → wires hook commands with `--agent` flags for guarded agents. SessionStart hook on Claude Code web containers: `npm install`, then `npm run build --target claude --scope project` to use fresh agents from the working tree (not committed output).

## Data stores and external services
None internal. Reads from:
- `docs/CODEMAP.md` (re-reads commit: header to decide refresh)
- `.git` (git log, git blame, git status, git log -S for symbol search)
- GitHub MCP server (if available on the machine; all read except issue create)
- Azure DevOps MCP server (read; update work item disallowed for investigator/orchestrator)
- Jira MCP server (read)
- Copilot or Claude Code plugin marketplaces (write scope: install / remove, not content)

Writes to:
- `docs/CODEMAP.md` (mapper only)
- Git commits (basher, no push; reviewer, pushed only when the user confirmed)
- PR/issue creation (pr-writer; investigator/orchestrator file only)
- PR review-thread replies and review re-requests (reviewer only; never resolves a thread)
- `dist/copilot/`, `dist/claude/` (installer/builder; committed)
- `~/.copilot/`, `~/.claude/`, `.github/`, `.claude/` (installer; gitignored)

## Contracts
### Agent frontmatter
YAML block between first two `---` lines: `name`, `description`, `tools` (comma-separated aliases: "agent", "read", "search", "execute", "edit", "todo", "ask", "web"), `skills` (names; Claude Code only), `model` (string or null), `maxTurns` (Claude Code only), `disallowedTools` (Claude Code only), `hooks` → `PreToolUse` → `matcher` (regex) + `hooks` array of `{type: "command", command: "..."}` (wired by installer if frontmatter, or from `.claude/hooks/` if plugin). No frontmatter value may break YAML parser; descriptions must be quoted scalars. Owned by source `agents/` and `skills/*/`.
A tool alias is **not** a tool name on either platform: `CLAUDE_TOOLS` and `COPILOT_TOOLS` in `bin/away-team.js` map each alias to that platform's real tool names, and Copilot drops a name it does not recognise silently rather than refusing it. So an alias that is not expanded costs the agent that capability with no error anywhere — this is how `edit` left the mapper and basher unable to write a file. Any new alias must be expanded for Copilot and asserted in `test/build-output.test.js`.

### Report blocks
Each specialist returns exactly one structured block (markdown):
- Mapper: `## Map report` (Path, Changed sections, Unverified (?)-count) or `## Blocked`
- Investigator: `## Diagnosis` (Symptom, Root cause, Evidence, Reproduction, Confidence, Fix recommendation, Regression test, Ruled out, Risk) or `## Blocked`
- Basher: `## Fix report` (Change, Why here, Tests before/after, Codemap, Commit) or `## Blocked`
- Reviewer: `## Revision report` (PR, Fixed, Proposed, Answered, Left open, Tests, Pushed, Re-requested) or `## Blocked`
- PR writer: `## PR report` (PR URL, Pushed yes/no, Comments count) or `## Blocked`
- All: `## Blocked` (Stage, Reason, Tried, Side effects, Next cheapest step, Needs)

All reports must be followed by nothing else; no extra sections, no transcripts, no summaries, no "found in passing".

### Model tier resolution
Each agent declares a tier (cheap, balanced, strong). Installer reads `bin/models.js`: `{ cheap: [{claude: '...', copilot: '...'}], balanced: [...], strong: [...] }`. Resolves per platform: first row in the tier's array that has a key for the platform wins. Edit `models.js` for your subscription plan; `npm run build` to refresh dist/.

### Installer output structure
**Global scope** (default): `~/.copilot/agents/`, `~/.copilot/skills/`, `~/.claude/agents/`, `~/.claude/skills/`. Shared across all repos on this machine.
**Project scope** (`--scope project`): `.github/copilot/`, `.github/copilot-instructions.md`, `.claude/`, `.claude/agents/`, `.claude/skills/`, `.claude/hooks/`, `.claude/settings.json` (hooks.json and session-start.sh auto-generated). Committed; teammates get them with no install.
**Plugins**: `dist/copilot/plugin.json`, `dist/claude/.claude-plugin/plugin.json` plus agents/skills. Submitted to marketplaces.

## Invariants and conventions
1. **Read-only specialists.** Investigator and orchestrator Bash/MCP are read-only enforced by `hooks/readonly-guard.js` (28a781cb; reason: minimize context by ruling out risky writes; agents declare intent; cheaper than re-reading the whole repo to verify they obeyed). Mapper reads only; writes `docs/CODEMAP.md` once. Basher, pr-writer and reviewer write: test file, git commit, PR, review-thread replies.

2. **One report per agent.** Each specialist returns exactly one block: `## <Report>` or `## Blocked`. No extra sections, no "found in passing", no partial transcripts. orchestrator relays verbatim once; never re-verifies or improvises. (Reason: output costs ~5x input; each word is expensive; truncated reports go to next specialist once.)

3. **No side effects on Blocked.** If an agent returns `## Blocked`, it changed nothing. Files, commits, branches, remotes listed under Side effects mean the agent is stuck mid-change; that state must be manually resolved before the pipeline can retry or continue.

4. **Orchestrator gates.** Before basher: confidence high? Fix touches auth/crypto/billing/data migration? User asked for fix? Before pr-writer or reviewer: user confirmed push? GitHub set up (MCP or authenticated `gh`)? (Reason: gates are cheap; stopping to ask costs one turn, less than re-doing a wrong fix or recovering from an unauthenticated push.)

5. **Model tiers, not model names.** Agents carry tiers; installer resolves per platform from `bin/models.js`. Tiers: cheap (mapper), balanced (orchestrator, basher, pr-writer, reviewer), strong (investigator). Owned by installer and `bin/models.js`; agents do not mention model names. (Reason: decouple agent logic from subscription plan; edit one file to upgrade.)

6. **Hooks wired per agent.** `hooks/readonly-guard.js` called from each agent's frontmatter hook or `.claude/hooks/hooks.json` on plugin build, with `--agent <name>` flags so the guard knows which agent to enforce. (Reason: Claude Code ignores frontmatter hooks on plugin agents; project scope must work on web containers with no setup step.)

7. **Subagent cannot gate.** Orchestrator runs only as main thread (claude --agent away-team, /away-team, or not delegated to). If delegated to as a subagent, it returns `## Blocked (stage: dispatch; reason: away-team was delegated to; needs: run it as the main thread)`. Subagents are stateless and cannot call AskUserQuestion, so gates cannot fire. (Reason: avoid nested orchestrators; cost is high; use the topmost one.)

8. **Mapper refreshes on diff.** If `docs/CODEMAP.md` exists and `commit:` header is <50 commits behind HEAD, read the header, run `git diff --stat <commit>..HEAD`, and update only sections whose paths changed. Build from scratch if missing or stale. (Reason: CODEMAP is persistent; avoid re-mapping stable code; touch only what the diff touches.)

9. **Contracts are sources of truth.** Agent frontmatter (YAML block), report blocks (markdown), `bin/models.js` (tier resolution), `hooks/hooks.json` and `.claude/settings.json` (hook wiring), `skills/*/SKILL.md` (templates). Each owned by its side; changes propagate via installer or source-control commits. (Reason: no duplication; drift is caught by tests.)

10. **No outside reads.** Specialists read only the repo they were given; no fetching docs, no web searches, no second-guessing from the internet. investigator and orchestrator allowed: git log, MCP servers on this machine, temp scripts. basher, pr-writer and reviewer: repo only (plus the PR's review threads for reviewer), and basher and reviewer read CODEMAP. (Reason: context window is the budget; external reads are expensive and often wrong.)

## Hot spots
`bin/away-team.js` (469 lines): installer logic, platform detection, prompts, rendering template substitution, model tier resolution, hook wiring. High-touch on each install or build. Testing: `test/build-output.test.js` catches render regressions.

`hooks/readonly-guard.js` (117 lines): regex-based Bash and MCP tool call validation. High-risk: must block all writes to get investigator/orchestrator trust without enforcement. Testing: TAP tests verify every write-shaped command is blocked, allowed commands pass.

`agents/away-team.agent.md` (85 lines): orchestrator routing logic, gate conditions, handoff payloads. High-touch on bug flow. Must not improvise when a specialist is blocked; must relay reports without re-analyzing.

`agents/away-team-investigator.agent.md` (76 lines): reproduces bugs, root-causes, outputs diagnosis. Strong tier; on Claude, the most expensive agent. Context budget critical: search before reading; batched tool calls; ~25 calls → Blocked if no cause.

`agents/away-team-mapper.agent.md` (62 lines): refreshes CODEMAP, traces entry points, records modules. Must update only changed sections on refresh; must not re-read stable code.

`package.json`, `package-lock.json` (28, 27 appearances in 6-month log): frequent updates. `npm install` must work cold on web containers.

## Testing map
`test/build-output.test.js`: TAP tests (node:test). 
- Frontmatter parsing: all agents have well-formed YAML.
- YAML syntax: no parser errors, values valid.
- Quoted scalars: descriptions are quoted (required for YAML).
- Undefined values: nothing renders as undefined in agents.
- Platform-specific keys: Claude-only keys (maxTurns, etc.) not in Copilot render; Copilot-only not in Claude.
- Model IDs: all IDs in agents defined in `bin/models.js`.
- Committed output: `dist/` matches what `npm run build` generates.
- Report blocks: each specialist's expected report block present in frontmatter description.
- Read-only enforcement: read-only-guard tests (mocked tool calls) assert expected blocks on write-shaped Bash, MCP, and gh subcommands; filing (`gh issue create`) passes.

Run: `npm test` (full suite: lint, build, TAP tests). Run one test: `node --test test/build-output.test.js --grep <subtest-name-pattern>`.

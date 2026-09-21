![away-team: multi-agent orchestrator](docs/away-team.jpeg)

# away-team

An orchestrator that beams down a crew of specialist agents to fix a bug: map the codebase, find the root cause, bash the bug, open the PR. Built for GitHub Copilot (CLI and desktop app) and Claude Code (CLI and desktop app), installed user-level so it works in every repo and every language.

The point is spending fewer tokens on bug work without losing quality. Six things do that:

1. **Right model per job.** Each agent declares a tier (cheap, balanced, strong) rather than a model. Reading a repo is cheap-tier work; root-causing is the one place the strong tier pays for itself.
2. **Narrow, read-only specialists.** The investigator cannot edit and the orchestrator cannot run code, so each context window holds only what that job needs.
3. **Small reports, never retyped.** Output costs about five times input. Each specialist returns one fixed report of a few hundred tokens, or a `## Blocked` block (stage, reason, what it tried, side effects, next cheapest step, what it needs) when it cannot finish. The orchestrator shows you four lines of it, forwards it verbatim once to the one specialist that needs it, and gives you the full text only if you ask. Nothing is re-verified downstream, and nobody improvises when stuck: blocked means nothing was changed.
4. **A persistent code map.** `docs/CODEMAP.md` is written once and refreshed by diff, so agents stop re-reading the repo every session.
5. **A context budget per agent.** Batch tool calls, since every turn re-reads the agent's whole context. Search before reading, read windows not files, run one test not the suite, cap command output, skip vendored trees. On Claude Code each specialist also carries a `maxTurns` cap, so a runaway investigation returns partial output instead of burning the window. The orchestrator is the only long-lived context, so it reads almost nothing itself, holds only the latest reports, and suggests a fresh session per bug.
6. **Ponytail and caveman.** Optional companions that shrink what the agent builds and what it says.

```
agents/
  away-team.agent.md                pick this one; it routes to the others
  away-team-mapper.agent.md         writes docs/CODEMAP.md
  away-team-investigator.agent.md   read-only root cause → Diagnosis
  away-team-basher.agent.md         Diagnosis → failing test → minimal fix → commit
  away-team-pr-writer.agent.md      branch → PR (TL;DR body, breakdown in comments)
skills/
  codemap/SKILL.md        CODEMAP.md template + rules
  pr-format/SKILL.md      PR template + gh commands
bin/away-team.js          installer; also renders dist/ for the plugin marketplaces
dist/copilot, dist/claude prebuilt plugins (generated, committed)
```

## Install

**npx** (Windows, Mac, Linux; installs ponytail and caveman too):

```bash
npx @scotscottmca/away-team                          # detects Copilot / Claude Code, asks which to install to
npx @scotscottmca/away-team --target claude          # copilot | claude | all, skips that prompt
npx @scotscottmca/away-team --scope project          # into this repo: .github/ (Copilot), .claude/ (Claude Code)
npx @scotscottmca/away-team --yes                    # accept every default, no prompts
npx @scotscottmca/away-team --skip-plugins
npx @scotscottmca/away-team --level full             # ponytail + caveman default level (ultra)
npx github:scotscottmca/away-team                    # same, straight from GitHub
```

**Plugin marketplaces** (agents and skills only; ponytail and caveman are separate, see below):

```bash
copilot plugin marketplace add scotscottmca/away-team
copilot plugin install away-team@away-team

claude plugin marketplace add scotscottmca/away-team
claude plugin install away-team@away-team
```

**Per repo**: run the installer inside a git repo and pick **Project** scope (or `--scope project`). It writes the agents and skills to `.github/` for Copilot and `.claude/` for Claude Code, to commit with the code. Teammates then get them with no install, and the Copilot cloud agent on github.com can use them. Ponytail, caveman and the level setting are per user and stay with the global install. Default is Global.

What the npx install writes:

| | Copilot | Claude Code |
|---|---|---|
| agents | `~/.copilot/agents/*.agent.md` | `~/.claude/agents/*.md` |
| skills | `~/.copilot/skills/` | `~/.claude/skills/` (plus `away-team` as a skill) |
| ponytail | `copilot plugin install ponytail@ponytail` | `claude plugin install ponytail@ponytail` |
| caveman | `npx skills add JuliusBrussee/caveman -s caveman` (core skill only; caveman has no Copilot marketplace manifest) | `claude plugin install caveman@caveman` |

## Select away-team

| Platform | How |
|---|---|
| Copilot app / CLI | `/agent` → **away-team**, or `copilot --agent away-team` |
| | Both read the agent list when a chat session starts: after installing, start a new session before looking for it. |
| Claude Code CLI | `claude --agent away-team` (also finds the plugin install; `away-team:away-team` if another plugin ships an `away-team` agent too) |
| Claude Code, any project, always | `"agent": "away-team"` in that project's `.claude/settings.json` |
| Claude desktop app (no agent picker) | `/away-team <your request>` (plugin install: `/away-team:away-team`) |

Any worker can be selected directly too (`/agent` → away-team-mapper, and so on). In Claude Code the four workers are also picked up automatically by any normal session because subagents auto-delegate on description. The orchestrator never is. Its gates work by stopping to ask you, and a subagent cannot ask, so its description says not to delegate to it, its `tools` allowlist names only its four specialists, and if a session delegates to it anyway it returns `## Blocked` instead of running. To make that a rule of the harness rather than of the description, add `"permissions": { "deny": ["Agent(away-team)"] }` to `~/.claude/settings.json` (`Agent(away-team:away-team)` for the plugin install, which registers it under that scoped name). Headless runs (`claude -p --agent away-team`) still work: the orchestrator refuses only when the harness tells it that it is a subagent, not merely because print mode withholds the ask tool.

## Use

| You say | What happens |
|---|---|
| "Map this repo" | mapper → `docs/CODEMAP.md` |
| "Why does X throw on Y?" / paste a stack trace | investigator → Diagnosis, stops |
| "Fix: <bug>" | investigator → Diagnosis → (gate) → basher → Fix report |
| "…and open a PR" | pr-writer, after you confirm the push |
| "Open a PR for this branch" | pr-writer only |

Gates: the orchestrator stops and shows you the Diagnosis before any edit when confidence is not high, you only asked "why", or the fix touches auth / crypto / billing / migrations. It always asks before pushing. A specialist that is blocked or unreachable ends the pipeline with its Blocked block relayed; the orchestrator never does a specialist's work itself. The gates only exist on the main thread, so the orchestrator runs as the agent you selected and refuses to run as a subagent.

Ponytail and caveman both default to **ultra**. Change the default with `npx @scotscottmca/away-team --level lite|full|ultra` (it writes each plugin's `config.json`, and a line in `~/.copilot/copilot-instructions.md` because caveman has no hooks on Copilot). Change it for one session with `/ponytail full` (Copilot namespaces it `/ponytail:ponytail`) or `/caveman full`.

## Model tiers

Agents carry a tier, not a model. The installer resolves the tier per platform, so each platform uses the best model it has for that job. The mapping is the `MODELS` table at the top of `bin/away-team.js`; edit it for your plan, then `npm run build` to refresh `dist/`.

| Agent | Tier | Why |
|---|---|---|
| mapper | cheap | reads the most, reasons the least; long inputs, so input price dominates |
| orchestrator | balanced | classifies and relays; small context, but the gates need judgement |
| basher | balanced | a strong coder at a fraction of the top tier; the Diagnosis already did the thinking |
| pr-writer | balanced | short pass; writing quality matters more than reasoning |
| investigator | strong | root cause is where reasoning quality pays, and read-only tools keep its output small |

Defaults shipped:

| Tier | Copilot | Claude Code |
|---|---|---|
| cheap | `gpt-5.6-luna` | `haiku` |
| balanced | `claude-sonnet-5` | `sonnet` |
| strong | `claude-opus-5` | `opus` |

How the defaults were chosen: for each tier, the cheapest model on Copilot's per-token price list that is good at the tier's job. A model priced like a tier's default but older, or priced between two tiers with no distinct strength, adds nothing and is left out. Claude Code aliases resolve to the newest model of each tier automatically; if your plan exposes a stronger alias (for example `fable`), set it as `strong`.

Cheaper choices when cost bites: a code-specialised mid-price model for `balanced` on basher, and the cheap tier for pr-writer.

## Caveats

1. **Copilot CLI may downgrade a subagent's model to the session model** when the subagent's is pricier ([copilot-cli#2758](https://github.com/github/copilot-cli/issues/2758)). So the investigator only gets the strong tier if the session is on it. Run sessions on the balanced tier and `/model` up for a hard triage. Cheaper subagent models are never downgraded. Claude Code has no such downgrade.
2. **Copilot model slugs in frontmatter are undocumented.** The installer writes CLI-style slugs. Run `/model` once to see the spelling your CLI accepts and fix `MODELS` in `bin/away-team.js` if it differs.
3. Copilot's auto model selection gives a discount but ignores per-agent models; not used here.
4. **The Claude desktop skill enforces less than the agent.** `/away-team` is the orchestrator's body as a skill, for the desktop app's lack of an agent picker. A skill can carry `model` and `disallowed-tools`, and the render sets both (the balanced tier; every tool the agent's allowlist leaves out), but they apply only to the turn that invokes the skill and clear on your next message, and a skill cannot restrict which subagents the Agent tool may spawn. After that first turn, "never edits code" is prose. For the enforced form on the desktop app, set `"agent": "away-team"` in the project's `.claude/settings.json` (table above): every session in that project then runs the orchestrator with its tool list and model.
5. **Plugin install: specialist names are scoped.** Claude Code registers a plugin's agents as `<plugin>:<name>`, and a bare name does not resolve for delegation (`Agent type 'away-team-mapper' not found`, checked against a live plugin load), so `dist/claude` renders the orchestrator's routing table and Agent allowlist as `away-team:away-team-mapper` and so on. The npx install keeps bare names. `claude --agent away-team` still finds the plugin's orchestrator by its bare name.

## Why it is built this way

- **Stateless subagents.** Both platforms spin up a fresh context per delegation, so every handoff is a self-contained report (Diagnosis, Fix report), never a transcript. Same pattern as awesome-copilot's `gem-orchestrator` / `gem-debugger`.
- **Caching is the platform's job; turn count is ours.** Both platforms cache prompts automatically, per model, keyed on an exact prefix, so static agent prompts are all the pack can contribute there. What it can control is what caching does not remove: every turn re-reads the agent's whole context at about a tenth of the input price, and every specialist cold-starts at roughly twelve thousand tokens. So the levers are fewer turns (batched tool calls), smaller contexts (the budgets) and fewer cold starts (one call per step). Reports stay inline because they are a few hundred tokens: writing them to files was tried and priced, and the extra turn it costs the strong-tier investigator outweighs the retyping it saves. Anthropic's own guidance has the same shape: inline summaries of one to two thousand tokens, file references only for large outputs.
- **When not to use it.** For a one-line fix you already understand, use the default agent. The crew's fixed cost only pays off on a real investigation.
- **Investigator never edits.** Read-only tools make "diagnose, don't patch the symptom" a hard constraint. Three falsified hypotheses is the stop rule (superpowers `systematic-debugging`).
- **CODEMAP.md is the memory.** Persistent, committed, refreshed by diff against its own `commit:` header. Names not links, invariants not file lists (matklad's ARCHITECTURE.md guidance). Basher updates it when a fix moves a boundary.
- **PR body is the TL;DR.** Line-level reasoning goes in one review via the REST API (`gh pr comment` cannot do inline), narrative in one top-level comment.
- **One source, rendered per platform.** Agent bodies are identical; only `tools` aliases and `model` differ, and Claude-only keys such as `maxTurns` are dropped for Copilot. The installer rewrites those lines at install time, and `npm run build` writes the same output to `dist/` for the marketplaces, which copy files verbatim. The orchestrator's `agent(...)` entry is an allowlist of the subagents it may spawn: on Claude Code it renders to `Agent(...)`, which the harness enforces for a main-thread agent; on Copilot, which has no such syntax, it renders to a bare `agent`. The Claude plugin render also prefixes the specialist names with `away-team:`, the scoped identifier plugin agents load under. No hooks.

## Contributing

Edit `agents/` and `skills/` only; `dist/` is generated on release.

## Release

A push to `main` that touches `agents/`, `skills/`, `bin/` or `package.json` is a release. `.github/workflows/publish.yml` bumps the patch version, rebuilds `dist/`, commits, tags and publishes to npm. Doc-only pushes (README, `docs/`, LICENSE, workflow) do not release; the README ships with the next code release. Pull after a releasing push to pick up the version commit.

For a minor or major bump, run `npm version minor` (or `major`) locally and push; the workflow sees that version is not on npm yet and publishes it as is.

One-time setup: create a granular npm access token (packages: read and write, bypass 2FA) and add it as the `NPM_TOKEN` repository secret. Or configure npm trusted publishing for this repo and workflow and leave the secret unset; the workflow already grants `id-token: write`.

## Sources

- Copilot custom agents: https://docs.github.com/en/copilot/reference/custom-agents-configuration
- Copilot CLI subagents: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
- Copilot app customisation: https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app
- Copilot pricing: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code skills: https://code.claude.com/docs/en/skills
- Delegation heuristics: https://github.blog/ai-and-ml/how-we-made-github-copilot-cli-more-selective-about-delegation/
- awesome-copilot gem-orchestrator / gem-debugger: https://github.com/github/awesome-copilot/tree/main/agents
- Ponytail: https://github.com/DietrichGebert/ponytail · Caveman: https://github.com/JuliusBrussee/caveman
- PR review API: https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request

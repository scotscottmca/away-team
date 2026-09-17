# away-team

Five agents and two skills for bug work: an orchestrator that beams down a crew of specialists (mapper, investigator, basher, pr-writer) on each mission. Installed user-level so they apply to every repo and every language. One source, two targets: GitHub Copilot (CLI and desktop app) and Claude Code (CLI and desktop app).

```
agents/
  orchestrator.agent.md   pick this one; it routes to the others
  mapper.agent.md         writes docs/CODEMAP.md
  investigator.agent.md   read-only root cause → Diagnosis
  basher.agent.md         Diagnosis → failing test → minimal fix → commit
  pr-writer.agent.md      branch → PR (TL;DR body, breakdown in comments)
skills/
  codemap/SKILL.md        CODEMAP.md template + rules
  pr-format/SKILL.md      PR template + gh commands
bin/away-team.js          installer; also renders dist/ for the plugin marketplaces
dist/copilot, dist/claude prebuilt plugins (generated, committed)
```

## Install

**npx** (Windows, Mac, Linux; installs ponytail and caveman too):

```bash
npx away-team                          # Copilot + Claude Code
npx away-team --target claude          # copilot | claude | all
npx away-team --skip-plugins
npx github:scotscottmca/away-team      # same, straight from GitHub
```

**Plugin marketplaces** (agents and skills only; ponytail and caveman are separate, see below):

```bash
copilot plugin marketplace add scotscottmca/away-team && copilot plugin install away-team@away-team
claude plugin marketplace add scotscottmca/away-team && claude plugin install away-team@away-team
```

**Per repo**: copy `dist/copilot/agents` into the project's `.github/agents/` (Copilot) or `dist/claude/agents` into `.claude/agents/` (Claude Code).

What the npx install writes:

| | Copilot | Claude Code |
|---|---|---|
| agents | `~/.copilot/agents/*.agent.md` | `~/.claude/agents/*.md` |
| skills | `~/.copilot/skills/` | `~/.claude/skills/` (plus `orchestrator` as a skill) |
| ponytail | `copilot plugin install ponytail@ponytail` | `claude plugin install ponytail@ponytail` |
| caveman | `npx skills add JuliusBrussee/caveman -g -a github-copilot` (no Copilot marketplace manifest) | `claude plugin install caveman@caveman` |

## Select the orchestrator

| Platform | How |
|---|---|
| Copilot app / CLI | `/agent` → **orchestrator**, or `copilot --agent orchestrator` |
| Claude Code CLI | `claude --agent orchestrator` |
| Claude Code, any project, always | `"agent": "orchestrator"` in that project's `.claude/settings.json` |
| Claude desktop app (no agent picker) | `/orchestrator <your request>` |

In Claude Code the four workers are also picked up automatically by any normal session because subagents auto-delegate on description. The orchestrator just adds the routing rules and gates.

## Use

| You say | What happens |
|---|---|
| "Map this repo" | mapper → `docs/CODEMAP.md` |
| "Why does X throw on Y?" / paste a stack trace | investigator → Diagnosis, stops |
| "Fix: <bug>" | investigator → Diagnosis → (gate) → basher → Fix report |
| "…and open a PR" | pr-writer, after you confirm the push |
| "Open a PR for this branch" | pr-writer only |

Gates: the orchestrator stops and shows you the Diagnosis before any edit when confidence is not high, you only asked "why", or the fix touches auth / crypto / billing / migrations. It always asks before pushing.

Ponytail levels: `/ponytail lite|full|ultra` (Copilot namespaces it `/ponytail:ponytail`). Caveman: `/caveman lite|full|ultra`.

## Model tiers

Agent files carry a tier, not a model. The installer resolves it per platform, so each platform gets the best model available to it for that job. Edit `MODELS` at the top of `bin/away-team.js` to change the mapping, then `npm run build` to refresh `dist/`.

| Agent | Tier | Copilot | Claude Code | Why |
|---|---|---|---|---|
| mapper | cheap | GPT-5.6 Luna | haiku | reads the most, reasons the least |
| orchestrator | balanced | Claude Sonnet 5 | sonnet | classifies and relays; needs judgement on gates |
| basher | balanced | Claude Sonnet 5 | sonnet | strong coder at half the price of the top tier |
| pr-writer | balanced | Claude Sonnet 5 | sonnet | short pass, writing quality matters |
| investigator | strong | Claude Opus 5 | opus | root cause is where reasoning quality pays; read-only so output stays small |

Claude Code aliases (`haiku`, `sonnet`, `opus`) resolve to the newest model of that tier automatically. If your plan has Fable, set `strong = 'fable'` in the installer for the investigator.

Copilot per 1M tokens, input / output: Luna 0.20 / 1.20, Sonnet 5 2 / 10, Opus 5 5 / 25. Skipped: GPT-5.5 (5 / 30, most expensive, no advantage here), Opus 4.7 / 4.8 (same price as Opus 5, older), GPT-5.6 Sol / Terra, GPT-5.4 (mid-price, no niche). GPT-5.3-Codex (1.75 / 14) is a cheaper `balanced` for basher if cost bites.

## Caveats

1. **Copilot CLI may downgrade a subagent's model to the session model** when the subagent's is pricier ([copilot-cli#2758](https://github.com/github/copilot-cli/issues/2758)). So the investigator only gets Opus 5 if the session is on Opus 5. Run sessions on Sonnet 5 and `/model` up to Opus 5 for a hard triage. Cheaper subagent models (Luna) are never downgraded. Claude Code has no such downgrade.
2. **Copilot model slugs in frontmatter are undocumented.** The installer writes CLI-style slugs (`claude-sonnet-5`, `gpt-5.6-luna`). Run `/model` once to see the spelling your CLI accepts and fix `MODELS` in `bin/away-team.js` if it differs.
3. Copilot's auto model selection gives 10% off but ignores per-agent models; not used here.

## Why it is built this way

- **Stateless subagents.** Both platforms spin up a fresh context per delegation, so every handoff is a self-contained report (Diagnosis, Fix report), never a transcript. Same pattern as awesome-copilot's `gem-orchestrator` / `gem-debugger`.
- **Investigator never edits.** Read-only tools make "diagnose, don't patch the symptom" a hard constraint. Three falsified hypotheses is the stop rule (superpowers `systematic-debugging`).
- **CODEMAP.md is the memory.** Persistent, committed, refreshed by diff against its own `commit:` header. Names not links, invariants not file lists (matklad's ARCHITECTURE.md guidance). Basher updates it when a fix moves a boundary.
- **PR body is the TL;DR.** Line-level reasoning goes in one review via the REST API (`gh pr comment` cannot do inline), narrative in one top-level comment.
- **One source, rendered per platform.** Agent bodies are identical; only `tools` aliases and `model` differ. The installer rewrites those two lines at install time, and `npm run build` writes the same output to `dist/` for the marketplaces, which copy files verbatim. No hooks.

## Release

```bash
npm version patch && git push --follow-tags
```

`npm version` rebuilds `dist/` and includes it in the version commit, so the marketplaces always serve the tagged build. The pushed `v*` tag triggers `.github/workflows/publish.yml`, which publishes to npm.

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

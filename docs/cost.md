# Cold start, measured

What a specialist costs before it does any work, and which levers move it. Replaces the
guessed "twelve thousand tokens" and the `general-purpose` figures that followed it
([#23](https://github.com/scotscottmca/away-team/issues/23), [#13](https://github.com/scotscottmca/away-team/issues/13)).

## Method

A **cold start** is the input the model is charged for on an agent's first turn, before any
tool result comes back: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
on the first `assistant` message.

Read it from the agent's own transcript, not from the session total. Claude Code writes a
subagent's turns to `~/.claude/projects/<project>/<session-id>/subagents/<agent>.jsonl`;
the session total mixes in the orchestrator's context re-read on every turn, which is what
made earlier numbers look four to ten times larger than a specialist actually costs.

Conditions: Claude Code 2.1.278, headless `claude -p`, `claude-haiku-4-5-20251001`, Linux
container. Tool definitions dominate and do not vary by model, so the ratios travel; the
absolute floor does not. A **hosted session** (Claude Code on the web, or any harness that
injects its own system prompt) adds a preamble on top of everything below — measured at
about 30k on the main thread of the session this was written in.

Each figure below is one variable changed against an otherwise identical run.

## Results

| Measurement | Cold start | Delta |
|---|---:|---:|
| Specialist subagent, `tools: ["read", "search", "execute"]` | 6,782 | — |
| Same body, every tool inherited (`general-purpose`) | 26,181 | **+19,399** |
| Agent body itself (4.9 KB investigator, appended to a main thread) | — | +1,277 |
| Main thread, built-in tools, no `CLAUDE.md` | 35,712 | — |
| Main thread, same project, 127 KB `CLAUDE.md` | 69,633 | **+33,921** |
| Subagent, same project, 127 KB `CLAUDE.md` | 5,542 | **0** |
| Subagent, same project, no `CLAUDE.md` | 5,542 | — |
| 60 MCP tools attached | 36,341 | +660 (11/tool) |
| 60 MCP tools, descriptions padded 10x | 36,341 | **+0** |

## What moves the number

**The declared tool set, by a factor of four.** `tools: ["read", "search", "execute"]` versus
inheriting everything is 19,399 tokens on an identical body — the only large lever the pack
controls, and one every specialist already pulls. This is also why [#23](https://github.com/scotscottmca/away-team/issues/23)'s
50-90k table did not measure this pack: it ran each agent's body in a fresh `general-purpose`
subagent, which copies the prose and drops the `tools:` line that does the work.

**Not MCP exposure.** Only tool *names* reach the context, at about 11 tokens each. Padding
every description tenfold produced a byte-identical total, so schemas are fetched on demand.
Ninety servers' worth of tools costs about a thousand tokens. Giving the whole crew every
server on the machine ([#30](https://github.com/scotscottmca/away-team/issues/30)) is therefore
close to free, and `--no-mcp` is an isolation flag rather than a cost one.

**Not `CLAUDE.md`, in a specialist.** A 127 KB `CLAUDE.md` changed a subagent's cold start by
zero tokens and the main thread's by 33,921. Subagents never receive it. Claude Code's
`omitClaudeMd` frontmatter key is real (v2.1.271+) but inert for this pack in both positions:
there is nothing to omit in a specialist, and the docs state it is ignored for an agent running
as the main session agent, which is how the orchestrator runs under `--agent` or `/away-team`.
That closes [#13](https://github.com/scotscottmca/away-team/issues/13) on its own stated terms.

**Not the agent bodies.** 1,277 tokens for the longest one. Rewriting prose to save tokens is
not worth anyone's afternoon.

**`experimental.cacheTtl: 1h`** changes the price of a cache read, not the size of a context.
Real, but it belongs in a pricing argument, not this one. Here is that argument: on Copilot's
current pricing, Claude Fable 5.1 is $10 / $0.25 / $50 per M tokens (input / cached read /
output) against Claude Opus 5 at $5 / $0.50 / $25. Fable's cheaper cache reads only overtake
Opus's cheaper everything-else past roughly turn 85 of a continuously growing context; the
investigator stops at 25, so Opus 5 stays the strong-tier default. Re-check when either price
moves.

## What it means for the pipeline

Cold start still dominates the marginal cost of the work itself, so the conclusion that
survives is the same one: the cheapest call is the one not made. A specialist that returns
`## Blocked` at input pays its whole cold start to say no. Ruling out the two cheapest Blocked
causes before beaming down — a `## Diagnosis` in hand before basher, `gh` and the push folded
into the confirm gate that already asks one question — costs nothing and saves a call.

The saving is single-digit thousands per avoided call on a local install, not the tens of
thousands the previous numbers implied. Worth keeping; not worth contorting the pipeline for.

## Reproducing

```bash
# 1. A project with one probe subagent.
mkdir -p /tmp/probe/.claude/agents && cd /tmp/probe && git init -q
cat > .claude/agents/probe.md <<'EOF'
---
name: probe
description: probe
tools: Read, Glob, Grep, Bash
model: haiku
---
You are a probe. Reply with the single word ok.
EOF

# 2. Spawn it and keep the session id.
claude -p "Use the probe subagent to reply ok. Do nothing else yourself." \
  --model claude-haiku-4-5-20251001 --output-format json > run.json < /dev/null

# 3. Read the cold start off the subagent's own transcript.
python3 - <<'PY'
import json, glob, os
sid = json.load(open('run.json'))['session_id']
d = [p for p in glob.glob(os.path.expanduser('~/.claude/projects/*/') + sid) if os.path.isdir(p)]
subs = glob.glob(d[0] + '/subagents/*.jsonl')
assert len(subs) == 1, f'{len(subs)} subagent transcripts; clear stale runs first'
for line in open(subs[0]):
    u = (json.loads(line).get('message') or {}).get('usage')
    if u:
        print('cold start:', sum(u.get(k) or 0 for k in
              ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')))
        break
PY
```

Then change exactly one thing and run it again: drop the `tools:` line, add a `CLAUDE.md`,
attach an MCP server with `--strict-mcp-config --mcp-config`. Assert against one variable at a
time; a session total will not tell you which one moved.

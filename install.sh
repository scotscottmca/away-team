#!/usr/bin/env bash
# Installs the agent pack user-level so it applies to every repo.
#   ./install.sh                  # Copilot + Claude Code, plus ponytail and caveman
#   ./install.sh claude           # one platform: copilot | claude | all
#   ./install.sh all --skip-plugins
# Model tiers in agents/*.agent.md (cheap | balanced | strong) resolve per platform in render().
set -e
target="${1:-all}"; skip="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"

render() { # render <platform> < file
  awk -v p="$1" '
    BEGIN {
      m["copilot","cheap"]="gpt-5.6-luna"; m["copilot","balanced"]="claude-sonnet-5"; m["copilot","strong"]="claude-opus-5"
      m["claude","cheap"]="haiku";         m["claude","balanced"]="sonnet";          m["claude","strong"]="opus"   # strong="fable" if your plan has it
      t["agent"]="Agent"; t["read"]="Read"; t["search"]="Grep, Glob"; t["execute"]="Bash"; t["edit"]="Edit, Write"; t["todo"]="TodoWrite"; t["web"]="WebFetch, WebSearch"
    }
    /^model: / { print "model: " m[p,$2]; next }
    p=="claude" && /^tools: \[/ {
      if ($0 ~ /"\*"/) next
      gsub(/tools: \[|\]|"| /, ""); n=split($0, a, ","); out=""
      for (i=1;i<=n;i++) out = out (i>1?", ":"") t[a[i]]
      print "tools: " out; next
    }
    { print }'
}

if [ "$target" = copilot ] || [ "$target" = all ]; then
  mkdir -p ~/.copilot/agents ~/.copilot/skills
  for a in "$here"/agents/*.agent.md; do render copilot < "$a" > ~/.copilot/agents/"$(basename "$a")"; done
  cp -r "$here"/skills/* ~/.copilot/skills/
  echo "Copilot: installed to ~/.copilot"
  if [ "$skip" != --skip-plugins ]; then
    copilot plugin marketplace add DietrichGebert/ponytail
    copilot plugin install ponytail@ponytail
    npx -y skills add JuliusBrussee/caveman -g -a github-copilot
  fi
fi

if [ "$target" = claude ] || [ "$target" = all ]; then
  mkdir -p ~/.claude/agents ~/.claude/skills/orchestrator
  for a in "$here"/agents/*.agent.md; do render claude < "$a" > ~/.claude/agents/"$(basename "$a" .agent.md).md"; done
  cp -r "$here"/skills/* ~/.claude/skills/
  # Orchestrator also as a skill, so /orchestrator works in the desktop app where there is no agent picker.
  src="$here/agents/orchestrator.agent.md"
  { printf -- '---\nname: orchestrator\n%s\n---\n' "$(grep -m1 '^description:' "$src")"
    awk 'c>=2{print} /^---$/{c++}' "$src"; } > ~/.claude/skills/orchestrator/SKILL.md
  echo "Claude Code: installed to ~/.claude"
  if [ "$skip" != --skip-plugins ]; then
    claude plugin marketplace add DietrichGebert/ponytail
    claude plugin install ponytail@ponytail
    claude plugin marketplace add JuliusBrussee/caveman
    claude plugin install caveman@caveman
  fi
fi

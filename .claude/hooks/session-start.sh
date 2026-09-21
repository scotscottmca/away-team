#!/bin/bash
# SessionStart hook: make a fresh container able to run this repo's tests and its own crew.
#
# Claude Code on the web clones the repo into a new container and installs nothing into it, so
# a session starts with no node_modules (npm test fails on a missing @clack/prompts) and no
# away-team agents (/away-team is not a command, and the pack cannot be used on itself). Both
# are rebuilt here from the working tree.
set -euo pipefail

# A local machine has its own global install already; this is only for the ephemeral container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# SessionStart stdout is added to the session's context, so stay silent unless something fails.
quiet() {
  local out
  if ! out=$("$@" 2>&1); then
    printf 'session-start: %s failed\n%s\n' "$1" "$out" >&2
    return 1
  fi
}

# Dependencies. npm install rather than npm ci: the container is cached once the hook finishes,
# and install reuses whatever is already there instead of deleting it first.
quiet npm install --no-audit --no-fund

# The crew, rendered from this working tree into .claude/ (gitignored, see .gitignore).
# --scope project writes agents, skills and the read-only guard beside this hook and resolves
# hook paths through $CLAUDE_PROJECT_DIR. Rendering from source rather than committing the
# output means the crew never drifts from the agents/ it is being used to edit.
quiet node bin/away-team.js --target claude --scope project --yes --skip-plugins

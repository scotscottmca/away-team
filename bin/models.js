// Tier -> ordered priority list of platform aliases. Agents carry a tier (cheap | balanced | strong); the
// installer resolves it per platform through bin/away-team.js's resolveModel(). Claude Code takes the first row
// that names it: its frontmatter holds one model, so its runtime fallback is the alias itself (`opus` is the newest
// Opus the install supports; past that, the session model). Copilot takes every row that names it, as a runtime
// fallback list. A plan-only model (e.g. "use `fable` if your plan has it") is added by prepending a row —
// { claude: 'fable' } — rather than by hand-editing the winning model in place; a row with no key for a platform
// is skipped for that platform only. Edit this file for your plan, then `npm run build` to refresh dist/.
module.exports = {
  cheap: [{ claude: 'haiku', copilot: 'gpt-5.6-luna' }],
  balanced: [{ claude: 'sonnet', copilot: 'claude-sonnet-5' }],
  // Not `claude-opus-5-5` on Claude: a pinned id Claude Code does not know fails the subagent (Opus 5.5 needs
  // 2.1.280+) instead of falling back, while `opus` is Opus 5.5 where supported and Opus 5 before that.
  strong: [{ claude: 'opus', copilot: 'claude-opus-5.5' }, { copilot: 'claude-opus-5' }, { copilot: 'claude-sonnet-5' }],
};

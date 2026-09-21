// Tier -> ordered priority list of platform aliases. Agents carry a tier (cheap | balanced | strong); the
// installer resolves it per platform through bin/away-team.js's resolveModel(): the first row in the list that
// names the platform wins, so a plan-only model (e.g. "use `fable` if your plan has it") is added by prepending
// a row — { claude: 'fable' } — rather than by hand-editing the winning model in place. A row with no key for a
// platform is skipped for that platform only, so Copilot falls through to the next row instead of rendering
// nothing. Edit this file for your plan, then `npm run build` to refresh dist/.
module.exports = {
  cheap: [{ claude: 'haiku', copilot: 'gpt-5.6-luna' }],
  balanced: [{ claude: 'sonnet', copilot: 'claude-sonnet-5' }],
  strong: [{ claude: 'opus', copilot: 'claude-opus-5' }],
};

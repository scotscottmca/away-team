// Asserts over dist/ after `npm run build`: a render regression must fail here rather than ship to npm.
// Run by `npm test`, which builds first; publish.yml runs it before `npm publish`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// The single source of truth (issue 17): a tier -> ordered priority list of platform aliases, required rather
// than hand-duplicated here, so a drift between the build and this test (a stale or missing model id) is caught
// instead of blessed.
const MODEL_TIERS = require('../bin/models.js');
const modelIds = (platform) => [...new Set(Object.values(MODEL_TIERS).flatMap((rows) => rows.map((r) => r[platform]).filter(Boolean)))];
const MODELS = { copilot: modelIds('copilot'), claude: modelIds('claude') };
const CLAUDE_ONLY = ['maxTurns', 'disallowedTools', 'permissionMode', 'skills', 'hooks'];
// Kept in sync by hand with COPILOT_ONLY_KEYS in bin/away-team.js (issue 16): a leaked Copilot-only key into the
// Claude render is inert there but breaks Claude Code's frontmatter schema, so it must never reach dist/claude.
const COPILOT_ONLY = ['disable-model-invocation', 'modelPolicy'];
const EFFORT_LEVELS = ['low', 'medium', 'high'];
const REPORTS = {
  'away-team-mapper': '## Map report',
  'away-team-investigator': '## Diagnosis',
  'away-team-basher': '## Fix report',
  'away-team-pr-writer': '## PR report',
  'away-team-reviewer': '## Revision report',
};

const dist = (...p) => path.join(ROOT, 'dist', ...p);
const agentFiles = (platform) => fs.readdirSync(dist(platform, 'agents')).map((f) => ({
  platform, name: f.replace(/\.(agent\.)?md$/, ''), file: dist(platform, 'agents', f), text: fs.readFileSync(dist(platform, 'agents', f), 'utf8'),
}));
const all = [...agentFiles('copilot'), ...agentFiles('claude')];
// Frontmatter is the text between the first two `---` lines.
const frontmatter = (text) => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, 'no frontmatter block');
  return m[1];
};
const count = (text, heading) => text.split(/\r?\n/).filter((l) => l.trim() === heading).length;

test('every agent has a well-formed frontmatter block', () => {
  for (const a of all) {
    const fm = frontmatter(a.text);
    assert.ok(!/^\s*$/m.test(fm), `${a.platform}/${a.name}: blank line inside frontmatter`);
    assert.ok(/^name: /m.test(fm) && /^description: /m.test(fm), `${a.platform}/${a.name}: missing name or description`);
  }
});

// A frontmatter value is a YAML scalar, and an unquoted one holding ": " opens a nested mapping, which fails the
// whole block. Copilot logs `mapping values are not allowed in this context` and drops the agent from /agent with
// no other sign, so the render quotes every description and this keeps an unquoted colon-space from shipping again.
test('no frontmatter value can break the YAML parser', () => {
  const files = [...all.map((a) => ({ label: `${a.platform}/${a.name}`, text: a.text })),
    { label: 'claude/skills/away-team', text: fs.readFileSync(dist('claude', 'skills', 'away-team', 'SKILL.md'), 'utf8') }];
  for (const f of files) {
    for (const line of frontmatter(f.text).split(/\r?\n/)) {
      const m = line.match(/^([\w-]+): (.+)$/);
      if (!m) continue; // an indented block member, or a key that only opens one
      if (/^["'[]/.test(m[2])) continue; // a quoted scalar, or a flow sequence whose own items are quoted
      assert.ok(!m[2].includes(': '), `${f.label}: unquoted ${m[1]} contains ": ", which fails YAML frontmatter parsing`);
    }
  }
});

test('every rendered description is a quoted scalar', () => {
  const described = [...all, { platform: 'claude', name: 'skills/away-team', text: fs.readFileSync(dist('claude', 'skills', 'away-team', 'SKILL.md'), 'utf8') }];
  for (const a of described) {
    const d = frontmatter(a.text).match(/^description: (.*)$/m);
    assert.ok(d, `${a.platform}/${a.name}: no description`);
    assert.ok(/^".*"$/.test(d[1]), `${a.platform}/${a.name}: description is not a quoted scalar`);
  }
});

test('nothing renders as undefined', () => {
  for (const a of all) assert.ok(!a.text.includes('undefined'), `${a.platform}/${a.name}: contains "undefined"`);
  for (const f of ['skills/away-team/SKILL.md']) {
    assert.ok(!fs.readFileSync(dist('claude', f), 'utf8').includes('undefined'), `claude/${f}: contains "undefined"`);
  }
});

test('no Claude-only key reaches the Copilot render', () => {
  for (const a of agentFiles('copilot')) {
    const fm = frontmatter(a.text);
    for (const k of CLAUDE_ONLY) assert.ok(!new RegExp(`^${k}:`, 'm').test(fm), `copilot/${a.name}: Claude-only key ${k}`);
    assert.ok(!fm.includes('${AWAY_TEAM_ROOT}'), `copilot/${a.name}: unsubstituted root placeholder`);
  }
});

// Unlike Claude Code, Copilot's agent tool does not resolve a plugin-scoped delegation target (checked live: a
// marketplace install's orchestrator beaming down "away-team:away-team-basher" got "isn't registered in this
// harness" and fell back to a generic agent), so the Copilot plugin's routing table keeps bare names, same as its
// npx install. hooks/ is Claude Code only: the guard is copied nowhere else, so a hooks.json here would name a
// file the Copilot plugin does not ship.
test('the Copilot plugin render keeps bare specialist names and ships no hooks', () => {
  assert.ok(!fs.existsSync(dist('copilot', 'hooks')), 'copilot: hooks/ shipped, but the guard is Claude Code only');
  const specialists = ['away-team-basher', 'away-team-investigator', 'away-team-mapper', 'away-team-pr-writer', 'away-team-reviewer'];
  for (const a of agentFiles('copilot')) {
    const body = a.text.split(/\r?\n/).filter((l) => !l.startsWith('name:')).join('\n');
    for (const s of specialists) {
      assert.ok(!new RegExp(`away-team:${s}\\b`).test(body),
        `copilot/${a.name}: scoped reference to away-team:${s}; Copilot's agent tool does not resolve that`);
    }
  }
});

test('the Copilot render names the CLI search tools', () => {
  // Copilot CLI did not map the `search` alias to anything (checked live), so every agent that searches must also
  // name grep and glob, or it searches through bash only.
  for (const a of agentFiles('copilot')) {
    const m = frontmatter(a.text).match(/^tools: \[(.*)\]$/m);
    if (!m?.[1].includes('"search"')) continue;
    assert.ok(m[1].includes('"grep"') && m[1].includes('"glob"'), `copilot/${a.name}: search without grep and glob`);
  }
});

test('the Copilot render expands every alias that has a differently-named CLI tool', () => {
  // One live tool list is evidence that a tool exists, never that it does not: `web_search` was absent from the first
  // list taken and present in the second, and `web` had already been dropped on the strength of the first. So an alias
  // with a known real name must carry it, and must not be silently dropped instead.
  for (const a of agentFiles('copilot')) {
    const m = frontmatter(a.text).match(/^tools: \[(.*)\]$/m);
    if (m?.[1].includes('"web"')) assert.ok(m[1].includes('"web_search"'), `copilot/${a.name}: web without web_search`);
  }
});

test('the Copilot render names the CLI write tools', () => {
  // The bare `edit` alias is not a Copilot tool name, and Copilot drops a name it does not recognise without saying so,
  // which left the mapper and the basher with no way to write a file and no error to report. Every agent that edits must
  // also name the real write tools, the same belt-and-braces the `search` alias needed.
  for (const a of agentFiles('copilot')) {
    const m = frontmatter(a.text).match(/^tools: \[(.*)\]$/m);
    if (!m?.[1].includes('"edit"')) continue;
    for (const t of ['"create"']) {
      assert.ok(m[1].includes(t), `copilot/${a.name}: edit without ${t}`);
    }
  }
});

test('every allowlisted agent can reach the Azure DevOps MCP server by default', () => {
  // @azure-devops/mcp registers as `ado` (Copilot CLI guide) or `azure-devops` (Claude Code guide); both are in.
  for (const a of all) {
    const m = frontmatter(a.text).match(/^tools: (.*)$/m);
    if (!m) continue;
    const want = a.platform === 'claude' ? ['mcp__ado__*', 'mcp__azure-devops__*'] : ['"ado/*"', '"azure-devops/*"'];
    for (const w of want) assert.ok(m[1].includes(w), `${a.platform}/${a.name}: tools lack ${w}`);
  }
});

test('every allowlisted agent can reach the GitHub MCP server by default', () => {
  // The GitHub MCP server is what a hosted/remote session injects in place of a `gh` binary (issue 14): a server
  // that cannot be discovered but is the house default, same rationale as ado/azure-devops above.
  for (const a of all) {
    const m = frontmatter(a.text).match(/^tools: (.*)$/m);
    if (!m) continue;
    const want = a.platform === 'claude' ? 'mcp__github__*' : '"github/*"';
    assert.ok(m[1].includes(want), `${a.platform}/${a.name}: tools lack ${want}`);
  }
});

test('pr-writer prefers the GitHub MCP path but keeps the gh fallback', () => {
  // Issue 14: `gh` is unavailable in hosted/remote sessions. pr-writer must try MCP first and fall back to `gh`,
  // never gate on `gh` alone — a bare "no gh -> Blocked" sentence would kill the step before MCP gets a chance.
  for (const a of all.filter((x) => x.name.replace(/^away-team:/, '') === 'away-team-pr-writer')) {
    const mcpRef = a.platform === 'claude' ? 'mcp__github__' : 'github/';
    assert.ok(a.text.includes(mcpRef), `${a.platform}/${a.name}: no GitHub MCP reference`);
    assert.ok(a.text.includes('gh pr create'), `${a.platform}/${a.name}: lost the gh fallback`);
    assert.ok(!/No `?gh`?,? ?not authenticated/i.test(a.text), `${a.platform}/${a.name}: still gates preflight on gh alone`);
  }
});

test('every model is a real model for its platform', () => {
  for (const a of all) {
    const m = frontmatter(a.text).match(/^model: (.*)$/m);
    assert.ok(m, `${a.platform}/${a.name}: no model`);
    assert.ok(MODELS[a.platform].includes(m[1]), `${a.platform}/${a.name}: model "${m[1]}" is not in the ${a.platform} tier table`);
  }
});

test('reasoning effort renders per platform, and only where the agent sets it', () => {
  // issue 18: one source key (`effort:`) resolved per platform in render(), like `model:` — `effort:` on Claude
  // Code, `reasoningEffort:` on Copilot. mapper/pr-writer/basher/reviewer set it; investigator/orchestrator inherit the
  // session's effort and must carry neither key on either platform.
  const EFFORT = { 'away-team-mapper': 'low', 'away-team-pr-writer': 'low', 'away-team-basher': 'medium', 'away-team-reviewer': 'medium' };
  for (const a of all) {
    const name = a.name.replace(/^away-team:/, '');
    const fm = frontmatter(a.text);
    const expected = EFFORT[name];
    if (a.platform === 'claude') {
      assert.ok(!/^reasoningEffort:/m.test(fm), `claude/${a.name}: Copilot-only reasoningEffort key`);
      const m = fm.match(/^effort: (.*)$/m);
      if (expected) {
        assert.ok(m, `claude/${a.name}: expected effort: ${expected}`);
        assert.strictEqual(m[1], expected, `claude/${a.name}: effort is "${m[1]}", expected "${expected}"`);
        assert.ok(EFFORT_LEVELS.includes(m[1]), `claude/${a.name}: effort "${m[1]}" is not in ${EFFORT_LEVELS.join(', ')}`);
      } else {
        assert.ok(!m, `claude/${a.name}: unexpected effort key, should inherit the session's`);
      }
    } else {
      assert.ok(!/^effort:/m.test(fm), `copilot/${a.name}: bare effort key, expected reasoningEffort`);
      const m = fm.match(/^reasoningEffort: (.*)$/m);
      if (expected) {
        assert.ok(m, `copilot/${a.name}: expected reasoningEffort: ${expected}`);
        assert.strictEqual(m[1], expected, `copilot/${a.name}: reasoningEffort is "${m[1]}", expected "${expected}"`);
        assert.ok(EFFORT_LEVELS.includes(m[1]), `copilot/${a.name}: reasoningEffort "${m[1]}" is not in ${EFFORT_LEVELS.join(', ')}`);
      } else {
        assert.ok(!m, `copilot/${a.name}: unexpected reasoningEffort key, should inherit the session's`);
      }
    }
  }
});

test('the Claude render carries no Copilot-only key and no bare placeholder', () => {
  for (const a of agentFiles('claude')) {
    const fm = frontmatter(a.text);
    for (const k of COPILOT_ONLY) assert.ok(!new RegExp(`^${k}:`, 'm').test(fm), `claude/${a.name}: Copilot-only key ${k}`);
    assert.ok(!a.text.includes('${AWAY_TEAM_ROOT}'), `claude/${a.name}: unsubstituted root placeholder`);
  }
});

test('only the investigator declares modelPolicy: "required", and only on Copilot', () => {
  // issue 16: a declared model the plan cannot honour falls back to the session's model silently unless the agent
  // sets modelPolicy: "required", which refuses dispatch instead. Only the investigator's reasoning tier is
  // load-bearing enough to ask for that.
  for (const a of agentFiles('copilot')) {
    const fm = frontmatter(a.text);
    if (a.name === 'away-team-investigator') {
      assert.match(fm, /^modelPolicy: "required"$/m, `copilot/${a.name}: missing modelPolicy: "required"`);
    } else {
      assert.ok(!/^modelPolicy:/m.test(fm), `copilot/${a.name}: unexpected modelPolicy key`);
    }
  }
});

test('each specialist has exactly one report block and exactly one Blocked block', () => {
  for (const a of all) {
    const heading = REPORTS[a.name.replace(/^away-team:/, '')];
    if (!heading) continue; // the orchestrator relays, it does not produce a report
    assert.strictEqual(count(a.text, heading), 1, `${a.platform}/${a.name}: expected one "${heading}"`);
    assert.strictEqual(count(a.text, '## Blocked'), 1, `${a.platform}/${a.name}: expected one "## Blocked"`);
  }
});

test('the Claude desktop skill body is the orchestrator body', () => {
  const skill = fs.readFileSync(dist('claude', 'skills', 'away-team', 'SKILL.md'), 'utf8');
  const agent = fs.readFileSync(dist('claude', 'agents', 'away-team.md'), 'utf8');
  assert.strictEqual(skill.split(/^---\r?\n/m)[2].trim(), agent.split(/^---\r?\n/m)[2].trim());
});

test('the plugin wires the read-only guard from hooks.json, and the guard blocks writes', () => {
  const guard = dist('claude', 'hooks', 'readonly-guard.js');
  assert.ok(fs.existsSync(guard), 'dist/claude/hooks/readonly-guard.js is missing');
  // Claude Code ignores frontmatter hooks on plugin agents (it logs a warning and runs nothing), so the plugin must
  // not carry them; it registers the guard from hooks/hooks.json, scoped to the investigator and the orchestrator
  // (which also carries read-only Bash now) by agent name.
  const fm = frontmatter(fs.readFileSync(dist('claude', 'agents', 'away-team-investigator.md'), 'utf8'));
  assert.ok(!/^hooks:/m.test(fm), 'plugin investigator carries frontmatter hooks, which Claude Code ignores on plugin agents');
  assert.ok(/^disallowedTools: .*\bEdit\b/m.test(fm), 'plugin investigator does not disallow Edit');
  const orchestratorFm = frontmatter(fs.readFileSync(dist('claude', 'agents', 'away-team.md'), 'utf8'));
  assert.ok(!/^hooks:/m.test(orchestratorFm), 'plugin orchestrator carries frontmatter hooks, which Claude Code ignores on plugin agents');
  assert.match(orchestratorFm.match(/^tools: (.*)$/m)[1], /\bBash\b/, 'plugin orchestrator tools do not include Bash');
  const skill = fs.readFileSync(dist('claude', 'skills', 'away-team', 'SKILL.md'), 'utf8');
  // A skill's disallowed-tools reaches the subagents its turn spawns (checked live: the mapper could not write a file),
  // so the skill must not remove anything a specialist needs. Bash, Edit and Write are the ones that disarmed the crew.
  const skillDisallowed = skill.match(/^disallowed-tools: (.*)$/m)[1].split(', ');
  for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'TodoWrite']) {
    assert.ok(!skillDisallowed.includes(t), `desktop skill disallows ${t}, which a specialist it spawns needs`);
  }
  const hooks = JSON.parse(fs.readFileSync(dist('claude', 'hooks', 'hooks.json'), 'utf8')).hooks;
  // The guard inspects Bash and every MCP tool: the crew now carries every MCP server the machine has.
  const entry = hooks.PreToolUse.find((h) => /\bBash\b/.test(h.matcher));
  assert.match(entry.matcher, /mcp__/, 'guard matcher does not cover MCP tools');
  const cmd = entry.hooks[0].command;
  assert.strictEqual(cmd, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/readonly-guard.js" --agent away-team-investigator --agent away-team');
  const probe = (command, args = [], extra = {}) => {
    try { execFileSync('node', [guard, ...args], { input: JSON.stringify({ tool_input: { command }, ...extra }) }); return 0; }
    catch (e) { return e.status; }
  };
  const probeTool = (tool_name) => probe('', [], { tool_name });
  for (const c of ['npm test', 'git log -S x', 'cat a.js > /tmp/b', 'git status', 'git log --oneline -5',
    'gh pr view 1', 'gh issue list']) {
    assert.strictEqual(probe(c), 0, `guard blocked "${c}"`);
  }
  for (const c of ['echo x > src/a.js', "sed -i 's/a/b/' a.js", 'git commit -am x']) assert.strictEqual(probe(c), 2, `guard allowed "${c}"`);
  // Session-wide from hooks.json, the guard must bite when either guarded agent (bare or plugin-scoped) is running.
  const scoped = ['--agent', 'away-team-investigator', '--agent', 'away-team'];
  for (const t of ['away-team-investigator', 'away-team:away-team-investigator', 'away-team', 'away-team:away-team']) {
    assert.strictEqual(probe('echo x > src/a.js', scoped, { agent_type: t }), 2, `scoped guard allowed agent_type ${t}`);
  }
  for (const t of ['away-team:away-team-basher', 'away-team-basher', undefined]) {
    assert.strictEqual(probe('echo x > src/a.js', scoped, { agent_type: t }), 0, `scoped guard blocked agent_type ${t}`);
  }
  // Reading through any MCP server is evidence; changing anything through one is the basher's job. Both spellings:
  // mcp__<server>__<tool> on Claude Code, <server>/<tool> on Copilot.
  for (const t of ['mcp__ado__wit_get_work_item', 'mcp__ado__wit_list_backlogs', 'mcp__github__get_pull_request_comments',
    'mcp__jira__searchIssues', 'ado/wit_get_work_item']) {
    assert.strictEqual(probeTool(t), 0, `guard blocked the read-only MCP tool ${t}`);
  }
  for (const t of ['mcp__ado__wit_update_work_item', 'mcp__ado__repo_update_pull_request', 'mcp__github__add_issue_comment',
    'mcp__jira__deleteIssue', 'mcp__x__createOrUpdateFile', 'ado/repo_update_pull_request']) {
    assert.strictEqual(probeTool(t), 2, `guard allowed the write-shaped MCP tool ${t}`);
  }
  // Filing an issue or a work item is the one write a guarded agent may make, so a finding it is not here to fix
  // reaches the tracker. Creating one only: commenting on, closing and editing one stay denied.
  for (const c of ['gh issue create --title x --body-file /tmp/x.md', 'gh issue create -t x -b y']) {
    assert.strictEqual(probe(c), 0, `guard blocked "${c}"`);
  }
  for (const c of ['gh issue close 5', 'gh issue comment 5 -b x', 'gh issue edit 5 -t x', 'gh pr create -t x']) {
    assert.strictEqual(probe(c), 2, `guard allowed "${c}"`);
  }
  for (const t of ['mcp__github__create_issue', 'mcp__jira__createIssue', 'github/create_issue',
    'mcp__ado__wit_create_work_item', 'ado/wit_create_work_item']) {
    assert.strictEqual(probeTool(t), 0, `guard blocked the issue-filing MCP tool ${t}`);
  }
  // The name must end at the create: a comment on a new work item is still a comment.
  for (const t of ['mcp__ado__wit_create_work_item_comment', 'mcp__ado__wit_add_work_item_comment']) {
    assert.strictEqual(probeTool(t), 2, `guard allowed the write-shaped MCP tool ${t}`);
  }
  // A multi-method tool is allowed only on the method that files.
  const method = (m) => probe('', [], { tool_name: 'mcp__github__issue_write', tool_input: { method: m } });
  assert.strictEqual(method('create'), 0, 'guard blocked issue_write create');
  assert.strictEqual(method('update'), 2, 'guard allowed issue_write update');
});

test('an install gives the whole crew every MCP server the machine has', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-discover-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  // Both shapes Claude Code stores servers in: user scope at the top level, local scope under the project.
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { 'jira-user': { type: 'stdio', command: 'echo', args: ['hi'] } },
    projects: { '/somewhere': { mcpServers: { 'pg-local': { type: 'stdio', command: 'echo', args: ['hi'] } } } },
  }));
  const install = (extra = []) => execFileSync('node', [path.join(ROOT, 'bin', 'away-team.js'),
    '--yes', '--target', 'all', '--scope', 'global', '--skip-plugins', ...extra],
    { cwd: tmp, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });

  install();
  const agentsOf = (t, _ext) => fs.readdirSync(path.join(home, t, 'agents'))
    .map((f) => ({ name: f, tools: (fs.readFileSync(path.join(home, t, 'agents', f), 'utf8').match(/^tools: (.*)$/m) || [])[1] }));
  for (const { name, tools } of agentsOf('.claude')) {
    assert.ok(tools, `claude/${name} has no tools line, so it inherits every tool`);
    for (const w of ['mcp__jira-user__*', 'mcp__pg-local__*']) assert.ok(tools.includes(w), `claude/${name} lacks ${w}`);
  }
  for (const { name, tools } of agentsOf('.copilot')) {
    assert.ok(tools && tools !== '["*"]', `copilot/${name} inherits every tool`);
    for (const w of ['"jira-user/*"', '"pg-local/*"']) assert.ok(tools.includes(w), `copilot/${name} lacks ${w}`);
  }

  install(['--no-mcp']);
  const off = fs.readFileSync(path.join(home, '.claude', 'agents', 'away-team-investigator.md'), 'utf8');
  assert.ok(!/mcp__/.test(off.match(/^tools: (.*)$/m)[1]), '--no-mcp still granted MCP servers');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a build never bakes in the building machine\'s MCP servers', () => {
  // dist/ is committed and shared with everyone who installs the plugin, so it carries the defaults and nothing local.
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-buildhome-'));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { 'local-only-server': { type: 'stdio', command: 'echo', args: ['hi'] } } }));
  execFileSync('node', [path.join(ROOT, 'bin', 'away-team.js'), '--build'],
    { cwd: ROOT, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });
  for (const a of [...agentFiles('copilot'), ...agentFiles('claude')]) {
    assert.ok(!a.text.includes('local-only-server'), `${a.platform}/${a.name}: dist carries a local MCP server`);
  }
  // Same bytes as a clean build, which is the check the release workflow relies on.
  const status = execFileSync('git', ['status', '--porcelain', '--', 'dist'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(status, '', `a build with local MCP config changed dist/:\n${status}`);
  fs.rmSync(home, { recursive: true, force: true });
});

test('dist matches a fresh build', () => {
  const status = execFileSync('git', ['status', '--porcelain', '--', 'dist'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(status, '', `dist/ differs from what is committed:\n${status}\nRun "npm run build" and commit dist/.`);
});

test('an install writes a hook path that resolves on the target machine', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-'));
  const home = path.join(tmp, 'home');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const install = (args, cwd) =>
    execFileSync('node', [path.join(ROOT, 'bin', 'away-team.js'), '--yes', '--target', 'claude', '--skip-plugins', ...args],
      { cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });

  install(['--scope', 'project'], repo);
  const project = fs.readFileSync(path.join(repo, '.claude', 'agents', 'away-team-investigator.md'), 'utf8');
  // A project install is committed and shared, so the path must resolve at runtime on any checkout.
  assert.match(project, /command: 'node "\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/readonly-guard\.js"'/);
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'hooks', 'readonly-guard.js')), 'project install ships no guard');
  // Frontmatter hooks are honoured on .claude/agents and ~/.claude/agents; only the plugin needs hooks.json.
  assert.ok(!fs.existsSync(path.join(repo, '.claude', 'hooks', 'hooks.json')), 'project install ships the plugin-only hooks.json');

  install(['--scope', 'global'], tmp);
  const global = fs.readFileSync(path.join(home, '.claude', 'agents', 'away-team-investigator.md'), 'utf8');
  assert.ok(global.includes(`command: 'node "${path.join(home, '.claude')}/hooks/readonly-guard.js"'`),
    `global install hook path is not absolute:\n${global.match(/command: .*/)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('--mcp spells the server the way each platform reads it', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-mcp-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  execFileSync('node', [path.join(ROOT, 'bin', 'away-team.js'), '--yes', '--target', 'all', '--scope', 'global', '--skip-plugins',
    '--mcp', 'azure-devops,mcp__github__get_issue'], { cwd: tmp, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });
  const tools = (p) => fs.readFileSync(p, 'utf8').match(/^tools: (.*)$/m)[1];
  // Claude Code subagents: mcp__<server>__* for a server, a full tool name passes through.
  assert.strictEqual(tools(path.join(home, '.claude', 'agents', 'away-team-investigator.md')),
    'Read, Grep, Glob, Bash, mcp__ado__*, mcp__azure-devops__*, mcp__github__*, mcp__github-mcp-server__*, mcp__github__get_issue');
  // Copilot custom agents: <server>/* for a server, <server>/<tool> for one tool. Checked live on Copilot CLI: the bare
  // name put no tool from the server in the investigator's list; <server>/* put them all in.
  assert.strictEqual(tools(path.join(home, '.copilot', 'agents', 'away-team-investigator.agent.md')),
    '["read", "search", "grep", "glob", "execute", "ado/*", "azure-devops/*", "github/*", "github-mcp-server/*", "github/get_issue"]');
  // Basher carries an allowlist like everyone else now (#21), so it gets the entries too, in Copilot's spelling.
  assert.strictEqual(tools(path.join(home, '.copilot', 'agents', 'away-team-basher.agent.md')),
    '["read", "search", "grep", "glob", "execute", "edit", "create", "ado/*", "azure-devops/*", "github/*", "github-mcp-server/*", "github/get_issue"]');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('no agent inherits the full tool set, and only the orchestrator can spawn one', () => {
  // A `tools: ["*"]` renders to no tools line on Claude Code, which grants Agent, WebFetch, WebSearch and the rest;
  // on Copilot it grants `task`, whose subagents nest six deep by default. Nobody gets that (#21).
  for (const a of all) {
    const tools = (frontmatter(a.text).match(/^tools: (.*)$/m) || [])[1];
    assert.ok(tools, `${a.platform}/${a.name}: no tools line, so it inherits every tool`);
    assert.notStrictEqual(tools, '["*"]', `${a.platform}/${a.name}: declares every tool`);
    if (a.name.replace(/^away-team:/, '') === 'away-team') {
      // The orchestrator spawns, but only the four specialists it names.
      if (a.platform === 'claude') assert.match(tools, /\bAgent\(/, 'orchestrator lost its scoped Agent allowlist');
      continue;
    }
    for (const forbidden of [/\bAgent\b/, /\bWebFetch\b/, /\bWebSearch\b/, /"agent"/, /"task"/, /"web"/]) {
      assert.ok(!forbidden.test(tools), `${a.platform}/${a.name}: tools grant ${forbidden} — only the orchestrator may`);
    }
  }
});

test('each specialist names its own turn cap, so the prose cannot drift from the frontmatter', () => {
  // The soft stop rules ("~25 tool calls", "three fixes") only work if the body quotes the real ceiling (#11).
  for (const a of agentFiles('claude')) {
    const cap = (frontmatter(a.text).match(/^maxTurns: (\d+)$/m) || [])[1];
    if (!cap) continue; // the orchestrator is the main thread and carries no cap
    assert.ok(a.text.includes(`${cap} turns`),
      `claude/${a.name}: maxTurns is ${cap} but the body never says "${cap} turns"`);
  }
});

// --- Gates around the build itself, rather than its output. ---

// Runs a build from a throwaway copy of the repo, so a deliberately broken agent never touches the real
// tree. `--build` exits before the installer requires @clack/prompts, so the copy needs no node_modules.
const buildCopy = (mutate) => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-build-'));
  for (const d of ['bin', 'agents', 'skills', 'hooks']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  mutate(tmp);
  try {
    execFileSync('node', [path.join(tmp, 'bin', 'away-team.js'), '--build'], { cwd: tmp, stdio: 'pipe' });
    return { code: 0, output: '' };
  } catch (e) {
    return { code: e.status, output: `${e.stderr}${e.stdout}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
// Swaps one exact string in one agent, asserting the fixture still matches so a reworded agent fails
// here with "fixture drift" rather than silently testing nothing.
const breakAgent = (file, from, to) => (tmp) => {
  const p = path.join(tmp, 'agents', file);
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(text.includes(from), `fixture drift: "${from}" is no longer in ${file}`);
  fs.writeFileSync(p, text.replace(from, to));
};
// Same swap-and-assert, over bin/models.js instead of an agent file.
const breakModels = (from, to) => (tmp) => {
  const p = path.join(tmp, 'bin', 'models.js');
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(text.includes(from), `fixture drift: "${from}" is no longer in bin/models.js`);
  fs.writeFileSync(p, text.replace(from, to));
};

test('the build rejects bad input instead of rendering it', () => {
  // Sanity first: an unmutated copy builds, so a failure below is the mutation and not the harness.
  assert.strictEqual(buildCopy(() => {}).code, 0, 'an unmutated copy of the repo failed to build');

  const INV = 'away-team-investigator.agent.md';
  const TOOLS = '"read", "search", "execute"';
  for (const [name, mutate, expected] of [
    ['unknown model tier', breakAgent(INV, 'model: strong', 'model: bogus'), /unknown model tier "bogus"/],
    ['unknown effort level', breakAgent('away-team-basher.agent.md', 'effort: medium', 'effort: bogus'), /unknown effort level "bogus"/],
    ['unknown tool alias', breakAgent(INV, TOOLS, '"read", "telepathy", "execute"'), /unknown tool alias "telepathy"/],
    ['malformed tools entry', breakAgent(INV, TOOLS, '"read(", "execute"'), /bad tools entry "read\("/],
    // issue 17: a tier whose rows have no alias for a platform must fail the build loudly, not render "model: undefined".
    ['model tier missing a platform alias', breakModels("strong: [{ claude: 'opus', copilot: 'claude-opus-5' }]", "strong: [{ claude: 'opus' }]"),
      /model tier "strong" has no copilot alias/],
  ]) {
    const { code, output } = buildCopy(mutate);
    assert.notStrictEqual(code, 0, `${name}: the build succeeded instead of failing`);
    assert.match(output, expected, `${name}: the build failed without naming the cause`);
  }
});

test('models.js is an ordered priority list: the first row aliased for a platform wins, others fall through', () => {
  // issue 17: prepending a row (a plan-only model like `fable`) must change the rendered model without touching
  // the winning row, and a row missing one platform's key must be skipped for that platform only.
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-models-'));
  for (const d of ['bin', 'agents', 'skills', 'hooks']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  breakModels("strong: [{ claude: 'opus', copilot: 'claude-opus-5' }]",
    "strong: [{ claude: 'fable' }, { claude: 'opus', copilot: 'claude-opus-5' }]")(tmp);
  execFileSync('node', [path.join(tmp, 'bin', 'away-team.js'), '--build'], { cwd: tmp, stdio: 'pipe' });
  const claudeAgent = fs.readFileSync(path.join(tmp, 'dist', 'claude', 'agents', 'away-team-investigator.md'), 'utf8');
  assert.match(claudeAgent, /^model: fable$/m, 'the prepended row did not win priority on Claude');
  const copilotAgent = fs.readFileSync(path.join(tmp, 'dist', 'copilot', 'agents', 'away-team-investigator.agent.md'), 'utf8');
  assert.match(copilotAgent, /^model: claude-opus-5$/m, 'a row with no copilot key was not skipped for copilot only');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the web session hook parses, stays silent off the remote, and is wired to a real file', () => {
  const hook = path.join(ROOT, '.claude', 'hooks', 'session-start.sh');
  assert.ok(fs.existsSync(hook), '.claude/hooks/session-start.sh is missing');
  assert.ok(fs.statSync(hook).mode & 0o111, 'session-start.sh is not executable, so the hook never runs');
  // Parse without executing: a syntax error here breaks every web session, and nothing else would catch it.
  execFileSync('bash', ['-n', hook], { stdio: 'pipe' });
  // Off the remote it must do nothing: a local machine has its own global install.
  assert.strictEqual(execFileSync('bash', [hook], { encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, CLAUDE_CODE_REMOTE: '' } }), '', 'the hook is not a no-op outside a remote session');

  // That early exit is trivially silent, so drive the real path too. Stubs on PATH shout on both streams:
  // anything the script does not route through its quiet() helper lands in the session's context, and a
  // failure must still surface rather than being swallowed with it.
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-hook-'));
  const stubs = path.join(tmp, 'stubs');
  fs.mkdirSync(stubs);
  // Per command, so each step is covered on its own: a stub that fails first would otherwise mask the ones after it.
  const stub = (codes) => {
    for (const [name, exit] of Object.entries(codes)) {
      const f = path.join(stubs, name);
      fs.writeFileSync(f, `#!/bin/sh\necho "stdout noise"\necho "stderr noise" >&2\nexit ${exit}\n`);
      fs.chmodSync(f, 0o755);
    }
  };
  const runHook = () => execFileSync('bash', [hook], { encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: tmp, PATH: `${stubs}:${process.env.PATH}` } });

  stub({ npm: 0, node: 0 });
  assert.strictEqual(runHook(), '', 'the hook leaks command output into the session context');

  // Every step must surface its own failure, not just the first one to run.
  for (const codes of [{ npm: 1, node: 0 }, { npm: 0, node: 1 }]) {
    stub(codes);
    assert.throws(runHook, (e) => e.status !== 0 && /failed/.test(`${e.stderr}`),
      `the hook swallows a failing step (${JSON.stringify(codes)})`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /^\$CLAUDE_PROJECT_DIR\//, 'the hook command is not rooted in $CLAUDE_PROJECT_DIR');
  assert.ok(fs.existsSync(path.join(ROOT, cmd.replace('$CLAUDE_PROJECT_DIR/', ''))),
    `.claude/settings.json points at a file that does not exist: ${cmd}`);
});

test('a failed build leaves the previous render untouched', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'away-team-atomic-'));
  for (const d of ['bin', 'agents', 'skills', 'hooks']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  const build = () => {
    try { execFileSync('node', [path.join(tmp, 'bin', 'away-team.js'), '--build'], { cwd: tmp, stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  };
  assert.strictEqual(build(), 0, 'the first build of an unmutated copy failed');

  const snapshot = () => {
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else out[path.relative(tmp, f)] = fs.readFileSync(f, 'utf8');
      }
    };
    walk(path.join(tmp, 'dist'));
    return out;
  };
  const before = snapshot();

  // Change an agent that renders early so a successful build WOULD alter dist/, then break a later one so it cannot
  // finish. Agents render in directory order, so basher is written well before the investigator throws.
  const edit = (file, from, to) => {
    const p = path.join(tmp, 'agents', file);
    const text = fs.readFileSync(p, 'utf8');
    assert.ok(text.includes(from), `fixture drift: "${from}" is no longer in ${file}`);
    fs.writeFileSync(p, text.replace(from, to));
  };
  edit('away-team-basher.agent.md', 'description: Fixes a bug', 'description: SENTINEL Fixes a bug');
  edit('away-team-investigator.agent.md', 'model: strong', 'model: bogus');

  assert.notStrictEqual(build(), 0, 'the build succeeded with a bogus model tier');
  assert.deepStrictEqual(snapshot(), before, 'a failed build left dist/ partly rewritten');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('both marketplace manifests point at a render that exists', () => {
  // Hand-maintained, user-facing, and the only thing standing between `plugin marketplace add` and a 404.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [file, platform] of [['.claude-plugin/marketplace.json', 'claude'], ['.github/plugin/marketplace.json', 'copilot']]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    assert.strictEqual(manifest.plugins.length, 1, `${file}: expected exactly one plugin entry`);
    const entry = manifest.plugins[0];
    assert.strictEqual(entry.source, `./dist/${platform}`, `${file}: source is ${entry.source}, not ./dist/${platform}`);
    for (const sub of ['agents', 'skills']) {
      const dir = path.join(ROOT, 'dist', platform, sub);
      assert.ok(fs.existsSync(dir), `${file}: ${entry.source}/${sub} does not exist`);
      assert.ok(fs.readdirSync(dir).length, `${file}: ${entry.source}/${sub} is empty`);
    }
    for (const key of ['name', 'description']) assert.ok(entry[key], `${file}: plugin entry has no ${key}`);
  }
  // The two plugin manifests are generated, so a mismatch here means the build drifted from package.json.
  for (const f of ['claude/.claude-plugin/plugin.json', 'copilot/plugin.json']) {
    const meta = JSON.parse(fs.readFileSync(dist(f), 'utf8'));
    assert.strictEqual(meta.version, pkg.version, `dist/${f}: version ${meta.version} is not package.json's ${pkg.version}`);
  }
});

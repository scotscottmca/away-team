// Asserts over dist/ after `npm run build`: a render regression must fail here rather than ship to npm.
// Run by `npm test`, which builds first; publish.yml runs it before `npm publish`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODELS = {
  copilot: ['gpt-5.6-luna', 'claude-sonnet-5', 'claude-opus-5'],
  claude: ['haiku', 'sonnet', 'opus', 'fable'],
};
const CLAUDE_ONLY = ['maxTurns', 'disallowedTools', 'permissionMode', 'skills', 'hooks'];
const REPORTS = {
  'away-team-mapper': '## Map report',
  'away-team-investigator': '## Diagnosis',
  'away-team-basher': '## Fix report',
  'away-team-pr-writer': '## PR report',
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

test('every model is a real model for its platform', () => {
  for (const a of all) {
    const m = frontmatter(a.text).match(/^model: (.*)$/m);
    assert.ok(m, `${a.platform}/${a.name}: no model`);
    assert.ok(MODELS[a.platform].includes(m[1]), `${a.platform}/${a.name}: model "${m[1]}" is not in the ${a.platform} tier table`);
  }
});

test('the Claude render carries no Copilot-only key and no bare placeholder', () => {
  for (const a of agentFiles('claude')) {
    assert.ok(!/^disable-model-invocation:/m.test(frontmatter(a.text)), `claude/${a.name}: Copilot-only key`);
    assert.ok(!a.text.includes('${AWAY_TEAM_ROOT}'), `claude/${a.name}: unsubstituted root placeholder`);
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

test('the investigator ships its read-only guard, and the guard blocks writes', () => {
  const guard = dist('claude', 'hooks', 'readonly-guard.js');
  assert.ok(fs.existsSync(guard), 'dist/claude/hooks/readonly-guard.js is missing');
  const fm = frontmatter(fs.readFileSync(dist('claude', 'agents', 'away-team-investigator.md'), 'utf8'));
  assert.ok(fm.includes('readonly-guard.js'), 'investigator does not wire the guard');
  const probe = (command) => {
    try { execFileSync('node', [guard], { input: JSON.stringify({ tool_input: { command } }) }); return 0; }
    catch (e) { return e.status; }
  };
  for (const c of ['npm test', 'git log -S x', 'cat a.js > /tmp/b']) assert.strictEqual(probe(c), 0, `guard blocked "${c}"`);
  for (const c of ['echo x > src/a.js', "sed -i 's/a/b/' a.js", 'git commit -am x']) assert.strictEqual(probe(c), 2, `guard allowed "${c}"`);
});

test('dist matches a fresh build', () => {
  const status = execFileSync('git', ['status', '--porcelain', '--', 'dist'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(status, '', `dist/ differs from what is committed:\n${status}\nRun "npm run build" and commit dist/.`);
});

test('an install writes a hook path that resolves on the target machine', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'away-team-'));
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

  install(['--scope', 'global'], tmp);
  const global = fs.readFileSync(path.join(home, '.claude', 'agents', 'away-team-investigator.md'), 'utf8');
  assert.ok(global.includes(`command: 'node "${path.join(home, '.claude')}/hooks/readonly-guard.js"'`),
    `global install hook path is not absolute:\n${global.match(/command: .*/)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

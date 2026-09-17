#!/usr/bin/env node
// away-team installer.
//   npx away-team [--target copilot|claude|all] [--skip-plugins]   install user-level (~/.copilot, ~/.claude)
//   node bin/away-team.js --build                                  render dist/copilot and dist/claude for the plugin marketplaces
// Agents carry a model tier (cheap | balanced | strong); MODELS resolves it per platform.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const MODELS = {
  copilot: { cheap: 'gpt-5.6-luna', balanced: 'claude-sonnet-5', strong: 'claude-opus-5' },
  claude:  { cheap: 'haiku',        balanced: 'sonnet',          strong: 'opus' }, // strong: 'fable' if your plan has it
};
const CLAUDE_TOOLS = { agent: 'Agent', read: 'Read', search: 'Grep, Glob', execute: 'Bash', edit: 'Edit, Write', todo: 'TodoWrite', web: 'WebFetch, WebSearch' };

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const ti = args.indexOf('--target');
const target = ti >= 0 ? args[ti + 1] : 'all';

function render(text, platform) {
  return text.split(/\r?\n/).map((line) => {
    let m;
    if ((m = line.match(/^model: (\w+)$/))) return `model: ${MODELS[platform][m[1]]}`;
    if (platform === 'claude' && (m = line.match(/^tools: \[(.*)\]$/))) {
      const names = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      return names.includes('*') ? null : `tools: ${names.map((n) => CLAUDE_TOOLS[n]).join(', ')}`;
    }
    return line;
  }).filter((l) => l !== null).join('\n');
}

const agents = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.agent.md'));
const read = (f) => fs.readFileSync(path.join(ROOT, 'agents', f), 'utf8');

// Writes agents/ and skills/ under dest in the platform's format.
function emit(platform, dest) {
  fs.mkdirSync(path.join(dest, 'agents'), { recursive: true });
  for (const f of agents) {
    const out = platform === 'copilot' ? f : f.replace(/\.agent\.md$/, '.md');
    fs.writeFileSync(path.join(dest, 'agents', out), render(read(f), platform));
  }
  fs.cpSync(path.join(ROOT, 'skills'), path.join(dest, 'skills'), { recursive: true });
  if (platform === 'claude') { // orchestrator as a skill too: the Claude desktop app has no agent picker
    const raw = read('orchestrator.agent.md');
    const desc = raw.match(/^description: (.*)$/m)[1];
    const body = raw.split(/^---\r?\n/m)[2];
    const dir = path.join(dest, 'skills', 'orchestrator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: orchestrator\ndescription: ${desc}\n---\n\n${body}`);
  }
}

function sh(cmd) {
  console.log('> ' + cmd);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (r.status) console.warn(`  exit ${r.status}, continuing`);
}

if (flag('--build')) {
  const dist = path.join(ROOT, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const meta = {
    name: pkg.name, version: pkg.version, description: pkg.description, author: pkg.author,
    homepage: pkg.homepage, repository: pkg.repository, license: pkg.license, keywords: pkg.keywords,
  };
  emit('copilot', path.join(dist, 'copilot'));
  fs.writeFileSync(path.join(dist, 'copilot', 'plugin.json'), JSON.stringify({ ...meta, agents: 'agents/', skills: 'skills/' }, null, 2) + '\n');
  emit('claude', path.join(dist, 'claude'));
  fs.mkdirSync(path.join(dist, 'claude', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'claude', '.claude-plugin', 'plugin.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`built dist/copilot and dist/claude (v${pkg.version})`);
  process.exit(0);
}

if (['copilot', 'all'].includes(target)) {
  emit('copilot', path.join(os.homedir(), '.copilot'));
  console.log('Copilot: installed to ~/.copilot');
  if (!flag('--skip-plugins')) {
    sh('copilot plugin marketplace add DietrichGebert/ponytail');
    sh('copilot plugin install ponytail@ponytail');
    sh('npx -y skills add JuliusBrussee/caveman -g -a github-copilot');
  }
}
if (['claude', 'all'].includes(target)) {
  emit('claude', path.join(os.homedir(), '.claude'));
  console.log('Claude Code: installed to ~/.claude');
  if (!flag('--skip-plugins')) {
    sh('claude plugin marketplace add DietrichGebert/ponytail');
    sh('claude plugin install ponytail@ponytail');
    sh('claude plugin marketplace add JuliusBrussee/caveman');
    sh('claude plugin install caveman@caveman');
  }
}

#!/usr/bin/env node
// away-team installer.
//   npx @scotscottmca/away-team [--target copilot|claude|all] [--skip-plugins] [--level lite|full|ultra]
//                                                                  install user-level (~/.copilot, ~/.claude); level sets the
//                                                                  ponytail + caveman default (ultra); /ponytail or /caveman <level> per session
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
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const target = opt('--target', 'all');
const level = opt('--level', 'ultra');

// ponytail and caveman both read defaultMode from $XDG_CONFIG_HOME/<name>/config.json,
// else %APPDATA%\<name>\config.json on Windows, else ~/.config/<name>/config.json.
function setDefaultMode(name) {
  const dir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, name)
    : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name)
    : path.join(os.homedir(), '.config', name);
  const file = path.join(dir, 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  cfg.defaultMode = level;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${name}: defaultMode=${level} (${file})`);
}

// Caveman on Copilot is skill-only (no hooks), so its default level has to come from personal instructions.
const MARK = '<!-- away-team -->';
function setInstructionLine(file) {
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch {}
  const line = `${MARK} Caveman and ponytail run at level "${level}" by default. Switch for a session with /caveman <level> or /ponytail <level>.`;
  cur = cur.includes(MARK) ? cur.replace(/<!-- away-team -->.*/, line) : `${cur.trimEnd()}\n\n${line}\n`.trimStart();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cur);
}

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

// Runs a command; a non-zero exit whose output matches ALREADY (marketplace or plugin already present) is fine.
const ALREADY = /already (registered|installed|exists|added)/i;
function sh(cmd) {
  console.log('> ' + cmd);
  const r = spawnSync(cmd, { encoding: 'utf8', shell: true });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status && ALREADY.test(out)) { console.log('  already present, skipping'); return; }
  process.stdout.write(out);
  if (r.status) console.warn(`  exit ${r.status}, continuing`);
}

if (flag('--build')) {
  const dist = path.join(ROOT, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const meta = {
    name: pkg.name.split("/").pop(), version: pkg.version, description: pkg.description, author: pkg.author,
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

const BANNER = `
 █████╗  ██╗    ██╗  █████╗  ██╗   ██╗
██╔══██╗ ██║    ██║ ██╔══██╗ ╚██╗ ██╔╝
███████║ ██║ █╗ ██║ ███████║  ╚████╔╝
██╔══██║ ██║███╗██║ ██╔══██║   ╚██╔╝
██║  ██║ ╚███╔███╔╝ ██║  ██║    ██║
╚═╝  ╚═╝  ╚══╝╚══╝  ╚═╝  ╚═╝    ╚═╝
████████╗ ███████╗  █████╗  ███╗   ███╗
╚══██╔══╝ ██╔════╝ ██╔══██╗ ████╗ ████║
   ██║    █████╗   ███████║ ██╔████╔██║
   ██║    ██╔══╝   ██╔══██║ ██║╚██╔╝██║
   ██║    ██║      ██║  ██║ ██║ ╚═╝ ██║
   ╚═╝    ╚══════╝ ╚═╝  ╚═╝ ╚═╝     ╚═╝
`;
console.log(BANNER + `  away-team v${pkg.version} · beaming down the crew
`);

if (['copilot', 'all'].includes(target)) {
  emit('copilot', path.join(os.homedir(), '.copilot'));
  console.log('Copilot: installed to ~/.copilot');
  if (!flag('--skip-plugins')) {
    sh('copilot plugin marketplace add DietrichGebert/ponytail');
    sh('copilot plugin install ponytail@ponytail');
    sh('npx -y skills add JuliusBrussee/caveman -g -a github-copilot -s caveman -y --copy'); // core skill only; the other 19 are extras
    setInstructionLine(path.join(os.homedir(), '.copilot', 'copilot-instructions.md'));
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
if (!flag('--skip-plugins')) {
  setDefaultMode('ponytail');
  setDefaultMode('caveman');
}

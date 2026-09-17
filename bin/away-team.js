#!/usr/bin/env node
// away-team installer.
//   npx @scotscottmca/away-team                       interactive: detects Copilot / Claude Code, asks what to install
//   flags skip the matching prompt:  --target copilot|claude|all   --skip-plugins   --level lite|full|ultra   --yes
//   node bin/away-team.js --build                     render dist/copilot and dist/claude for the plugin marketplaces
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
const LEVELS = ['lite', 'full', 'ultra'];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const home = (...p) => path.join(os.homedir(), ...p);

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
const skills = fs.readdirSync(path.join(ROOT, 'skills'));
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

// ponytail and caveman both read defaultMode from $XDG_CONFIG_HOME/<name>/config.json,
// else %APPDATA%\<name>\config.json on Windows, else ~/.config/<name>/config.json.
function configFile(name) {
  const dir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, name)
    : process.platform === 'win32' ? path.join(process.env.APPDATA || home('AppData', 'Roaming'), name)
    : home('.config', name);
  return path.join(dir, 'config.json');
}
function setDefaultMode(name, level) {
  const file = configFile(name);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  cfg.defaultMode = level;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// Caveman on Copilot is skill-only (no hooks), so its default level has to come from personal instructions.
const MARK = '<!-- away-team -->';
function setInstructionLine(file, level) {
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch {}
  const line = `${MARK} Caveman and ponytail run at level "${level}" by default. Switch for a session with /caveman <level> or /ponytail <level>.`;
  cur = cur.includes(MARK) ? cur.replace(/<!-- away-team -->.*/, line) : `${cur.trimEnd()}\n\n${line}\n`.trimStart();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cur);
}

// True when a real CLI is on PATH. Resolved with where/command -v rather than executed: the Claude and Copilot
// desktop apps from the Microsoft Store register execution aliases under WindowsApps, and running one opens the app.
function has(cli) {
  const r = spawnSync(process.platform === 'win32' ? `where ${cli}` : `command -v ${cli}`, { shell: true, encoding: 'utf8' });
  const hits = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/WindowsApps/i.test(l));
  return r.status === 0 && hits.length > 0;
}
// Only files the apps themselves create count; our own agents/ and skills/ must not, or a previous install fakes a detection.
const anyExists = (...paths) => paths.some((p) => fs.existsSync(p));
const detect = () => ({
  copilot: has('copilot') || anyExists(home('.copilot', 'config.json'), home('.copilot', 'session-state'), home('.copilot', 'logs')),
  claude: has('claude') || anyExists(home('.claude', 'projects'), home('.claude', 'sessions'), home('.claude', 'statsig'), home('.claude', 'settings.json')), // not ~/.claude.json alone: a stale one survives an uninstall
});

// Runs a command, capturing output. "already" = the marketplace or plugin was present, which is fine.
const ALREADY = /already (registered|installed|exists|added)/i;
function sh(cmd) {
  const r = spawnSync(cmd, { encoding: 'utf8', shell: true });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  return { ok: r.status === 0, already: r.status !== 0 && ALREADY.test(out), out };
}

const PLUGINS = {
  copilot: {
    cli: 'copilot',
    ponytail: ['copilot plugin marketplace add DietrichGebert/ponytail', 'copilot plugin install ponytail@ponytail'],
    caveman: ['npx -y skills add JuliusBrussee/caveman -g -a github-copilot -s caveman -y --copy'], // core skill only
    manual: { ponytail: ['/plugin marketplace add DietrichGebert/ponytail', '/plugin install ponytail@ponytail'],
              caveman: ['npx skills add JuliusBrussee/caveman -g -a github-copilot -s caveman -y --copy'] },
  },
  claude: {
    cli: 'claude',
    ponytail: ['claude plugin marketplace add DietrichGebert/ponytail', 'claude plugin install ponytail@ponytail'],
    caveman: ['claude plugin marketplace add JuliusBrussee/caveman', 'claude plugin install caveman@caveman'],
    manual: { ponytail: ['/plugin marketplace add DietrichGebert/ponytail', '/plugin install ponytail@ponytail'],
              caveman: ['/plugin marketplace add JuliusBrussee/caveman', '/plugin install caveman@caveman'] },
  },
};

if (flag('--build')) {
  const dist = path.join(ROOT, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const meta = {
    name: pkg.name.split('/').pop(), version: pkg.version, description: pkg.description, author: pkg.author,
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
 █████  ██     ██  █████  ██    ██
██   ██ ██     ██ ██   ██  ██  ██
███████ ██  █  ██ ███████   ████
██   ██ ██ ███ ██ ██   ██    ██
██   ██  ███ ███  ██   ██    ██

████████ ███████  █████  ███    ███
   ██    ██      ██   ██ ████  ████
   ██    █████   ███████ ██ ████ ██
   ██    ██      ██   ██ ██  ██  ██
   ██    ███████ ██   ██ ██      ██
`;

(async () => {
  const p = require('@clack/prompts');
  const c = require('picocolors');
  const interactive = process.stdin.isTTY && !flag('--yes') && !flag('-y');
  const bail = (v) => { if (p.isCancel(v)) { p.cancel('Nothing installed.'); process.exit(0); } return v; };

  console.log(BANNER);
  p.intro(`${c.bgCyan(c.black(' away-team '))} v${pkg.version} ${c.dim('· beaming down the crew')}`);

  // Targets
  const found = detect();
  p.log.step(`Detected: GitHub Copilot ${found.copilot ? c.green('yes') : c.dim('no')} · Claude Code ${found.claude ? c.green('yes') : c.dim('no')}`);
  const detected = ['copilot', 'claude'].filter((t) => found[t]);
  let targets = opt('--target') ? (opt('--target') === 'all' ? ['copilot', 'claude'] : [opt('--target')])
    : detected.length ? detected : ['copilot', 'claude'];
  if (interactive && !opt('--target')) {
    targets = bail(await p.multiselect({
      message: 'Install to',
      options: [
        { value: 'copilot', label: 'GitHub Copilot', hint: found.copilot ? 'detected' : 'not detected' },
        { value: 'claude', label: 'Claude Code', hint: found.claude ? 'detected' : 'not detected' },
      ],
      initialValues: targets,
      required: true,
    }));
  }

  // Companions
  let companions = flag('--skip-plugins') ? [] : ['ponytail', 'caveman'];
  if (interactive && !flag('--skip-plugins')) {
    companions = bail(await p.multiselect({
      message: 'Companion plugins',
      options: [
        { value: 'ponytail', label: 'ponytail', hint: 'lazy senior dev: YAGNI, stdlib first, shortest diff' },
        { value: 'caveman', label: 'caveman', hint: 'terse output; core skill only' },
      ],
      initialValues: companions,
      required: false,
    }));
  }

  // Level
  let level = LEVELS.includes(opt('--level')) ? opt('--level') : 'ultra';
  if (interactive && companions.length && !opt('--level')) {
    level = bail(await p.select({
      message: 'Default level for ponytail and caveman',
      options: [
        { value: 'ultra', label: 'ultra', hint: 'fewest tokens; switch per session with /caveman full' },
        { value: 'full', label: 'full' },
        { value: 'lite', label: 'lite' },
      ],
      initialValue: level,
    }));
  }

  // Summary
  const rows = [];
  for (const t of targets) {
    const dir = t === 'copilot' ? '~/.copilot' : '~/.claude';
    rows.push(c.cyan(`${dir}/agents`), `  ${agents.length} agents: ${agents.map((a) => a.replace(/\.agent\.md$/, '')).join(', ')}`);
    rows.push(c.cyan(`${dir}/skills`), `  ${skills.join(', ')}${t === 'claude' ? ', orchestrator' : ''}`);
    for (const name of companions) rows.push(c.cyan(`${name} → ${t}`), ...PLUGINS[t][name].map((x) => `  ${c.dim(x)}`));
    rows.push('');
  }
  if (companions.length) rows.push(c.cyan(`level: ${level}`), ...companions.map((n) => `  ${c.dim(configFile(n))}`));
  p.note(rows.join('\n').trimEnd(), 'Installation Summary');

  if (interactive) {
    const ok = bail(await p.confirm({ message: 'Proceed with installation?' }));
    if (!ok) { p.cancel('Nothing installed.'); process.exit(0); }
  }

  // Install
  const manual = [];
  for (const t of targets) {
    const dest = t === 'copilot' ? home('.copilot') : home('.claude');
    emit(t, dest);
    p.log.success(`${t === 'copilot' ? 'GitHub Copilot' : 'Claude Code'}: agents and skills → ${dest}`);
    if (t === 'copilot' && companions.includes('caveman')) setInstructionLine(home('.copilot', 'copilot-instructions.md'), level);

    if (companions.length && !has(PLUGINS[t].cli)) {
      manual.push({ t, cmds: companions.flatMap((n) => PLUGINS[t].manual[n]) });
      continue;
    }
    for (const name of companions) {
      const s = p.spinner();
      s.start(`${name} → ${t}`);
      let failed = null;
      for (const cmd of PLUGINS[t][name]) {
        const r = sh(cmd);
        if (r.ok || r.already) continue;
        failed = { cmd, out: r.out };
        break;
      }
      if (failed) {
        s.stop(`${name} → ${t}: ${c.yellow('failed')}, run by hand: ${failed.cmd}`);
        p.log.message(c.dim(failed.out.split('\n').slice(-6).join('\n')));
      } else {
        s.stop(`${name} → ${t} ${c.dim('installed')}`);
      }
    }
  }
  for (const n of companions) setDefaultMode(n, level);
  if (companions.length) p.log.success(`ponytail and caveman default to ${c.bold(level)}`);
  for (const m of manual) {
    p.note(m.cmds.join('\n'), `${PLUGINS[m.t].cli} CLI not on PATH: run these inside a ${m.t === 'copilot' ? 'Copilot' : 'Claude Code'} session`);
  }

  p.outro(`Done. Select the orchestrator: ${c.cyan(targets.includes('copilot') ? '/agent → orchestrator' : '/orchestrator <request>')}`);
})();

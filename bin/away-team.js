#!/usr/bin/env node
// away-team installer.
//   npx @scotscottmca/away-team                       interactive: detects Copilot / Claude Code, asks what to install
//   flags skip the matching prompt:  --target copilot|claude|all   --scope global|project   --skip-plugins   --level lite|full|ultra   --yes
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
// Frontmatter keys only Claude Code understands; dropped from the Copilot render.
const CLAUDE_ONLY = ['maxTurns', 'disallowedTools', 'permissionMode'];
// Tool aliases (Copilot's names) to Claude Code tool names. `ask` has no Copilot tool and is dropped from that render.
const CLAUDE_TOOLS = { agent: 'Agent', read: 'Read', search: 'Grep, Glob', execute: 'Bash', edit: 'Edit, Write, NotebookEdit', todo: 'TodoWrite', web: 'WebFetch, WebSearch', ask: 'AskUserQuestion' };
const COPILOT_ONLY_DROP = ['ask'];
const LEVELS = ['lite', 'full', 'ultra'];
const PLUGIN = pkg.name.split('/').pop(); // plugin name; Claude Code scopes a plugin's agents and skills as <plugin>:<name>

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const home = (...p) => path.join(os.homedir(), ...p);
// Root of the git repo we are running in, if any: enables project scope.
const repoRoot = (() => { const r = spawnSync('git rev-parse --show-toplevel', { shell: true, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; })();

const agents = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.agent.md'));
const skills = fs.readdirSync(path.join(ROOT, 'skills'));
const read = (f) => fs.readFileSync(path.join(ROOT, 'agents', f), 'utf8');
// Specialist names the orchestrator delegates to. In the Claude plugin render they become <plugin>:<name>,
// the scoped identifier plugin agents register under; the npx install keeps bare names.
const specialists = agents.map((f) => f.replace(/\.agent\.md$/, '')).filter((n) => n !== PLUGIN);
const SPECIALIST = new RegExp(`\\b(${specialists.join('|')})\\b`, 'g');

// Parses `tools: ["agent(a, b)", "read"]` into [[alias, args|undefined], ...].
const parseTools = (list) => [...list.matchAll(/"([^"]+)"/g)].map((x) => x[1].match(/^([\w*]+)(?:\((.*)\))?$/).slice(1, 3));

// plugin: true renders for the Claude plugin (dist/claude), where delegation targets take the plugin prefix.
function render(text, platform, { plugin = false } = {}) {
  const scope = (n) => (plugin ? `${PLUGIN}:${n}` : n);
  return text.split(/\r?\n/).map((line) => {
    let m;
    if ((m = line.match(/^model: (\w+)$/))) return `model: ${MODELS[platform][m[1]]}`;
    if ((m = line.match(/^tools: \[(.*)\]$/))) {
      const entries = parseTools(m[1]);
      // Copilot has no agent allowlist syntax and ignores unknown tool names: bare aliases only.
      if (platform === 'copilot') return `tools: [${entries.filter(([a]) => !COPILOT_ONLY_DROP.includes(a)).map(([a]) => JSON.stringify(a)).join(', ')}]`;
      if (entries.some(([a]) => a === '*')) return null;
      // `agent(a, b)` is an allowlist: only those subagents can be spawned (main-thread agents only; ignored in a subagent).
      return `tools: ${entries.map(([a, args]) => (a === 'agent' && args ? `Agent(${args.split(/\s*,\s*/).map(scope).join(', ')})` : CLAUDE_TOOLS[a])).join(', ')}`;
    }
    if (platform === 'copilot' && CLAUDE_ONLY.some((k) => line.startsWith(`${k}:`))) return null;
    if (plugin && !line.startsWith('name:')) return line.replace(SPECIALIST, scope('$1'));
    return line;
  }).filter((l) => l !== null).join('\n');
}

// Writes agents/ and skills/ under dest in the platform's format.
function emit(platform, dest, opts = {}) {
  fs.mkdirSync(path.join(dest, 'agents'), { recursive: true });
  for (const f of agents) {
    const out = platform === 'copilot' ? f : f.replace(/\.agent\.md$/, '.md');
    fs.writeFileSync(path.join(dest, 'agents', out), render(read(f), platform, opts));
  }
  fs.cpSync(path.join(ROOT, 'skills'), path.join(dest, 'skills'), { recursive: true });
  if (platform === 'claude') { // orchestrator as a skill too: the Claude desktop app has no agent picker
    // A skill cannot carry an agent's tool allowlist. It can name a model and remove tools, but only for the turn
    // that invokes it, so it removes every tool the orchestrator's allowlist leaves out; the rest is prose.
    const rendered = render(read(`${PLUGIN}.agent.md`), 'claude', opts);
    const desc = rendered.match(/^description: (.*)$/m)[1];
    const model = rendered.match(/^model: (.*)$/m)[1];
    const allowed = rendered.match(/^tools: (.*)$/m)[1].replace(/\([^)]*\)/g, '').split(', ');
    const disallowed = Object.values(CLAUDE_TOOLS).flatMap((v) => v.split(', ')).filter((t) => !allowed.includes(t));
    const body = rendered.split(/^---\r?\n/m)[2];
    const dir = path.join(dest, 'skills', PLUGIN);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${PLUGIN}\ndescription: ${desc}\ndisable-model-invocation: true\nmodel: ${model}\ndisallowed-tools: ${disallowed.join(', ')}\n---\n\n${body}`);
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
  emit('claude', path.join(dist, 'claude'), { plugin: true });
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

  // Scope: global (this user) or project (committed in this repo; teammates and the Copilot cloud agent get it)
  let scope = opt('--scope') === 'project' ? 'project' : 'global';
  if (interactive && repoRoot && !opt('--scope')) {
    scope = bail(await p.select({
      message: 'Scope',
      options: [
        { value: 'global', label: 'Global', hint: 'this user, every repo' },
        { value: 'project', label: 'Project', hint: `${repoRoot}, committed; shared with teammates and the Copilot cloud agent` },
      ],
      initialValue: 'global',
    }));
  }
  if (scope === 'project' && !repoRoot) { p.cancel('--scope project needs to run inside a git repository.'); process.exit(1); }
  const destFor = (t) => scope === 'project' ? path.join(repoRoot, t === 'copilot' ? '.github' : '.claude') : home(t === 'copilot' ? '.copilot' : '.claude');

  // Companions (user-level plugins; not part of a project install)
  let companions = flag('--skip-plugins') || scope === 'project' ? [] : ['ponytail', 'caveman'];
  if (interactive && scope === 'global' && !flag('--skip-plugins')) {
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
    const dir = scope === 'project' ? destFor(t) : (t === 'copilot' ? '~/.copilot' : '~/.claude');
    rows.push(c.cyan(`${dir}/agents`), `  ${agents.length} agents: ${agents.map((a) => a.replace(/\.agent\.md$/, '')).join(', ')}`);
    rows.push(c.cyan(`${dir}/skills`), `  ${skills.join(', ')}${t === 'claude' ? ', away-team' : ''}`);
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
    const dest = destFor(t);
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

  const how = c.cyan(targets.includes('copilot') ? '/agent → away-team' : '/away-team <request>');
  p.outro(scope === 'project' ? `Done. Commit the new files, then select the orchestrator: ${how}` : `Done. Select the orchestrator: ${how}`);
})();

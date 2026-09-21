#!/usr/bin/env node
// away-team installer.
//   npx @scotscottmca/away-team                       interactive: detects Copilot / Claude Code, asks what to install
//   flags skip the matching prompt:  --target copilot|claude|all   --scope global|project   --skip-plugins   --level lite|full|ultra   --yes
//   --mcp <a,b>                                       extra MCP servers, on top of the ones found on this machine
//   --no-mcp                                          skip MCP entirely (isolation, not cost: a tool name is ~11 tokens)
//   node bin/away-team.js --build                     render dist/copilot and dist/claude for the plugin marketplaces
// Agents carry a model tier (cheap | balanced | strong); models.js resolves it per platform, priority list first.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const MODELS = require('./models.js');
// First row in the tier's priority list that names this platform; a row missing a platform's key is skipped for
// that platform only, so a plan-only model can be prepended (see models.js) without breaking the other platform.
const resolveModel = (rows, platform) => rows.find((e) => e[platform])?.[platform];
// Frontmatter keys only Claude Code understands; dropped from the Copilot render, with any indented block under them.
const CLAUDE_ONLY = ['maxTurns', 'disallowedTools', 'permissionMode', 'skills', 'hooks'];
// Frontmatter keys only Copilot understands; dropped from the Claude render.
const COPILOT_ONLY_KEYS = ['disable-model-invocation'];
// Placeholder in agent bodies for the directory this install writes to; hook commands resolve through it.
// A project-scope install is committed and shared, so it must resolve at runtime, not bake in this machine's path:
// Claude Code exports CLAUDE_PROJECT_DIR (session root) and CLAUDE_PLUGIN_ROOT (plugin directory) to hook commands.
const ROOT_VAR = '${AWAY_TEAM_ROOT}';
const TIMEOUT_MS = 120000; // no child of this installer may hang it forever
// Tools the investigator's read-only guard inspects: Bash, and every MCP tool, since the crew now gets every
// MCP server the machine has and a server that reads a work item can usually also create one.
const GUARD_MATCHER = 'Bash|mcp__.*';
// Tool aliases (Copilot's names) to Claude Code tool names. `ask` has no Copilot tool and is dropped from that render.
const CLAUDE_TOOLS = { agent: 'Agent', read: 'Read', search: 'Grep, Glob', execute: 'Bash', edit: 'Edit, Write, NotebookEdit', todo: 'TodoWrite', web: 'WebFetch, WebSearch', ask: 'AskUserQuestion' };
const COPILOT_ONLY_DROP = ['ask'];
// Copilot CLI matched `read` and `execute` to its tools but not `search` (checked live: an agent allowed
// ["read", "search", "execute"] listed view and bash, no grep or glob). Its tools are named grep and glob, and
// Copilot ignores names it does not recognise, so the render writes the alias and both tool names.
const COPILOT_TOOLS = { search: ['search', 'grep', 'glob'] };
const LEVELS = ['lite', 'full', 'ultra'];
const PLUGIN = pkg.name.split('/').pop(); // plugin name; Claude Code scopes a plugin's agents and skills as <plugin>:<name>
const ORCHESTRATOR = 'away-team'; // agents/<ORCHESTRATOR>.agent.md; also the Claude desktop skill's name
const INVESTIGATOR = 'away-team-investigator'; // the read-only specialist hooks/readonly-guard.js is scoped to
// Agents whose Bash the guard must enforce read-only, session-wide, on the plugin build.
const GUARDED_AGENTS = [INVESTIGATOR, ORCHESTRATOR];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const home = (...p) => path.join(os.homedir(), ...p);
const list = (name) => (opt(name) || '').split(',').map((s) => s.trim()).filter(Boolean);
// Every child gets a timeout and an empty stdin: a hung or stdin-reading install must not hang the installer.
const run = (cmd, timeout = TIMEOUT_MS) => spawnSync(cmd, { shell: true, encoding: 'utf8', input: '', timeout, killSignal: 'SIGKILL' });
// The whole crew gets every MCP server this machine has. A tool allowlist is deny-by-default, so a server has to be
// named in it or the agent cannot see it — hence discovery rather than a fixed list. Measured cost of that breadth:
// only tool names reach a cold start, about 11 tokens each, and padding every description tenfold changed nothing,
// so schemas are fetched on demand. See docs/cost.md; --no-mcp is for isolation, not for cost. Both platforms ignore an entry
// for a server that is not configured, so every source here is best-effort and a false positive costs nothing.
// The Azure DevOps server ships as a default under both names its own guide registers it as (`ado` on Copilot CLI,
// `azure-devops` on Claude Code); it is also what dist/ is built with, since that is shared and cannot be discovered for.
// GitHub ships as a default too: a hosted/remote session has no `gh` binary, so pr-writer and the read-only guard's
// issue-filing exception need the MCP path there instead.
const DEFAULT_MCP = ['ado', 'azure-devops', 'github'];
// Server names out of a `<cli> mcp list` table or a JSON config: keys of mcpServers / servers / mcp, at any depth
// that the known config shapes use.
const jsonServers = (file) => {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pick = (o) => (o && typeof o === 'object' ? Object.keys(o.mcpServers || o.servers || o.mcp || {}) : []);
    return [...pick(d), ...Object.values(d.projects || {}).flatMap(pick)];
  } catch { return []; }
};
// `<cli> mcp list` prints one server per line; take the leading identifier off each, ignoring headers and bullets.
const cliServers = (cli) => {
  if (!has(cli)) return [];
  const r = run(`${cli} mcp list`, 15000);
  if (r.status !== 0) return [];
  return (r.stdout || '').split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•|]+/, '').match(/^([A-Za-z0-9_][\w.-]*)\s*[::|-]/))
    .filter(Boolean).map((m) => m[1])
    .filter((n) => !/^(name|server|servers|status|command|type|scope|tools|url)$/i.test(n));
};
function discoverMcp() {
  const files = [home('.claude.json'), home('.claude', 'settings.json'), home('.mcp.json'),
    home('.copilot', 'mcp-config.json'), home('.config', 'github-copilot', 'mcp.json'),
    ...(repoRoot ? [path.join(repoRoot, '.mcp.json'), path.join(repoRoot, '.vscode', 'mcp.json')] : [])];
  return [...new Set([...files.flatMap(jsonServers), ...cliServers('claude'), ...cliServers('copilot')])];
}
// Root of the git repo we are running in, if any: enables project scope.
const repoRoot = (() => { const r = run('git rev-parse --show-toplevel', 10000); return r.status === 0 ? r.stdout.trim() : null; })();

const agents = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.agent.md'));
const skills = fs.readdirSync(path.join(ROOT, 'skills'));
const read = (f) => fs.readFileSync(path.join(ROOT, 'agents', f), 'utf8');
// Specialist names the orchestrator delegates to. In the Claude plugin render they become <plugin>:<name>,
// the scoped identifier plugin agents register under; the npx install keeps bare names.
const specialists = agents.map((f) => f.replace(/\.agent\.md$/, '')).filter((n) => n !== ORCHESTRATOR);
const SPECIALIST = specialists.length ? new RegExp(`\\b(${specialists.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null;

// Parses `tools: ["agent(a, b)", "read"]` into [[alias, args|undefined], ...].
const parseTools = (list) => [...list.matchAll(/"([^"]+)"/g)].map((x) => {
  const m = x[1].match(/^([\w*-]+)(?:\((.*)\))?$/);
  if (!m) throw new Error(`bad tools entry "${x[1]}": expected an alias like "read" or "agent(a, b)"`);
  return m.slice(1, 3);
});

// An MCP entry is a server name or a Claude tool name (mcp__<server>__<tool>); each platform spells them differently.
// Claude Code: mcp__<server>__* for a whole server (subagent docs). Copilot: <server>/* or <server>/<tool>
// (custom-agents-configuration); a bare server name is an unrecognised tool there and is silently ignored.
const mcpTool = (e, platform) => {
  const [server, tool] = e.replace(/^mcp__/, '').split('__');
  if (platform === 'claude') return e.startsWith('mcp__') && tool ? e : `mcp__${server}__*`;
  return `${server}/${tool || '*'}`;
};

// plugin: true renders for the Claude plugin (dist/claude), where delegation targets take the plugin prefix.
// root is substituted for ${AWAY_TEAM_ROOT}: the plugin's own root for a plugin build, the install directory otherwise.
function render(text, platform, { plugin = false, root = '.', file = 'agent', mcp = [] } = {}) {
  const scope = (n) => (plugin ? `${PLUGIN}:${n}` : n);
  const bad = (msg) => { throw new Error(`${file}: ${msg}`); };
  // A Claude-only key may open an indented block (hooks:); drop the whole block for Copilot.
  let dropping = false;
  return text.split(/\r?\n/).map((line) => {
    let m;
    if (dropping) { if (/^\s+\S/.test(line)) return null; dropping = false; }
    // biome-ignore lint/suspicious/noAssignInExpressions: match-and-test in one line keeps this dispatcher one branch per frontmatter key.
    if ((m = line.match(/^model: (\w+)$/))) {
      const tier = m[1];
      const rows = MODELS[tier];
      if (!rows) bad(`unknown model tier "${tier}": expected one of ${Object.keys(MODELS).join(', ')}`);
      const model = resolveModel(rows, platform);
      if (!model) bad(`model tier "${tier}" has no ${platform} alias`);
      return `model: ${model}`;
    }
    // biome-ignore lint/suspicious/noAssignInExpressions: match-and-test in one line keeps this dispatcher one branch per frontmatter key.
    if (platform === 'claude' && (m = line.match(/^skills: \[(.*)\]$/))) {
      return `skills: [${parseTools(m[1]).map(([a]) => JSON.stringify(scope(a))).join(', ')}]`;
    }
    // biome-ignore lint/suspicious/noAssignInExpressions: match-and-test in one line keeps this dispatcher one branch per frontmatter key.
    if ((m = line.match(/^tools: \[(.*)\]$/))) {
      const entries = parseTools(m[1]);
      for (const [a] of entries) {
        if (a === '*' || a.startsWith('mcp__') || CLAUDE_TOOLS[a] || COPILOT_ONLY_DROP.includes(a)) continue;
        bad(`unknown tool alias "${a}": expected one of ${Object.keys(CLAUDE_TOOLS).join(', ')}, or an mcp__<server> name`);
      }
      const extra = entries.some(([a]) => a === '*') ? [] : mcp.map((e) => mcpTool(e, platform));
      // Copilot has no agent allowlist syntax and ignores unknown tool names: bare aliases only.
      if (platform === 'copilot') {
        const names = entries.filter(([a]) => !COPILOT_ONLY_DROP.includes(a))
          .flatMap(([a]) => (a.startsWith('mcp__') ? [mcpTool(a, 'copilot')] : COPILOT_TOOLS[a] || [a]));
        return `tools: [${[...new Set([...names, ...extra])].map((a) => JSON.stringify(a)).join(', ')}]`;
      }
      if (entries.some(([a]) => a === '*')) return null;
      // `agent(a, b)` is an allowlist: only those subagents can be spawned (main-thread agents only; ignored in a subagent).
      const names = entries.map(([a, args]) => (a === 'agent' && args ? `Agent(${args.split(/\s*,\s*/).map(scope).join(', ')})`
        : a.startsWith('mcp__') ? a : CLAUDE_TOOLS[a]));
      return `tools: ${[...new Set([...names, ...extra])].join(', ')}`;
    }
    if (platform === 'copilot' && CLAUDE_ONLY.some((k) => line.startsWith(`${k}:`))) { dropping = line.trim().endsWith(':'); return null; }
    // Claude Code ignores (and warns about) frontmatter hooks on plugin agents; the plugin wires them from hooks/hooks.json.
    if (plugin && line.startsWith('hooks:')) { dropping = true; return null; }
    if (platform === 'claude' && COPILOT_ONLY_KEYS.some((k) => line.startsWith(`${k}:`))) return null;
    if (line.includes(ROOT_VAR)) line = line.split(ROOT_VAR).join(root);
    if (plugin && SPECIALIST && !line.startsWith('name:')) return line.replace(SPECIALIST, scope('$1'));
    return line;
  }).filter((l) => l !== null).join('\n');
}

// Renders every file for one platform under dest, in that platform's format. Pure: it touches no disk, so an
// unknown tier or tool alias throws here, before anything has been removed or written. flush() does the writing.
function plan(platform, dest, opts = {}) {
  const files = [];
  for (const f of agents) {
    const out = platform === 'copilot' ? f : f.replace(/\.agent\.md$/, '.md');
    files.push([path.join(dest, 'agents', out), render(read(f), platform, { ...opts, file: f })]);
  }
  // A plugin agent's frontmatter hooks are ignored, so the plugin registers the guard for the whole session and the
  // guard scopes itself to the investigator by the agent_type Claude Code passes in the hook input.
  if (opts.plugin) {
    const agentFlags = GUARDED_AGENTS.map((a) => `--agent ${a}`).join(' ');
    const hooks = { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: `node "${opts.root}/hooks/readonly-guard.js" ${agentFlags}` }] }] };
    files.push([path.join(dest, 'hooks', 'hooks.json'), `${JSON.stringify({ hooks }, null, 2)}\n`]);
  }
  if (platform === 'claude') { // orchestrator as a skill too: the Claude desktop app has no agent picker
    // A skill cannot carry an agent's tool allowlist. It can name a model and remove tools, but only for the turn
    // that invokes it, so it removes every tool the orchestrator's allowlist leaves out; the rest is prose.
    const rendered = render(read(`${ORCHESTRATOR}.agent.md`), 'claude', { ...opts, file: `${ORCHESTRATOR}.agent.md` });
    const desc = rendered.match(/^description: (.*)$/m)[1];
    const model = rendered.match(/^model: (.*)$/m)[1];
    const tools = rendered.match(/^tools: (.*)$/m); // absent when the agent has every tool
    const allowed = tools ? tools[1].replace(/\([^)]*\)/g, '').split(', ') : Object.values(CLAUDE_TOOLS).join(', ').split(', ');
    // A skill cannot carry the guard, so Bash is force-excluded here regardless of the agent's own allowlist: the
    // orchestrator's read-only Bash is fine on the main thread (guarded), but unenforced prose on a skill turn.
    const disallowed = [...new Set([...Object.values(CLAUDE_TOOLS).flatMap((v) => v.split(', ')).filter((t) => !allowed.includes(t)), 'Bash'])];
    const body = rendered.split(/^---\r?\n/m)[2];
    files.push([path.join(dest, 'skills', ORCHESTRATOR, 'SKILL.md'),
      `---\nname: ${ORCHESTRATOR}\ndescription: ${desc}\ndisable-model-invocation: true\nmodel: ${model}\ndisallowed-tools: ${disallowed.join(', ')}\n---\n\n${body}`]);
  }

  const copies = [[path.join(ROOT, 'skills'), path.join(dest, 'skills')]];
  // Agent-scoped hooks are Claude Code only; the investigator's read-only guard lives here.
  if (platform === 'claude') copies.push([path.join(ROOT, 'hooks'), path.join(dest, 'hooks')]);
  return { copies, files };
}

// Applies a plan. Nothing here can fail on bad input, so by the time it runs the render has already succeeded.
function flush({ copies, files }) {
  for (const [from, to] of copies) fs.cpSync(from, to, { recursive: true });
  for (const [file, content] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

// Writes agents/ and skills/ under dest in the platform's format.
const emit = (platform, dest, opts = {}) => flush(plan(platform, dest, opts));

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
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
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
  const r = run(process.platform === 'win32' ? `where ${cli}` : `command -v ${cli}`, 10000);
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
  const r = run(cmd);
  const timedOut = r.error && (r.error.code === 'ETIMEDOUT' || r.signal === 'SIGKILL');
  const note = timedOut ? `timed out after ${TIMEOUT_MS / 1000}s and was killed` : r.error ? r.error.message : '';
  const out = [(r.stdout || '') + (r.stderr || ''), note].join('\n').trim();
  const ok = !r.error && r.status === 0;
  return { ok, already: !ok && !timedOut && ALREADY.test(out), out };
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

// dist/ is committed and shared, so it carries only the defaults; an install adds what this machine actually has.
const mcpFor = (built) => (flag('--no-mcp') ? [] : built ? DEFAULT_MCP
  : [...new Set([...DEFAULT_MCP, ...discoverMcp(), ...list('--mcp')])]);

if (flag('--build')) {
  const dist = path.join(ROOT, 'dist');
  const meta = {
    name: PLUGIN, version: pkg.version, description: pkg.description, author: pkg.author,
    homepage: pkg.homepage, repository: pkg.repository, license: pkg.license, keywords: pkg.keywords,
  };
  // Render both platforms before removing anything. dist/ is wiped so a deleted agent cannot linger in it, and a
  // build that throws half way would otherwise leave nothing there at all.
  const plans = [
    plan('copilot', path.join(dist, 'copilot'), { root: '${CLAUDE_PLUGIN_ROOT}', mcp: mcpFor(true) }),
    plan('claude', path.join(dist, 'claude'), { plugin: true, root: '${CLAUDE_PLUGIN_ROOT}', mcp: mcpFor(true) }),
  ];
  plans[0].files.push([path.join(dist, 'copilot', 'plugin.json'),
    `${JSON.stringify({ ...meta, agents: 'agents/', skills: 'skills/' }, null, 2)}\n`]);
  plans[1].files.push([path.join(dist, 'claude', '.claude-plugin', 'plugin.json'), `${JSON.stringify(meta, null, 2)}\n`]);
  fs.rmSync(dist, { recursive: true, force: true });
  plans.forEach(flush);
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

  // MCP: the whole crew gets every server this machine has, since a tool allowlist cannot see one it does not name.
  const mcp = mcpFor(false);
  const found_mcp = mcp.filter((n) => !DEFAULT_MCP.includes(n));
  if (mcp.length) p.log.step(`MCP servers → every agent: ${c.cyan(mcp.join(', '))}${found_mcp.length ? '' : c.dim(' (defaults only; none found on this machine)')}`);
  else p.log.step(c.dim('MCP: skipped (--no-mcp)'));

  // Summary
  const rows = [];
  for (const t of targets) {
    const dir = scope === 'project' ? destFor(t) : (t === 'copilot' ? '~/.copilot' : '~/.claude');
    rows.push(c.cyan(`${dir}/agents`), `  ${agents.length} agents: ${agents.map((a) => a.replace(/\.agent\.md$/, '')).join(', ')}`);
    rows.push(c.cyan(`${dir}/skills`), `  ${skills.join(', ')}${t === 'claude' ? `, ${ORCHESTRATOR}` : ''}`);
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
    // Absolute for a global install, portable for a project install: teammates check the repo out elsewhere.
    emit(t, dest, { root: scope === 'project' ? '${CLAUDE_PROJECT_DIR}/.claude' : dest, mcp });
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

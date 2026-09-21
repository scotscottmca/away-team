#!/usr/bin/env node
// PreToolUse hook for away-team-investigator: makes "read-only" an enforced constraint, not a convention.
// The investigator's tool list already excludes Edit/Write, but `execute` renders to Bash, and Bash can write
// (`>`, `sed -i`, `git commit`). This blocks write-shaped Bash outside the system temp directory.
// Wired from the agent's `hooks:` frontmatter; exits 2 with a reason on stderr to deny the call.
const os = require('os');
const path = require('path');

const TMP = [os.tmpdir(), '/tmp', '/var/tmp', process.env.TMPDIR, process.env.TEMP, process.env.TMP]
  .filter(Boolean).map((d) => path.resolve(d));
const isTemp = (p) => {
  const q = p.replace(/^['"]|['"]$/g, '');
  if (q === '/dev/null' || q === 'NUL' || /^\/dev\/(std(out|err)|fd\/\d+)$/.test(q)) return true;
  if (!path.isAbsolute(q)) return false;
  const r = path.resolve(q);
  return TMP.some((t) => r === t || r.startsWith(t + path.sep));
};

// Mutating subcommands of tools the investigator legitimately runs read-only.
const GIT_WRITE = /^(commit|add|rm|mv|checkout|switch|restore|reset|revert|merge|rebase|cherry-pick|stash|clean|push|apply|am|tag|branch|gc|prune|filter-branch|update-ref|config)$/;
const GH_WRITE = /^(pr|issue|release|repo|secret|workflow|api)$/;
const GH_READ = /^(view|list|status|diff|checks|check-runs)$/;
// Commands whose path arguments are written to.
const FILE_WRITE = /^(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|install|shred|unlink)$/;

// Splits a command line into pipeline/list segments, then into bare words.
const segments = (cmd) => cmd.split(/\n|;|&&|\|\||\||&(?!>)/).map((s) => s.trim()).filter(Boolean);
const words = (seg) => (seg.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []);

function violation(cmd) {
  for (const seg of segments(cmd)) {
    // Output redirection to anything that is not a temp path or /dev/null.
    for (const m of seg.matchAll(/(?:^|\s)\d?>{1,2}\|?\s*([^\s|;&]+)/g)) {
      if (!/^&\d?$/.test(m[1]) && !isTemp(m[1])) return `redirects output to ${m[1]}`;
    }
    const w = words(seg).filter((x) => !/^\w+=/.test(x)); // drop leading VAR=value
    if (!w.length) continue;
    const cmd0 = path.basename(w[0].replace(/^['"]|['"]$/g, ''));
    const rest = w.slice(1);
    const args = rest.filter((x) => !x.startsWith('-'));
    if (/^(sed|perl|ruby|gawk)$/.test(cmd0) && rest.some((f) => /^-[a-zA-Z]*i/.test(f))) return `${cmd0} edits files in place`;
    if (cmd0 === 'tee' && !args.every(isTemp)) return 'tee writes to a file';
    if (FILE_WRITE.test(cmd0) && !args.every(isTemp)) return `${cmd0} modifies files`;
    if (cmd0 === 'git' && args.length && GIT_WRITE.test(args[0])) {
      if (args[0] === 'config' && !args.includes('--get') && args.length > 2) return 'git config writes configuration';
      if (args[0] === 'branch' && !rest.some((f) => /^-(d|D|m|M)$/.test(f))) continue; // `git branch` alone lists
      if (args[0] !== 'config') return `git ${args[0]} changes the repository`;
    }
    if (cmd0 === 'gh' && args.length && GH_WRITE.test(args[0]) && !(args[1] && GH_READ.test(args[1]))) {
      if (args[0] === 'api' && !rest.some((f) => /^(-X|--method)$/.test(f))) continue; // GET by default
      return `gh ${args[0]} ${args[1] || ''}`.trim() + ' writes to GitHub';
    }
  }
  return null;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let command = '';
  try { command = (JSON.parse(input || '{}').tool_input || {}).command || ''; } catch { process.exit(0); }
  const why = command && violation(command);
  if (!why) process.exit(0);
  process.stderr.write(
    `away-team-investigator is read-only: ${why}. Blocked.\n` +
    'Diagnose, do not patch: report the fix in your Diagnosis and let away-team-basher apply it. ' +
    'Throwaway scripts and scratch output belong under the system temp directory.\n');
  process.exit(2);
});

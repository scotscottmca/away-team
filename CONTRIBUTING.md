# Contributing

The guidance lives in one place rather than two: see [**Contributing** in the README](README.md#contributing)
for what to edit, what `npm test` checks, and why `dist/` is committed.

The short version:

- Edit `agents/`, `skills/` and `hooks/`. `dist/` is generated — commit it with the change that caused it.
- Run `npm test` before pushing. It lints, rebuilds `dist/` and asserts over the result.
- Node 20.19 or newer ([why](README.md#contributing)).
- Pull requests follow the house format in [`skills/pr-format/SKILL.md`](skills/pr-format/SKILL.md);
  `.github/pull_request_template.md` is that format as a fill-in.

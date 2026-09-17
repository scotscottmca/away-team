---
name: codemap
description: Template and rules for docs/CODEMAP.md, the persistent architecture map the mapper agent writes and investigator/basher read. Use when creating, refreshing or reading a code map, or when asked how a solution hangs together.
---

# CODEMAP.md

Purpose: let an agent answer "where is the thing that does X, and what must stay true around it" in under a minute, without re-reading the repo.

## Template

```markdown
# Code map: <solution name>
commit: <sha>   updated: <yyyy-mm-dd>   by: mapper

## What this is
Two to five sentences: the problem it solves, who calls it, what it calls.

## Stack
Languages, frameworks, runtimes, datastores, cloud services. One line each.

## Build / test / run
Verified commands only.
- build: `...`
- test: `...` (unit), `...` (integration, needs ...)
- run one test: `...`
- run: `...`

## Entry points
| Entry | Kind | Where | Notes |
|---|---|---|---|
| HTTP API | ASP.NET controllers | `src/Api/Controllers/` | JWT via `Auth/` |
| Queue consumer | Azure Function | `src/Workers/` | ... |

## Modules
One block per coarse module, 5 to 15 total.
### <Module>
Responsibility. Key types. Depends on. Depended on by.

## Data flow
One representative request per entry point, traced layer to layer to store.

## Data stores and external services
Tables or collections that matter, migrations location, external APIs and their client classes.

## Contracts
Where the sources of truth between layers live: OpenAPI specs, schemas, shared interfaces, module manifests, generated clients and what generates them. These are the seams a task can be cut along.

## Invariants and conventions
Things that must stay true, especially absences. "Only `Infrastructure/` talks to SQL." "Money is `decimal`, never `double`." Error handling, logging, DI, config, feature-flag conventions.

## Hot spots
Files with many importers, historically buggy areas, known debt.

## Testing map
Where tests live per module, shared fixtures, how to run a single test.
```

## Rules

- Names, not links. No line numbers.
- Answer "where" and "what must hold", never "what every file does".
- Under ~400 lines. Cut what changes weekly.
- `(?)` marks unverified claims.
- Refresh: compare `commit:` to HEAD; touch only sections whose paths changed.
- Any agent that moves a boundary, entry point or invariant updates the matching section in the same commit.

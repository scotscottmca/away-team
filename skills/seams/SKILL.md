---
name: seams
description: Cut a task that is too big for one small-context run into independent seams along the highest clean boundary (file, module, layer, service, contract), scope each with a handoff, run independent seams in parallel, reassemble with one proving check. Use when a bug or change spans many files, layers or services.
---

# Seams

A seam is a boundary where work splits so each piece needs little shared context. Cutting there keeps every run cheap.

## When to cut

- One run would need a large context: many files, long histories, big diffs.
- The task spans layers or services (client module → SDK → API client → service → upstream).
- Several independent changes are bundled in one request.

Do not cut when the task fits one specialist's context. Never split so finely that seams must share large context to make sense; that defeats the point.

## Ladder

Prefer the highest cut that cleanly splits the work.

1. **File / member** — independent files or functions.
2. **Module / package** — a cohesive unit with a narrow public surface.
3. **Layer** — UI, application, domain, infrastructure.
4. **Service** — a process or deployment boundary; cross it only over its contract.
5. **Contract** — an API, schema or interface is the source of truth; each side reconciles to it.

## Workflow

1. From `docs/CODEMAP.md` (modules, data flow, contracts), list the smallest set of components the task truly touches. Stop at the first boundary that isolates it.
2. Cut into seams that are each understandable alone and verifiable alone. Two to four seams; more means the cut is wrong.
3. Order by dependency. Independent seams run in parallel; dependent seams in sequence.
4. Write one handoff per seam (below).
5. Reassemble: say how the pieces recombine and name the single check that proves the whole.

If the contract itself must change, that is the first seam. Keep it stable while both sides change. Prefer reversible cuts; name irreversible ones.

## Handoff per seam

```
## Seam: <name>
**Goal:** one sentence
**Files:** only the paths this seam needs
**Contract:** the interface, schema or spec it must honour (path), and whether it may change
**Acceptance:** the check that proves this seam alone
**Return:** your standard report
```

# M1 — LAMBDA Instruction Has No NIA Cache in Hardware

## Priority
**Medium** — Functional parity exists (both hardware and simulator execute LAMBDA
correctly), but the simulator caches NIA lookups for hot lambda loops while hardware
re-runs the full mLoad-equivalent pipeline on every LAMBDA. Pure performance gap; no
correctness issue.

## Background
`replit.md` architecture overview states:
> "Key optimizations include a LAMBDA NIA Cache for leaf lambda execution."

`hardware/lambda_unit.py` implements a simple 4-state FSM:
`IDLE → READ_CR → CHECK_PERM → EXECUTE → COMPLETE`

Each LAMBDA reads the capability register, checks permissions, and sets NIA. There is
no caching of recent `(cr_target, gt_word) → NIA` pairs.

The simulator (`simulator.js`) caches the result so a tight lambda loop avoids
repeated NS/lump-header fetches.

## What the Cache Would Provide
A 4-entry direct-mapped or 2-way set-associative NIA cache indexed by `(cr_target,
gt_word)` (or `(cr_target, word1_location)`) would skip the READ_CR → CHECK_PERM
sequence for repeated LAMBDA calls to the same target. This reduces LAMBDA from ~4
cycles to 1 cycle for cached entries — critical for inner loops that use LAMBDA as a
tail call.

## Recommended Approach for V2

### Option A — Skip for V2, document the gap (recommended)
The NIA cache is a micro-architectural optimisation that does not change observable
behaviour. For V2 the priority is correctness and callhome functionality. Defer the
cache to V3.

Action: Add a `# FUTURE: add NIA cache (see docs/wukong-v2/m1-lambda-nia-cache.md)` comment to
`hardware/lambda_unit.py` and close the task as deferred.

### Option B — Implement a minimal 1-entry "last-LAMBDA" cache
Store the most-recently-used `(cr_target_reg, word1_location)` pair and short-circuit
to EXECUTE if it matches on the next LAMBDA. This covers the most common case (a
single LAMBDA in a tight loop) with minimal hardware cost (~3 registers + 1 comparator).

```
if lambda_start and cr_target == cached_cr and cr_value == cached_gt_word:
    NIA = cached_nia
    skip READ_CR, CHECK_PERM
else:
    full pipeline, update cache on EXECUTE
```

Cache must be invalidated on CALL/RETURN/CHANGE (because the c-list and GT values
may change across a context switch).

## Files to Change (Option B)

| File | Change |
|------|--------|
| `hardware/lambda_unit.py` | Add cache registers and bypass logic in FSM |
| `hardware/test_lambda_cache.py` | New: simulation verifying cache hit (1 cycle vs baseline 4), cache miss, and cache invalidation after CALL |

## Acceptance Criteria (Option B)
1. Repeated LAMBDA to the same target register takes 1 cycle (cache hit).
2. First LAMBDA or LAMBDA to a different register takes the full 4 cycles (cache miss).
3. CALL instruction invalidates the cache.
4. Fault behaviour is identical to the uncached path (NULL_CAP, PERM_X still fire).

## Risks (Option B)
- **Stale cache after context switch**: if CALL or CHANGE modifies the capability
  stored in `cr_target`, the cache entry is stale. Must invalidate on CALL, RETURN,
  CHANGE, TPERM (which can modify a GT's permission bits in place).
- **Synthesis overhead**: small but non-zero LUT/FF cost. For a minimal V2 Wukong
  build, this may not be worth it.

## Recommended Decision
Defer to V3. Document the gap. The performance difference only matters for programs
that use lambda-tail-call patterns at high frequency; the V2 demo programs will not
stress this path.

## Depends On
Independent of all other items.

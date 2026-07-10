---
name: Shared fetch dedup for concurrent UI lookups
description: When two independent UI features fetch the same detail endpoint for the same entity in the same render pass, tests asserting call counts will catch it — dedupe with a shared in-flight-promise cache.
---

Two independent render paths (e.g. a "Source" tab render and a best-effort audit/annotation lookup) can each legitimately want the same `GET /api/.../<id>/detail` payload for the same entity when a detail view opens. Adding a new best-effort fetch to one of them without checking for this overlap causes a duplicate network call.

**Why:** An e2e test asserting `expect(callCount).toBe(1)` for that endpoint exists precisely to catch this class of regression. It only surfaces when both code paths run together (e.g. in the full e2e suite), not in a unit test of either path alone.

**How to apply:** Add a module-level cache keyed by entity id that stores the in-flight (or just-resolved) `fetch(...).then(...)` promise; all callers await the same promise instead of issuing their own request. On rejection, delete the cache entry so the next caller can retry rather than being stuck with a poisoned failure. Expose the helper (e.g. on `window`) so multiple JS files can share it without a shared build/import system.

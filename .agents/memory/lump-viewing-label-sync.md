---
name: LUMP Viewing label sync
description: The "Viewing" label must update synchronously, never via deferred detail-data fetch completion
---

# LUMP Viewing label sync

## The rule
The lump "Viewing: <name>" label must be updated synchronously at every selection/render point — never wired to the completion of the detail panel's deferred data fetches.

**Why:** The historical bug wired the label update to deferred detail-data loading, so on page reload the label flickered or never appeared depending on fetch timing.

**How to apply:** When touching lump list/detail rendering, keep the synchronous label-update call sites; the update helper is idempotent (returns early when the registry has no data yet). While CR14 identifies a saved live LUMP, that live token is authoritative over browsing history so the green Live LUMP header and repository “Viewing” detail cannot show different identities. Cross-script functions in the classic-script UI are exported explicitly on `window` and called behind a `typeof` guard.

See also: docs/CM_LUMP_SPECIFICATION.md — Developer Traps and Implementation Rules section.

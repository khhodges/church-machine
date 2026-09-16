---
name: Canonical LUMP update leases
description: Durable concurrency and authorization rules for accountable canonical LUMP saves.
---

Canonical LUMP mutation leases are keyed by canonical dot-name identity, persisted under the selected LUMP store, and owned through server session state. Client-supplied operation identifiers are correlation data, not authorization. Holder metadata exposed to waiters must be a safe display label and must not include private account identifiers.

**Why:** Browser-tab locks and process-local registries do not serialize multiple workers. Trusting request-supplied owner identifiers lets another client impersonate a holder. A repository-wide request lock also hides contention and unnecessarily blocks saves for unrelated LUMPs.

**How to apply:** Keep drafts and ordinary editing private and unlocked. Route same-name contenders through one file-locked wait registry, renew while work advances, verify the reserved active revision again before activation, and hold the shared Namespace/publication lock only around the atomic compare-and-swap transition. Test with private LUMP directories only.
---
name: Mint CREATE RTL entry boundary
description: Full-source replay cannot assume simulator L views or all-ones token loading.
---
The user approved removing the all-ones credential escape: use normal
credential/proof checks and an explicit private scratch-row L binding, not
an Abstract-token exception in RTL.

**Why:** Even ordinary credentials unconditionally executed the unsupported
escape-reference LOAD before authorization. Fixing the source preserves
existing machine checks instead of widening token admission.

**How to apply:** Do not reintroduce the escape or assume simulator L-view
reduction exists in RTL. Test complete source through CALL/RETURN rather than
isolated result issuance. Never use bus remapping or forced continuations as
acceptance evidence.

Prepared private-binding evidence is not executable acceptance. Replay the
exact saved candidate, not a freshly rebuilt equivalent from a different
builder: the legacy dispatch-table emitter can fail before Mint entry even
when canonical-builder entry probes reach the scratch LOAD.

Lifecycle tests must acquire their stale token only after native issuance,
not pre-seed it into a boot-validated caller C-list.

**Why:** Strict boot validates the caller's declared capabilities before CREATE;
an unissued target fails there and never tests the intended lifecycle.

**How to apply:** Use a disposable caller-owned scratch row to capture the actual
issued token. Keep hard-fault branches in separate runs rather than bypassing a
fault to continue into reuse.

**Why:** Static geometry and pinned instruction hashes do not prove CALL can
decode a table entry; silently switching builders conceals that distinction.

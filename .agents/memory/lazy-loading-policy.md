---
name: Lazy loading selection and lifecycle
description: Approved-by-default fetching, explicit plus-marked test slots, and lifecycle scope.
---
Ordinary Lazy-load requests fetch the approved LUMP, not merely the latest
compilation. A `+` in the dot-name explicitly selects testing of a later LUMP
version, using a new slot rather than replacing the ordinary approved slot.

**Why:** The user explicitly distinguished approved runtime dependencies from
experimental later versions. Latest-compilation Development Image preparation
must not silently override this Lazy-fetch selection policy.

**How to apply:** Keep ordinary approved selection and plus-marked experimental
selection distinct. The exact plus-name grammar is not established by this rule.
Do not interpret the plus marker as a bypass of integrity or authority checks.

The Lazy-loading scope includes Lazy Resolve and Lazy Retirement, not only
fetching a missing body.

**Why:** The user explicitly included both lifecycle operations in the next design.

**How to apply:** Cover both in the design and acceptance criteria. Do not infer
that retirement means destructive deletion or slot reuse without a defined contract.

---
name: LUMP abstraction-name consistency check scoping
description: Why the abstraction-drift consistency rule only checks system-baseline, statically-slotted lumps against the live abstractions.js registry
---

The `abstraction` field in a lump's manifest/sidecar entry legitimately does
NOT match any name in `simulator/abstractions.js`'s registry for two whole
categories of lumps, not just as accidental drift:

- **User-compiled lumps** (`lump_version >= 1`) — arbitrary names chosen at
  compile time (StringOps, NoteG, IntegerOps, ...), never meant to appear in
  the static registry.
- **Dynamic/NULL lumps** (`ns_slot` is `null`) — e.g. WordString,
  PostFlashSelftest — allocated/fetched by token, never wired into the
  Abstractions view, so there is no registry entry to match by design.

**Why:** A consistency check that treats every `abstraction` field as "must
match the live registry" produces false failures on these categories even
though nothing is wrong — they were never supposed to match.

**How to apply:** When adding/adjusting drift-detection rules against the
abstraction registry, scope the check to `lump_version` 0/absent AND
non-null `ns_slot` only. Even after that scoping, keep one explicit,
documented exception set (e.g. `SlideRuleHS`, a pre-registry Haskell-variant
lump) for legitimate historical mismatches — anything else that fails is
real name drift, not a design gap. See `tests/lump/test_lump_consistency.py`
R16 (`KNOWN_NON_REGISTRY_ABSTRACTIONS`) for the reference implementation.

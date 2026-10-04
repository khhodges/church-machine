---
name: Archived bootstrap identity
description: How immutable bootstrap history is classified without treating legacy identities as valid current artifacts.
---

Archived frozen-resident bootstrap bytes remain immutable, but archive status does not exempt them from the live `T === sealed row-zero SELF GT === destination GT` identity contract. For bootstrap-provenance artifacts, classify ancestry by the abstraction's authoritative static resident assignment, not by matching the historical token or filename to the current binding. An exact, authenticated compiler revision without bootstrap provenance is a different case: residency or abstraction name alone must not impose the old frozen SELF contract on it.

**Why:** Pre-migration revisions can have a hash-derived record Token and a row-zero GT for an old slot. If audit resolves bootstrap status only through the current token/filename, those revisions look structurally valid and can be presented or restored as valid despite carrying incompatible authority.

**How to apply:** For current and historical snapshots, report the record Token, exact binary row-zero word, and GT derived from the live slot and sequence. Any inequality is a hard audit/restore failure that does not rewrite history and directs the IDE—not the programmer—to create a destination-bound revision. During an approved repair, validate against the server-derived replacement binding rather than the old occupant of that slot; an exact Namespace fingerprint must still prove the source state did not change.

Check exact compiler evidence before applying that bootstrap comparison, consistently with executable admission. Missing or invalid signatures must not create an exemption; genuine bootstrap provenance still requires the frozen comparison. This applies to inspection and History as well as image generation.

**Why:** A newly saved, compiler-authenticated CapabilityTest was admitted correctly but falsely marked “Bootstrap identity invalid” by inspection solely because of its abstraction ancestry.
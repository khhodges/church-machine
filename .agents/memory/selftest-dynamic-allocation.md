---
name: SelfTest dynamic allocation
description: Durable authority and placement rules for the canonical SelfTest resident LUMP.
---

SelfTest follows the ordinary non-bootstrap Resident LUMP model. Resolve exactly one non-archived manifest record that matches the single authoritative Namespace-state record by token, canonical filename, slot, issue, and hashes. Derive allocation from the validated LUMP header and E-GTs from the live Namespace slot and sequence. Only Boot.NS and Boot.Thread are protected placements.

**Why:** Historical address-token, fixed-slot, fixed-filename, and fixed-allocation shortcuts allowed stale approved bytes to diverge from current source and caused larger SelfTest bodies to overlap later Wukong residents.

**How to apply:** Any save, approval, stale check, boot generator, simulator fallback, hardware ROM, upload projection, or provenance report must consume the same active binding, reject archived or ambiguous records, and verify all final resident ranges are disjoint.
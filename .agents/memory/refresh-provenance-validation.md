---
name: Refresh provenance validation
description: Generic refresh evidence and legacy boot provenance are distinct valid formats.
---

Accept reviewed generic-refresh provenance using its full localized-artifact digest, not by demanding the legacy generation record schema or synthesizing missing evidence.

**Why:** A matching image checksum can still be rejected solely because a committed generic refresh records artifactBindings rather than versioned resident_bindings. Retain Namespace, immutable artifact, and localized-byte checks for both formats.

**How to apply:** Do not regenerate or overwrite a reviewed image to fix a reader/schema mismatch. Generic refresh tests must persist the returned prepared Namespace, including generated seals and compacted locations; the input rows are not the final fingerprinted state. Generic simulator fixtures may lack fixed hardware Thread slots, so isolate that separate profile gate when testing provenance.
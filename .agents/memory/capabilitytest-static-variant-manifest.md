---
name: CapabilityTest static variant manifest
description: How to retain older CapabilityTest binaries without making boot-image selection ambiguous
---

For a static Namespace slot with multiple tracked historical binaries, keep the
older records explicitly archived and put all same-slot variants in one
`variant_group`. The active record must name the exact binary and sidecar,
carry `ns_slot`, `ns_slot_policy`, and `boot_resident`, and agree with the
binary header and sidecar metadata.

**Why:** The boot-image tests select exactly one non-archived record, while
manifest drift and lump inventory checks still inspect tracked historical
files. Leaving an older sidecar's slot metadata implicit produces warnings;
deleting its manifest record makes the binary look orphaned.

**How to apply:** Use this pattern for future replacements of resident
CapabilityTest artifacts or other fixed-slot built-ins; do not make TPERM or
boot-image code choose between historical records.
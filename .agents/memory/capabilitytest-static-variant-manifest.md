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

The executable LUMP serving path must accept only hexadecimal token identifiers.
At startup, only token-named files may self-register; named binaries are
registered through the active manifest record, while archived variants remain
available only through explicit version-history routes.

**Why:** A historical filename can share a built-in abstraction's readable
prefix. Treating that prefix as a token makes an archive executable and can
silently restore obsolete instructions.

**How to apply:** Keep archival artifacts for provenance, but never expose
their filename as a runnable LUMP alias.

The physical Wukong factory CapabilityTest is a fixed 64-word image even when
the active Namespace slot 10 record is replaced by a larger simulator LUMP.
A release must not repoint the factory alias at the active larger binary or
drop the factory variant's archived manifest binding.

**Why:** A slot-10 replacement redirected the factory alias to a 512-word
binary. The main server then failed during `boot_rom` import before opening its
port.

**How to apply:** Treat the physical factory image and the active Namespace
record as separate same-slot variants; preserve the exact factory
binary/sidecar/hash binding through every replacement.
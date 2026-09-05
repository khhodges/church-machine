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

The Wukong standalone boot default must use the exact CapabilityTest selected
by the IDE's live Namespace state. Historical variants may remain archived for
provenance, but none has a privileged size, filename, issue, or executable
alias.

**Why:** A historical 64-word artifact was incorrectly promoted into a
factory rule. Replacing the active slot-10 program with a valid 512-word LUMP
then prevented the server from starting.

**How to apply:** Resolve the live slot-10 filename from Namespace state,
validate its binary against its sidecar and manifest record, and derive its
allocation from the LUMP header. Never hardcode a historical CapabilityTest.
# Phase 1 — hardware specification

## Read these first

1. **[Master ISA](01-isa/instruction-set.md)** — hardware rules and encodings.
2. **[Hardware acceptance](04-release/isa-to-fpga-alignment-plan.md)** — how to prove them.

## Authority

| Question | Answer comes from |
|---|---|
| Which objects occupy which slots? | **Namespace Table** — not a manifest |
| What must the hardware do? | **Master ISA** |
| Does this implementation conform? | **Tests and exact-bitstream evidence** |

Implementation behavior does not override the ISA. Software delivery does not
block the Phase 1 bitstream; hardware verification is still required.

## Current work

**Authorized:** hardware RTL implementation and simulation.
**Not authorized:** vendor builds, uploads, flashing, saved-artifact migration
or application changes.

Implementation is incomplete. A documented decision is not a passed test.
Older authorization statements describe their original decision only.

For testing, start with the acceptance plan's H01–H20 cases. Its explicit
blockers and the ISA's “Oracle closure” list must be closed before a complete
FPGA pass can be claimed. Software acceptance is listed separately as S01–S07.

This folder is self-contained. Keep local files and links current; do not add
a manifest, symlinks or historical documents.
Run `python3 scripts/check_phase_1_documents.py` to check local links.

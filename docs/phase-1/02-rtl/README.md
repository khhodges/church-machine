# Phase 1 RTL source snapshot

Copied on 2026-10-15 from the working hardware sources after the first instruction
RTL pass, with the checked handoff sources/tests refreshed on the same date.
This is Amaranth Python RTL source, not generated Verilog, a mapped
netlist, or a bitstream.

The `hardware/` directory contains the top-level Python hardware sources and
support helpers, plus the focused Phase 1 tests. The `tests/hardware/` directory
contains the indexed CALL regressions. The original 56-file collection now also
includes the checked handoff engine and its boot/scheduler integration tests;
refreshed files are exact copies of the working sources.

## Status and authority

- The [Master ISA](../01-isa/instruction-set.md) remains normative.
- The [acceptance plan](../04-release/isa-to-fpga-alignment-plan.md) defines release evidence.
- The first instruction pass has 88 passing focused simulations, not complete
  ISA or physical qualification.
- [Checked handoff evidence](checked-handoff-evidence.md) records the subsequent
  transition work and its explicit unresolved frame/fresh-root oracle boundary.
- Full CALL dispatch coverage, complete transition qualification, generated RTL verification,
  and timing/resource qualification remain outstanding.
- No saved images were migrated and no vendor build, upload or flashing was done.

## Use

This is a reference copy, not a second maintained implementation or standalone
build package. Continue development and run tests from the repository's original
`hardware/` and `tests/hardware/` paths. Helpers may depend on repository resources
outside this snapshot; do not run build or bridge tools from the copied folder.
No external data, credentials, generated outputs, caches or bitstreams are copied.

Refresh the copy explicitly when requested; never silently substitute it for the
working sources or use its presence as release approval.

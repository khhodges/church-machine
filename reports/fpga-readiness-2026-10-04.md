# FPGA readiness: first correction pass

## Scope and authority

The master is `docs/instruction-set.md`, with the explicitly selected
single-word indexing design. Multiword IDX1 is not a release option.
This pass does not certify the entire ISA or the currently flashed device.
No saved LUMP, Namespace, boot image, vendor bitstream, or board was modified.

## Completed source correction

DREAD and DWRITE now compare the complete word offset with the descriptor's
full limit field, rather than truncating both limit and address offset to
16 bits. Byte-address arithmetic retains its carry until validation and
rejects an address beyond the 32-bit bus instead of wrapping.

This preserves the existing instruction encoding, R/W permission checks,
Namespace-only M-device authority, and private initialization path. It does
not resolve the separate subtractive-index encoding or CR14 permission
questions. Large-address tests exercise the execution units; they do not
establish that the physical board has memory at every accepted address.

`tests/hardware/test_data_access_full_width.py` covers both units:

- Zero and last-valid offsets, including 65535, 65536, and the full
  descriptor limit.
- Literal and runtime-indexed accesses, with exact address and data checks.
- Offset arithmetic overflow and byte-address overflow.
- Permission rejection and M-device containment.
- No memory access, register write, or M write on rejected operations.

## Conformance observation correction

The generated-RTL baseline reported sixteen failing assertions, all from four
LOAD/SAVE overflow/underflow cases across Full/IoT Amaranth and generated RTL.
The units correctly faulted without accesses. The runner mistakenly compared
the truncated combinational index input with an expected absent effective
index, even though arithmetic rejection prevented the consumer from starting.

The runner now observes the real arithmetic-rejection signal and consumer
start signals. It retains the raw wire value separately from the rejected
index. A rejected index that starts a consumer or causes access remains a
failure. Regression tests also reject an unflagged wrapped index; no expected
instruction results were changed to match hardware.

## Checks

- Compact-index, SAVE-authority and immutable-SELF hardware tests: 38 passed.
- Full-width data-access tests: 26 passed.
- Combined runner regression, M-device, Namespace-issuance and full-width
  tests: 45 passed, one failed.
- The failure is
  `tests/gates/test_namespace_mbit_issuance.py::test_boot_default_uses_ide_selected_capability_test`:
  the selected manifest entry lacks `ns_slot`. This is catalog evidence,
  not a reason to mutate the saved image during instruction correction.
- After correcting observation, the shared runner exited successfully:
  285 passing cases and zero failures in each of simulator, Full/IoT
  Amaranth, and Full/IoT independently generated RTL. Each layer retains
  five blocked contract groups. Assembler and physical-board execution are
  untested by this runner. This subset covers conditions, MCMP equality,
  and compact index rejection; it does not certify full instruction
  transfers, the new data-access width correction, or Thread switching.

Reproduce the scoped checks:

```sh
python3 -m pytest tests/hardware/test_compact_index_core.py \
  tests/hardware/test_save_m_authority.py \
  tests/hardware/test_msave_immutable_self.py -q
python3 -m pytest tests/isa_conformance/test_contracts.py \
  tests/gates/test_m_bit_device.py \
  tests/gates/test_namespace_mbit_issuance.py \
  tests/hardware/test_data_access_full_width.py -q
python3 tests/isa_conformance/run.py --output /tmp/fpga-readiness
```

## Bitfield correction

The approved BFEXT/BFINS contract is now explicit in the master ISA:
width in bits 4:0 (1–31), position in bits 9:5, with BOUNDS rejection for
zero width or fields crossing bit 31. Existing assembly syntax remains
`DRd, DRs, #lsb, #width`; the historical width-first descriptions are superseded.
The FPGA source now uses that layout and gates writes/flags on valid fields.
Assembler operands are range-checked before truncation. The simulator and
disassembler already implement the approved layout.

The shared runner adds 66 bitfield vectors covering extraction/insertion,
boundaries, aliasing, DR0, invalid fields, and false predicates. Dedicated
assembler rejection and disassembly round-trip checks pass.
The expanded run passed 351 cases in each of simulator, Full/IoT Amaranth,
and Full/IoT independently generated RTL, with zero failures. Its 66 new
bitfield cases are included in that total. Invalid cases report BOUNDS.
Five unresolved contract groups remain; physical-board execution is untested.

## Remaining release gates

1. Reconcile unresolved master contracts before implementing new mappings:
   SAVE operand roles, bitfield reserved-bit policy, TPERM modes, and other
   indexed operands.
2. Port the agreed one-GT CHANGE semantics and verify both program-driven and
   M6-driven switching, fresh roots, continuation addressing, and rejection
   without partial context installation.
3. Extend successful-transfer differential and generated-RTL tests beyond
   the initial conformance subset. DREAD/DWRITE's new full-width tests are
   Amaranth unit tests, not generated-RTL or physical-board evidence.
4. Resolve catalog readiness separately, using explicit artifact-selection
   authority; do not silently rewrite stored binaries.
5. Generate and synthesize a source-pinned candidate only after its gates
   pass, then verify timing/provenance and the identified physical build.
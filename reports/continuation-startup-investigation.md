# Continuation BIT startup investigation — 2026-10-29

## Finding

The continuation build contains the original two-phase memory initializer,
not the separately validated address-issue correction. This omission is proven
from the frozen sources and manifest. Recurrence of the previously demonstrated
post-synthesis first-fetch defect is the leading explanation for this physical
startup failure. Its exact mapped implementation in this BIT is not yet inspected.

No board command, live Namespace/LUMP write, production RTL change, server restart,
rebuild, or programming operation was performed during this investigation.

## Physical and bridge evidence

The user programmed candidate-EXPERIMENTAL.bit through Vivado. Vivado reported
End of startup status HIGH. The subsequent bridge sentinel reports N_INIT 0x9C.
This differs from the old image's 0x85, although both advertise BUILD v20.

At 10:10:15 EDT, the monitor records BOUNDS at NIA zero. Its fault snapshot is
CRC16-valid and complete; the server reports correlated and promoted evidence.
Read-only retrieval of /api/fault-snapshot returned:

- All 16 capability registers (all three words each) and all DRs zero.
- NIA, PC, thread base, and STO zero.
- Stored CR12 telemetry 0xF900820C.
- Stored packed PC zero and stored M-flag telemetry 0xDEADAACF.
- Recovery not authorized.

Snapshot telemetry requires interpretation. With Thread base zero and CR5
location zero, the existing capture reads DMEM words 256, 0, 17, and 18.
The values at words 256 and 18 match the frozen image. The reported STO read
is zero, whereas image word 0 is 0xF8810100. This is strong evidence pointing
to the header/read path, not a complete physical memory dump or proof of the
internal metadata-reader error code.

The server's accepted top-level record is promoted/correlated, but its nested
candidate object still says pending. The monitor has a later explicit
fault_snapshot_correlated event. That presentation inconsistency is separate
from the hardware fault.

## The displayed LOAD is not proof of an executed LOAD failure

The guarded core can emit an early fault event in LOAD_NS, before Namespace
admission. Its trace uses the current instruction-fetch data. NIA zero and a
LOAD-shaped trace can therefore accompany a metadata admission failure.
The monitor explicitly says raw=unavailable and source=reference-bitstream.
The all-zero CR15 is consistent with failure before admission.

The earlier conversational description of this as a confirmed first-instruction
execution fault was too strong. The evidence establishes an early startup fault.

## Exact frozen-input checks

Package:
generated-artifacts/factory-continuation-bitstream/factory-continuation-build

- Packaged verify.py passed all frozen input checks.
- Image SHA256:
  e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102.
- Reconstructed all 2,460 initializer address/data pairs from the actual generated
  Verilog, filling omitted zero words. The result equals the complete 65,536-byte
  image byte-for-byte. 2460 & 255 equals the observed N_INIT 0x9C.
- Header/self words:
  F8810100 00000000 00000011 00000000 00000000 000000FF DEB25EEF 00000000.
- Frozen initializer SHA256:
  4397c052322e51df9682117afde40595297f9550048848402e96cab357bf60a1.
  This exactly matches the unchanged production two-phase initializer.
- The frozen top imports SparseMemoryInitializer directly. The manifest does
  not include sparse_memory_init_candidate.py. The three-phase correction
  is not selected in this build.

## Prior evidence explaining why this matters

See docs/phase-1/new-layout-25mhz-candidate.md, sections “First-word failure
localized”, “Isolated vendor comparison reported PASS”, and “Full-design
synthesized boot reported PASS”.

For an earlier, different full-design netlist, the retained investigation found:

1. Metadata word 0 was zero; the other seven inspected words matched the image.
2. The initialization ROM did contain the correct first header pair.
3. Mapped BRAM output-register and array enables read the startup zero output
   before the array's first read; that first array read skipped entry zero.
4. The old initializer reproduced this error in the isolated vendor comparison.
5. The separately selected AddressedSparseMemoryInitializer matched every pair.
6. A separate corrected full-design vendor replay reached its intended entry.

Those results apply to their retained inputs, not automatically to this new BIT.
The correction remained an experimental source overlay. The continuation
packager copied production sources without composing that overlay.

This explains how valid image bytes, a passing Amaranth recovery replay, and
positive implementation timing can coexist with this physical startup failure.
None of those checks independently proves the post-synthesis first write.

## New isolated checks

generated-artifacts/boot-fault-investigation/check_inputs.py:

- Exact image reconstruction: PASS.
- Namespace reader with the frozen image: done, no fault.
- Same reader with only word 0 changed to zero: fault, error 1 (metadata).

This test uses packaged hardware source plus the workspace shared architecture
contracts absent from that archive. It is a bounded hypothesis test, not vendor
or physical equivalence.

A full generated-Verilog replay was started, then stopped during compilation
after the prior vendor-mapping evidence was located. It produced no result.
Its pre-Vivado behavioral memory model would not close the mapped first-fetch
question; prior evidence explicitly shows that the faulty baseline can pass
that level of replay. No pass is claimed.

## Remaining proof and recommended correction boundary

For conclusive attribution to this precise BIT, inspect/replay its existing
routed or synthesized checkpoint with vendor functional memory models.
Observe the first accepted DMEM write and metadata words 0–7; compare the
complete write stream against the 2,460-pair oracle.

For an isolated replacement candidate, explicitly compose the already tested
initializer correction with the continuation correction and retain the exact
image. Before producing another BIT, require:

1. Full-design vendor-synthesized initialization: every address/data pair,
   especially first and last; nonzero first header at address zero.
2. Successful guarded boot using these exact combined sources and image.
3. The accepted bounded continuation-recovery behavior.
4. Fresh routed timing/DRC and hash-pinned provenance.

Do not compensate by changing the Namespace header, weakening admission,
injecting a header at runtime, or skipping the fault. Preparation of the
combined correction is a separate implementation decision; no such change
has been applied by this investigation.

# Next candidate stage: maintained core and trusted Boot integration

The user authorized this isolated code/test stage. The preceding memory/
admission stage passed its local checks; it did not connect ChurchCore.
Current integration is incomplete and paused at a failing recovery boundary.
See [implementation status](next-fpga-core-integration-status.md). No vendor
build or physical operations are authorized or claimed.

## Findings from maintained source

1. `hardware/core.py` exposes read-valid for the data bus but no general
   external memory-error input. Namespace/C-list interfaces also lack the
   fabric's explicit ready/error contract. Direct wiring would lose rejection
   information.
2. `hardware/dread.py` and `hardware/dwrite.py` have fixed transaction phases.
   A wrapper cannot assume withholding a read-valid signal or dropping a write
   makes those engines safely stall. Successful completion and register/flag
   writes must follow the actual accepted operation.
3. Fault handling already consumes `fault_memory_safe` and
   `dmem_write_granted`. These must reflect real memory ownership/acceptance,
   not constant approval or merely the presence of a request.
4. `hardware/fault_entry.py` binds an exact 64 KiB image and bounds its roots,
   descriptors, source save and activation to that aperture. The core also
   checks fault activation addresses against 65,536. Wiring the new RAM alone
   leaves those limits in place.
5. The fabric intentionally rejects MMIO and CPU access to staging.
   Existing valid peripheral accesses need a separate explicit device path;
   an address must never reach RAM by stripping its high bits.

## Proposed integration contract

### Normal access and rejection

- Connect all core data, Namespace, C-list and instruction-fetch paths through
  checked full-address routing. Preserve existing capability/version/type/seal
  checks and their established fault reasons.
- For an otherwise admitted ordinary RAM access whose physical address is
  misaligned or outside the allocation aperture, produce the existing
  **BOUNDS (0x08) HardFault**, with the real issuer and original Namespace/Thread
  attribution. Apply the same explicit rejection to ordinary instruction
  fetch outside its permitted ROM/allocation regions.
- Do not translate every fabric error into BOUNDS. Unknown MMIO, malformed
  internal operation combinations and recovery-path failures require their
  own identified path and existing disposition; stop for review if no applicable
  contract exists. No new numeric ISA fault code is proposed.
- No aliased access, fabricated successful zero read, silent dropped write,
  instruction skip, synthetic return, indefinite wait or automatic retry.
  BOUNDS here does not replace USER absent-body Lazy handling.

### Acceptance, timing and fault evidence

- Treat the local RAM response latency as a defined interface. Where the
  engine currently assumes a fixed phase, add the minimum explicit acceptance/
  error connection needed to prevent false completion. Do not build a generic
  bus-retry system.
- A write becomes accepted only when its actual selected destination commits.
  On rejection, suppress that operation's destination/register/flag updates
  and successful retirement. Keep legitimate earlier accepted effects.
- Preserve issue-time source identity and instruction evidence through the
  existing issuing engine. Freeze it before Boot stashing; no new intermediate
  fault-event register bank or live-input reclassification.
- Accepted writes must finish before recovery takes memory ownership.
  Fault entry must not report a refused write as granted. Verify same-cycle
  rejection/retirement and acceptance/fault edges explicitly.

### Boot, MMIO and stopped installation

- Parameterize bounds for the candidate's allocation area while preserving
  legacy defaults. Staging is never Boot context or executable storage.
- Use explicit trusted Boot Namespace/Thread inputs from the reviewed prepared
  image. Bind and validate the actual installed foundational descriptors before
  allowing execution; a host-supplied image hash is not that authority.
- Boot resumes its retained continuation with fault facts. The faulted caller's
  saved context remains evidence, not a context to resume.
- During Boot stash/activation, rejected memory operations follow the existing
  save-failure or catastrophic LED path as applicable. Do not recursively
  convert Boot-entry failure into another ordinary application fault.
- Preserve the existing guarded reset-ROM provenance and approved maintenance
  authorization/START boundary. Initial upload/scrub cannot race execution.
- Enumerate actual device addresses and preserve the existing supported device
  semantics. Do not implement stub peripherals to make startup pass.
- The concrete trusted-input selection and device map must be recorded before
  the integrated fixture runs. A conflicting mapping or incompatible Boot
  input stops preparation; no automatic grant or version repair.

## Scope of the proposed local work

1. Add an isolated candidate wrapper around the new foundation and maintained
   core, leaving the historical starter and frozen evidence reproducible.
2. Implement necessary core-facing acceptance/error routing with legacy
   behavior preserved outside the explicit candidate configuration.
3. Adapt and connect trusted Boot binding/fault entry to the larger aperture.
4. Test exact prepared disposable fixtures through real instruction execution.
   Initial fixtures may isolate memory/fault paths; they do not stand in for
   the final only-Amoeba-resident acceptance image.

Do not add Namespace-aware LUMP framing, multi-USER scheduling or fresh-Mallory
initialization in this stage. They follow after this connection is verified.
No vendor synthesis, board access, flashing, live data or saved-artifact changes.

## Required local evidence before stopping for review

| Case | Required observation |
| --- | --- |
| Legal high-bank access | Real core fetch/read/write reaches the intended high address, never its low-address alias. |
| Invalid ordinary access | BOUNDS with correct issuing instruction and origin; no target write, successful retirement or fabricated read result. |
| Fault while writes settle | Earlier accepted effect remains; rejected effect never commits; Boot stash starts only with safe memory ownership. |
| Cross-root fault | Faulted application identity is retained when Boot becomes active; Boot's retained continuation executes. |
| Boot-entry failures | Failed stash/activation reaches specified catastrophic indication without recursive fault entry or alternate targets. |
| Installation boundary | Core cannot fetch/retire while loading, hashing or clearing staging; admitted START is distinct. |
| Legacy behavior | Relevant existing local regression tests pass without rewriting historical images or receipts. |

No passing result is claimed for this stage. Any missing error classification,
unsafe handshake assumption or unresolvable trusted binding returns to design
review rather than being hidden by a test-only bypass.

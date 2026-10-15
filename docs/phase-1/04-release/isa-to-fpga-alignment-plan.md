# Red-ISA → simulator → bitstream → FPGA alignment

Finalized execution plan: 2026-10-11.
Working candidate name: **B.1.1+**. This label is not a build ID or certification.

## Current approved Phase 1 scope — 2026-10-14

Use the [reconciled Master ISA](../01-isa/instruction-set.md#approved-phase-1-contract)
and [Mint contract](../03-namespace-thread-mint/ide-mint-forge-contract.md). Older broad feature lists
below are inventory, not blanket Phase 1 requirements. No GC; direct CM-to-CM
and multiple IDEs deferred; two Namespaces/one FPGA networking tests are Phase 2.
One IDE/several CMs and working Mint/pkverify/controlled nstab remain software
delivery scope, not prerequisites for the Phase 1 hardware bitstream.
Use the ascending 256-slot default and half-FPGA-memory budget; CR13 untouched,
combined SWITCH, selectable elapsed-time watchdog (0.25/0.5/1/2 seconds,
initially 1 second with exemption enabled), and the approved TPERM changes.
No new T encoding, reset word or HARDFAULT machine word is silently selected.

Require RTL and exact-release-build physical FPGA evidence for the hardware
contract, including TPERM NULL/EXACT (NULL/NULL and skips included) and the
non-executable HARDFAULT word. Simulator agreement, IDE attribution and
exclusive Mint publication remain separate cross-layer/software acceptance,
not bitstream gates. Retain **Genesis override** as previously scoped. Record overrides as
overrides, not passed tests; no override is exercised by this plan.
Record all other pending evidence honestly. This document does not authorize
source implementation, migration, building, uploading or flashing now.

### Hardware-only acceptance reconciliation

This section supersedes any interpretation of the numbered cross-layer plan
below that makes compiler, IDE, simulator-feature or service completion a
prerequisite for the Phase 1 bitstream. Hardware tests may use independently
checked exact instruction words and controlled fixtures; production software
delivery is not required to establish their expectations. Test infrastructure
must still work and its inputs must be validated. Software failures cannot be
used to waive a hardware mismatch.

| Hardware area | Required evidence for the current contract |
|---|---|
| Decode and indexed execution | All three CALL forms; compact LOAD/SAVE, SWITCH and DREAD/DWRITE; indexed BRANCH and BFEXT/BFINS. Check field separation, malformed/retired encodings, DR0 and all index selectors, signs, boundary magnitudes, register overlap, predication, flags and checked arithmetic before effects. |
| Capability and context enforcement | Required type, permission, generation, integrity and bounds checks; approved 9-bit generation equality without hardware mutation; Namespace geometry; runtime mLoad checks rather than a whole-C-list scan; validated Thread save/load and reserved CR13 behavior. |
| Boot and handoff | Immutable reset parameters, matching version-pair admission, one-shot marker consumption, slot-2 activation, final CALL CR0 and ending ROM-fetch authority. Include mismatch, replay, failed admission, cold boot and hardware reset. |
| Watchdog controls and timing | All four selector codes, bootstrap control 0x5, retained controls across hardware reset, fresh intervals, deferred selection changes, atomic exemption exit, INVALID_OP on reserved bits, deadline-equal write rejection, renewal rules, instruction-fault reporting priority and counting through stalls. Measure actual clock/timing tolerance. |
| Write containment and recovery | At most one accepted program write awaiting completion; no new writes after expiry; protocol-proven bounded completion before validated Thread-save memory use; no retry, partial-instruction completion or rollback. Missing completion must not trigger recovery writes. |
| Exact hardware artifact | Matching source/ROM/configuration provenance, reset initialization, actual mapped behavior, resource and timing reports, board pin/clock constraints, exact bundle hashes and physical observations tied to the programmed bytes. |

This is an acceptance checklist, not a pass report or an exhaustive replacement
for the Master ISA. Retain distinct **not run**, **failed**, **passed** and
explicitly **overridden** outcomes. Field-packing arithmetic and documentation
checks cannot satisfy RTL, synthesis or physical acceptance.
Shared arithmetic, immutable configuration and serialized writes are selected
engineering directions; their resource/timing results remain unmeasured.
Exact MMIO placement and accepted-write latency still require integration
evidence, not guessed constants.

Keep build qualification separate from physical qualification: a successfully
built bundle is not board-tested. Neither this reconciliation nor completion
of the documentation authorizes implementation, a vendor build or programming.

## Goal and authority

One explicitly approved architectural contract, implemented consistently by the
compiler, simulator and FPGA, with evidence tied to the exact delivered bytes.
This is the primary project objective, not a side investigation.

Finalizing this plan does not approve every red-text proposal or authorize
flashing, destructive replacement, or a vendor build in this turn.
Previously approved decisions remain binding. Unresolved architectural choices
require explicit resolution; implementation behavior is not a substitute.

## System Namespace and open-ended handoff

The approved direction now extends beyond proving the three-LUMP loop:
required startup diagnostics → a reprogrammable, checked handoff to a
**System Namespace** → system feature validation → admitted application
Namespace(s) and entry Threads.

The [standard handoff contract](../03-namespace-thread-mint/system-namespace-handoff-contract.md) defines
the draft requirements and unresolved mechanisms. System validation covers lazy
loading, cooperative multithreading, Namespace garbage collection, I/O extensions
including Ethernet/HDMI, **IDE tunnels, networked Church Machines (CMs)**,
application rules/contracts, and privileged services
including ide.Mint. Delivery and activation are separate; IDE reload and future
lazy loading must not introduce incompatible handoff paths.

These requirements apply across the gates below. Record feature-specific
supported/deferred status and exact simulator/RTL/FPGA evidence. A passing 3LL
alone is not proof of application handoff or these system features. Inventory
the full A7 board rather than only the minimal MMIO implementation.
This direction does not allocate new slots, approve extra boot-resident LUMPs,
enable dormant Mint, or authorize physical operations. Detailed handoff and
dynamic-identity contracts remain to be resolved before implementation.

IDE tunnels and CM-to-CM networking need separate acceptance evidence from
Ethernet connectivity: authenticated peers/sessions, scoped operation authority,
destination-local admission, disconnect/reconnect, peer restart, replay and
lost-reply handling. The frozen local T === GT rule does not establish
cross-machine identity. Neither networking nor a local handoff implies approved
execution migration or distributed atomicity.

## Starting evidence

- B.1 and B1.1 have remote-build records in uploaded terminal transcripts.
  The corrected October 8 B1 package is historical build evidence, not evidence
  that subsequent boot CHANGE and factory-root corrections were synthesized.
- `reports/initializer-reset-faithful-validation.md` records passing reset-faithful
  initializer/full-system functional replay, not whole-chip timing or board proof.
- `reports/boot-change-correction.md` records scratch-free boot CHANGE, factory
  root preparation and boot/method-dispatch behavioral checks.
- `reports/root-frame-candidate-review.md` records the executable-limit correction
  and passing candidate behavioral replay. No replacement approval was frozen;
  fresh elaboration provenance and release review remained outstanding.
- `reports/isa-seven-items-review-proposals.md` and
  `reports/church-consolidated-contract-proposal.md` contain both agreed directions
  and unresolved proposals. Their draft status must not be silently promoted.
- Existing workflow failures must be triaged against the selected source baseline;
  earlier focused passes do not establish that the current release suite is green.

## Ordered gates

### Mandatory evidence: golden layout and architectural checkpoints

The user approved this requirement on 2026-10-11. It applies across Gates 1–6,
not as an optional diagnostic after a failure.

**Independent authority:** derive expected bits and transitions from the approved
ISA and frozen candidate inputs, with independent layout/encoding checks. The
simulator supplies observations, not a self-certified golden dump. Do not reuse
the implementation's encoder or state-transition helper as the sole oracle.

Freeze a machine-readable golden layout and a human-readable address/field map:

- Namespace Table geometry, slot order, occupied and empty entries, and every
  defined bit of the four words per entry: type-specific authority, generation,
  bounds, location, integrity and identity.
- Exactly the three selected resident LUMPs, identified by immutable hashes:
  placement, headers, instructions, embedded data/source where present, padding
  and destination-localized C-Lists. Retain original portable bytes separately.
- Thread saved registers, protected indicator, Heap boundaries, poison roots and
  prepared continuations.
- Explicit byte/word address units, serialization endianness and region extents.
  Distinguish required zeros from architecturally unspecified bits/regions.
  Every comparison mask needs a contract justification; unknown simulation bits
  in defined state fail rather than becoming zero or being silently masked.

Maintain distinct, correlated records for the generic image, resident projection
and actual elaborated initializer. Validate the specified transformations between
them; never substitute one as proof of another.

| Checkpoint | Required comparison |
|---|---|
| Initialization complete, before execution | Every defined memory bit and required initial register state; exact accepted initializer writes |
| Each boot instruction retirement | All CR words, DRs, NZCV, next-instruction location, memory deltas and preserved state |
| Prepared program entry | Thread authority, executable identity, C-List, root/continuation and bounds |
| Each CALL, RETURN and CHANGE | Frame/stack transitions, authority restoration and permitted writes |
| Full test loop and repeated loops | Expected results, stable stack and no unintended state drift |
| Selected faults | Fault identity and location, atomicity and defined recovery effects |

Retain complete initial snapshots plus reconstructible checkpoint deltas and
accepted write-event logs. Final-state equality alone cannot detect an
unauthorized write subsequently overwritten with the original value.
Use deterministic test inputs; explicitly model permitted device observations.
Do not obtain readback by reading side-effectful MMIO as ordinary RAM.

Each mismatch must report checkpoint/occurrence, byte and word address or
register, owning object/field, expected value, actual value, XOR differing bits
and unexpected write events. Retain the first divergence and its evidence.
Bind the baseline and observations to contract, source, input and artifact hashes.

Reuse the same independently checked expectations for simulator, RTL, synthesized
replay and FPGA readback. Synchronize by architectural retirement/checkpoint,
not equal clock counts. Hardware captures must be coherent and correlated to the
exact programmed artifact and occurrence; document any instrumentation effects.
Publish a per-layer coverage table: PASS, FAIL, UNOBSERVABLE or NOT RUN.
Unobservable required FPGA state is a release evidence gap, never an inferred
pass. Resolve the observation gap or explicitly revise the approved acceptance
scope before claiming physical acceptance.

### 1. Freeze the approved ISA and binary contract

Reconcile the red review, current normative ISA, and recorded user decisions.
Produce an approved/deferred/unresolved decision ledger, exact encoding vectors,
fault precedence, state effects and preserved-state rules.

Resolve at least the identified open areas: TPERM special-mode encoding and NULL
precedence; Namespace geometry/self-view bounds; resident kind and protected
context representation; nonresident representation; member placement/framing;
CALL/LAMBDA/RETURN/CHANGE continuation and applicable compiler ABI.
Do not reopen settled choices without evidence of a conflict.
Deferred features must be explicitly unsupported, not silently implemented.
If an unresolved choice affects boot or executable bytes, stop that branch here.

**Exit:** one versioned contract with no contradictory active definitions for
the release scope. Historical text and artifacts remain evidence only.
Golden-layout fields, comparison masks and checkpoint expectations are defined.

### 2. Align compiler, simulator and IDE

Use that contract to complete the instruction/state/fault matrix.
Verify immediate and DR-indexed operands, predication, malformed and retired
encodings, permissions, bounds, GT type-specific fields, flags, and atomic faults.
Include EXACT, Thread roots, boot CHANGE without CR8 scratch, CALL dispatch,
RETURN continuations, LAMBDA and scheduler/recovery behavior in the agreed scope.
Keep experimental IDX1 success separate from normative conformance.

Compare against independently authored expected results, not just a shared
implementation that could reproduce the same bug in both models.
Reconcile IDE instruction descriptions and binary inspectors with this contract.
Triage existing failing tests; repair stale fixtures only against approved
semantics, never weaken an assertion simply to get a pass.

**Exit:** release-scoped simulator/compiler tests pass, each excluded failure has
an explicit non-release rationale, and no unresolved failure can affect the
candidate's bytes, execution, authority or verification.

### 3. Prepare and freeze the exact B.1.1+ inputs

Prepare a new isolated candidate from explicit selected LUMP revisions.
Preserve historical B.1/B1.1 snapshots and live catalog bytes.
Verify root frames, prepared Thread entries, exact executable bounds, SELF and
destination-localized C-Lists, Namespace membership, layout and integrity.
Run the full intended boot and repeated CapabilityTest → SelfTest →
WukongCallHome path against this exact candidate, checking returns and faults.

Freeze Namespace, all selected binary hashes, boot entry, source commit,
architectural contract version and complete hardware inputs through the approved
revision mechanism. No mutable filenames may select downstream build inputs.

**Exit:** an approved immutable input revision, with simulator evidence tied to it.
Its frozen golden layout and simulator checkpoint comparisons must pass.
Any later input change creates a new candidate and invalidates affected evidence.

### 4. Prove RTL and synthesized functional agreement

Regenerate from the frozen inputs. Compare simulator and RTL committed effects
and faults using the same binaries and independent contract expectations.
Run instruction conformance, method dispatch, boot CHANGE and full boot/loop
replay. Verify reset fidelity, complete initializer writes, all relevant CR
triples, no unauthorized writes, and correct continuation restoration.

Replay the actual release-generated hardware and appropriate synthesized model.
Label behavioral, optimized word-level, mapped-module and full mapped evidence
separately. No partial replay, timeout, unknown-bit forcing or stale generated
RTL counts as a pass. Retain commands, hashes, logs and explicit outcomes.

**Exit:** fresh provenance and passing release-scoped functional evidence for the
exact approved inputs. A prior mapped initializer alone does not certify the chip.
Required RTL and synthesized checkpoint comparisons must pass against the same
golden expectations used for the simulator.

### 5. Build and qualify the bitstream

After build authorization, use a clean, pinned remote build directory and the
approved inputs. Run only one vendor build at a time, with two worker threads.
Require successful synthesis/implementation, correct board pins and clocks,
no blocking DRC violations, nonnegative setup/hold timing and explicit completion.
Generate both .bit and .mcs; record hashes, tool version, timing, source,
Namespace revision and embedded version identity in a complete release bundle.

**Exit:** a verified downloadable B.1.1+ bundle. This means built, not board-tested.
Include the golden-layout/checkpoint baseline hashes and verification reports
in the release evidence bundle.

### 6. Validate the exact bundle on the FPGA

After explicit programming/board-operation authorization, program the selected
artifact and record its identity. Check startup, cold/warm reset, stepping,
repeated intended loops, CALL/RETURN, CHANGE, agreed fault/recovery behavior and
selected boundary/negative cases using a reviewed hardware test procedure.
Correlate trace/snapshot evidence with exact artifact identity and instruction
occurrences; a version label or post-stop register snapshot alone is insufficient.

Compare observable effects and faults with simulator/RTL expectations, allowing
latency differences but not semantic differences.

**Exit:** retained physical-board acceptance report tied to the exact bundle.
Required FPGA checkpoint/readback comparisons must pass; unresolved observation
gaps must not be hidden by passing simulator or RTL results.
Only then call this release aligned across ISA, simulator, bitstream and FPGA.

## Failure and scope control

Stop at the first failing gate, retain the failure and diagnose it at the earliest
responsible layer. Do not patch historical evidence, silently substitute a LUMP,
widen authority, or skip a gate to make progress look complete.
Rerun affected downstream gates after corrections, not unrelated verified work.
Keep UI enhancements and unrelated features outside this release sequence.

## Immediate next action

See the [candidate-readiness review](bitstream-candidate-readiness.md)
for the inspected baseline, retained-test triage, bounded implementation sequence
and required System Namespace handoff acceptance cases. Its disposition is not
ready for synthesis; historical passes are not fresh candidate certification.

Complete Gate 1's decision ledger against the red-ISA and the latest candidate
review, then inventory current conformance gaps and failing release tests.
Do not launch another bitstream build until its contract and frozen input gates
are satisfied. This prevents an older successful build from being mistaken for
the corrected B.1.1+ release.

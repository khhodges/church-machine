# Ordinary full-core Thread activation: proved; System handoff acceptance blocked

## Updated hardware evidence (2026-10-11)

The permission blocker characterized below is fixed for ordinary CHANGE.
`hardware/ordinary_change.py`, selected explicitly by `hardware/change.py` and
the full core, consumes the single permissionless Inform GT. It does not invoke
the scheduler, synthesize L/S authority, elevate the Namespace gate, or enter
the boot window. Nonzero permissions and legacy indexed instruction words fault.
The supported word is the existing assembler one-operand spelling (equal
register fields and zero immediate); this does not migrate historical binaries
or approve an IRQ-return encoding.

Read-only admission validates the sealed, generation-matching destination
descriptor, Thread allocation, protected indicator, non-poison continuation,
Enter GT, executable bounds, C-List SELF and resolvable Inform rows, and saved
register homes. Abstract locks and unoccupied rows retain their meanings.
Incoming data and capabilities are staged internally before any outgoing write.
Rejected contexts leave the architectural registers and memory unchanged,
including CR8. Boot and the external scheduler retain their separate paths.

The full-core fixture now first executes ordinary CHANGE CR12 into a prepared
bridge. Only this successful activation establishes ownership. The bridge then
executes SWITCH and CHANGE CR13, suspends into its own backing memory, activates
the destination-only Thread, and retires its IADD with DR1=37. The source table
has no target Thread descriptor and has a conflicting executable binding.
The test verifies the complete target register checkpoint, consumed transition
M bit, exact 32-write suspension/pop ledger, and retained poison roots.
Independent cases cover CR1/CR12/CR13, all seven nonzero permission combinations
in both domains, malformed frames/C-Lists, stale generation, bad seals, poison
roots, and self-target continuation without accumulating frames.

The probe also corrected a measurement error in its earlier harness: production
ChurchCore NIA and imem_addr are absolute byte addresses, not CR14-relative
offsets. Instruction fetch now uses actual imem_addr. Frame NIAs are absolute
word addresses and are checked against the resolved executable's byte range.
This matters because an apparent CHANGE completion with relative NIA zero
cannot pass the real fetch fence or retire the destination instruction.

Reproduction:

```sh
python3 -m pytest tests/gates/test_namespace_handoff_core.py \
  tests/gates/test_namespace_handoff_probe.py hardware/test_boot_change.py \
  hardware/test_wukong_thread_scheduler_contract.py -q
```

**This is ordinary activation evidence, not System handoff release approval.**
The opt-in `CM_REQUIRE_NAMESPACE_HANDOFF=1` gate remains deliberately
fail-closed. Interrupted-write recovery, first-fault/epoch retention, transition
authority reacquisition and execution-time writer exclusion are still separate
unproved obligations. No simulator Namespace-resolution change, live LUMP
replacement, release RTL generation, bitstream build, or FPGA operation is
claimed.

## Historical blocker characterization (superseded by the evidence above)

Date: 2026-10-11

**Disposition: STOP. The proposed handoff is not proved safe or executable.**
This is the stop-and-report outcome requested by the first-pass handoff
definition, not approval to change the ISA or use a scheduler substitute.

## What actually ran

`tests/gates/namespace_handoff_core_fixture.py` runs the production ChurchCore,
decoder, register file, SWITCH and CHANGE units in Amaranth. Three ordinary
retirements end the boot microcode window. A one-time test deposit supplies
admitted initial capabilities and scoped CR15.M; it does not prove admission,
regulator issuance, delivery, or ownership of a running bridge Thread.
After the deposit there are no debug writes, host table-base repairs, scheduler
requests, synthetic completion signals, or direct execution-unit starts.
Instruction words are fetched from CR14.base + NIA in the frozen fixture image.
The data bus supplies synchronous responses and records every accepted write.
The core ties CHANGE write completion high, so each asserted write is accepted.
This does not model a fault-capable or backpressured physical memory bus.

The initial active-owner flag is **false**, explicitly included in all
checkpoints. Ordinary CHANGE cannot activate the bridge either: its
permissionless operand encounters the same instruction-path blocker. Setting
ownership or invoking the scheduler to get past that blocker would not prove
the requested ordinary instruction handoff.

## Independent fixture geometry

All addresses below are **bytes**; limits and Thread offsets are **words**.
Descriptors ascend at root + 16 × slot, in order base, limit/sequence,
integrity32(base, limit), zero. Sequence is zero. Each root reserves 64
descriptors (1024 bytes); the fixture is not the JS descending-table image.

| Region | Address / size | Cross-view rule |
|---|---|---|
| Source table | 0x2000 / 1024 bytes | slot 11 absent |
| Destination table | 0x3000 / 1024 bytes | slot 11 target Thread, slot 12 target code |
| Bridge Thread | 0x4000 / 256 words | shared slot 1 |
| Target Thread | 0x5000 / 256 words | destination-only slot 11 |
| Bridge executable + C-List | 0x6000 / 64 words | shared slot 2 |
| Target executable + C-List | 0x7000 / 64 words | destination-only identity at slot 12 |
| Recovery Thread | 0x8000 / 256 words | shared slot 4; execution not proved |
| Conflicting source executable | 0x9000 / 64 words | source slot 12, deliberately different |

Slot 3 describes the destination root under both views. Only slots 1–4 are
shared. These are synthetic objects, not admitted LUMP revisions. Region
non-overlap, destination-only membership, and the conflicting binding are
asserted. Shared physical objects do not establish recovery authorization.

Threads independently use header 0xF900820C, homes 244–255, stack 212–243,
heap 18–211, protected indicator at 17. Prepared suspension indicator is 0x10EF;
frame at 241 is 0x10F1 and E-GT at 240 selects the executable. The retained
poison root at 242/243 contains the E-GT and `(0x7FFF << 13) | 0x10F3`.
Bridge indicator is 0x10F1. A successful target would pop to 0x10F1 and start
at code word 1, retaining the poison root.

## Full-register and accepted-write results

Tests compare every 96-bit CR, all 16 DRs, packed flags, NIA, all 16 M bits,
active owner and backing address against explicit checkpoints. Initial flags
are Z=1, other flags zero; DRs are zero. The fixture freezes the exact initial
CR triples; `golden_active()` separately specifies the intended target state.

| Boundary | Actual result |
|---|---|
| Before SWITCH | initial seeded snapshot, CR15 source, M word 0x8000 |
| SWITCH denied M | PERM_L (4), complete snapshot unchanged, zero writes |
| SWITCH succeeds | only CR15 becomes `[0x1A000003, 0x3000, 63]`, M becomes zero, NIA advances to 4; zero memory writes |
| Ordinary `CHANGE CR1` | PERM_L (4), **not activation** |
| Ordinary `CHANGE CR12` / `CHANGE CR13` | PERM_S (5), **not activation** |
| All three CHANGE failures | CR8 becomes `[0x0200000B, 0, 0]`; all other registers retain the post-SWITCH state; zero memory writes |
| Eight cycles holding each fault | complete failed snapshot stays stable; no target retirement |
| Reboot before / after SWITCH | identical boot-initialized register snapshot, NIA zero, only CR12.M set; fixture memory unchanged |

The changed CR8 is recorded as a partial register publication, not repaired or
ignored. Fault numbers describe observed implementation behavior, not proposed
normative precedence. No destination Thread descriptor read occurs before the
CHANGE faults. Consequently these cases cannot establish destination lookup,
frame validation or target-authority containment.

## Why the proof stops

The master ISA requires one permissionless Thread GT, no implicit indexing,
and no L/S permission requirement. The current full-core wiring passes raw
destination/source/index to ChurchChange. Its paths still select L-authorized
C-List operations or S-authorized privileged-register installation; CR14/15
select the scheduler-style path. Changing the operand to an L capability,
issuing a legacy indexed CHANGE, or asserting `thread_switch_req` would evade
the requirement rather than satisfy it.

The seed-only context also is not an owned live Thread. A legitimate ordinary
activation must establish that ownership before outgoing suspension can be
tested. No context writes were reached; we did **not** inject fictitious
faults/reset into an unreachable context-save phase and count them as tests.

## Frozen next-stage write and recovery obligations

`golden_owned_writes()` records a candidate 32-event ordered ledger for a
properly activated bridge: 12 GT homes at 244–255, E-GT at 240, frame at 241
(continuation PC=2, prior STO=241, SZ=1, Z=1), indicator at 17 (STO=239),
16 DR homes at 1–16, then target indicator at 17. No other address is allowed.
This is a proposed checkpoint contract, **not observed write evidence**.

For every accepted event and every prefix, the eventual test must interrupt
before and after acceptance, retain exactly the accepted prefix, and reject
unapproved writes or execution. There is no permission to roll back that
prefix in the harness. Test incoming pop and register publication separately
from outgoing save; do not infer instruction or pair atomicity.

Unresolved guarantees requiring approval/evidence:

- How recovery gains control with destination CR15 but the bridge still live,
  and with partially serialized or restored context; sharing CR13's descriptor
  alone proves neither handler entry nor authority.
- How first-fault evidence and machine/request epoch survive explicit reset.
  The observed boot initialization is not completed diagnostics or recovery.
- What happens to the saved bridge continuation at PC=2. It still references
  the transition C-List and target operand; it must not be resumable in a way
  that repeats activation or exports transition authority.
- How execution-time exclusion protects both views and the target from writers.
- After successful CHANGE, full target registers, zero transition M/grants,
  first target retirement, and failed attempts to reacquire bridge authority.

First-target and all write-boundary tests are **blocked**, not passed or silently
waived. No successful handoff, recovery handler, two-selection acceptance,
malformed/stale target coverage, or cross-layer geometry equivalence is claimed.

## Reproduction and gate semantics

```sh
python3 -m pytest tests/gates/test_namespace_handoff_probe.py \
  tests/gates/test_namespace_handoff_core.py -q
# Observed: 9 passed, 1 skipped (the opt-in acceptance gate).

CM_REQUIRE_NAMESPACE_HANDOFF=1 python3 -m pytest \
  tests/gates/test_namespace_handoff_core.py -k require_full -q
# Observed: exit 1, HANDOFF BLOCKED, ordinary CHANGE fault 4.
```

Characterization success reproduces the blocker. It is **not release
acceptance**. Even after the permission fault disappears, the opt-in gate stays
fail-closed until owned suspension, interrupted writes, recovery and first
target retirement are implemented and verified.

No production source changes, live LUMP replacements, vendor builds, generated
RTL claims or FPGA operations were performed.

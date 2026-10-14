# HARDFAULT candidate verification

Status: **Genesis selected `0xF7000000` after reviewing this evidence. Compiler
lowering remains disabled; integration and physical acceptance remain open.**
Release approval is deferred by the user; closing this investigation does not
authorize emission, deployment, or hardware use.
The approach approved in [the ISA](../instruction-set.md#standard-software-hard-fault)
and [Mint draft](MINT-CODE-DRAFT.md) remains unchanged. No compiler, simulator,
decoder, runtime fault handling, live LUMP, or hardware image was changed by
this investigation. Only isolated tests and documentation were added.

## Encoding returned and selected

**`0xF7000000`**, bytes **`F7 00 00 00`** in a big-endian LUMP.

* Bits 31:27 = `11110` (30), the existing **WORD inline-data** encoding.
* Payload bits 26:0 = `0x07000000`.
* Bits 26:23 = `1110`. Though WORD has no architectural condition field, the
  current simulator decodes these payload bits as **AL (always)** before
  dispatching to its WORD rejection.
* Remaining condition-shaped operand bits are zero. There is no operand
  access, CALL, scratch register, runtime report, or HALT.
* Existing assembler `WORD 0x07000000` emits this exact word; disassembly is
  `WORD 0x7000000`. This is an investigation fixture, **not advice to author
  intentional faults without an exact-artifact map**.
* `HARDFAULT PASSKEY_MISMATCH` remains an assembler error. No emission is enabled.

WORD is preferable to consuming an unassigned opcode that might later gain
execution semantics. Nevertheless, tests cannot bind future ISA decisions.
Genesis's selection reserves **this exact word as permanently non-executable**,
including future simulator/profile/decoder revisions.
Identical data bytes can also be reached accidentally: neither this word nor
INVALID_OP alone proves an intentional software fault.

### Why not simply WORD 0?

`simulator/simulator.js` checks `checkCondition(d.cond)` before its opcode-30
INVALID_OP branch. `0xF0000000` therefore skips when Z is false. The negative
control reproduces that behavior. RTL's `ChurchDecoder` rejects opcode 30
without consulting flags. This broader WORD discrepancy is **not repaired**
here; choosing the AL-shaped payload avoids it for the proposed exact word.
Zero itself is HALT in the simulator and is not a candidate.

## Executable evidence

Run from repository root; these commands only use process-local simulator state
and Amaranth simulation. They need no server, Namespace publication, board
connection, flashing, or persistent LUMP writes.

```sh
node simulator/test_hardfault_candidate.js
node simulator/test_fault_code_navigation.js
node simulator/test_fault_snapshot_labels.js
python3 -m pytest hardware/test_hardfault_candidate.py -q
```

Results observed: all three Node commands passed; **10 Python cases passed**.
These are focused standalone investigation commands, not a claim that the
full release suite or physical acceptance suite passed.

### Simulator: verified at the execute/fault boundary

The candidate test uses real address calculation/fetch, `step()`, `fault()`,
and immutable evidence capture over isolated memory. It stubs the `mLoad`
Namespace admission result; Namespace permission/admission and a real
compiler-produced artifact are not under test. The fixture supplies a
synthetic secure artifact identity.

Across all **16 N/Z/C/V combinations**:

* The exact candidate raises `INVALID_OP`, numeric code `0x0B`, and returns no
  successful instruction result.
* All CR objects, DRs, flags, PC, STO, call stack, and simulator RAM remain
  identical across the fault. DRs carry nonzero sentinels.
* `halted=true`, `running=false`; a second `step()` does not fetch or execute
  the following nonzero instruction, and does not create another fault.
* The retained record contains the candidate word, zero-based code PC **1**,
  physical word address **0x902**, complete header/code words, original
  artifact identity, and pre-fault CR/DR/flag snapshots.
* Replacing code/identity and resetting the simulator does not alter that
  retained record.

The real `fault()` implementation halts at first fault; it does not invoke a
reporting CALL or fault recovery. Existing diagnostic snapshots contain
registers, but this investigation does **not** endorse exposing those values
in the approved static HARDFAULT reason map.

### Elaborated RTL: verified boundary and explicit integration assumptions

`hardware/test_hardfault_candidate.py` covers both full and IoT profiles:

* Two decoder cases reject opcode-30 words under every condition-shaped
  payload, including the candidate, as `INVALID_OP`.
* Eight core cases cross profile, deferred/default reset, and negative/zero
  pre-fault flag state. Real arithmetic seeds all writable DRs and retires
  16 instructions before the candidate, beyond the three-retirement boot
  window. CR0–CR11 are seeded through simulation-only ports while fetch is idle.
* At fault, `retire_fault_valid=1`, `retire_nia=64` (**byte address**),
  `retire_instr=0xF7000000`, and retire flags equal the pre-fault flags.
* All 16 three-word CR snapshot buses, all 16 DRs, flags, M-bit state, and
  isolated-M flags remain unchanged at the fault edge; DMEM, Namespace, and
  C-list write enables are zero. Latched `fault_instr` contains the candidate
  and `fault_stage=1` (decode).
* With deferred reset and **testbench fetch gating after the fault edge**,
  NIA stays at 64 and the observed state stays unchanged for 20 further cycles.
* With default reset, NIA becomes zero at the fault edge and the next reset
  cycle clears state. This is reset, **not return or continuation**.
  Pre-fault capture must occur before reset; post-reset preservation is false.

These are Amaranth elaborated-RTL simulations, **not independently generated
Verilog/CXXRTL replay, synthesis, timing analysis, or physical FPGA tests**.
The seeded flag states exercise N and Z, not all possible RTL flag
combinations. Snapshot ports expose three CR words plus M state, not every
private/internal implementation register.

**The core is not itself an indefinitely halted machine.** Its deferred path
holds NIA on the fault edge; an integration must prevent subsequent fetch.
The testbench deliberately models that requirement rather than claiming an
intrinsic halt latch. Source inspection of `hardware/wukong_top.py` finds:

* `core.defer_fault_reset=1`;
* fault retirement feeds the step/fault-recovery control;
* `recovery_hold` gates `core.imem_valid`;
* reason-2 snapshot capture retains NIA, flags, CR and DR snapshot buses.

`hardware/core.py` also exposes immediate retire NIA/instruction and latched
instruction/stage, but `fault_gt` and `fault_cr14` remain zero placeholders.
The separate architectural CR14 snapshot must not be confused with that
placeholder field. A complete top-level fault-to-snapshot test remains open.
Explicit reboot and privileged one-shot Skip Fault are separate existing
operator actions, not a return emitted by this candidate.

## IDE attribution: what can and cannot be claimed

Simulator `fault()` captures `executionArtifact`, `executionOccurrence`,
`faultCodeWords`, `faultRawWord`, origin PC and register/flag snapshots.
`simulator/app-run.js` persists these evidence fields.
`simulator/app-lumps.js::_revealFaultInstruction` requires:

1. matching 64-hex binary hashes and captured `identity.secure === true`;
2. equality of the **entire captured header/code section**, not just the
   faulting word;
3. a matching instruction word at a valid LUMP code offset.

The new test feeds actual simulator-captured candidate evidence into that
existing IDE helper. It highlights **LUMP +2**, converting simulator code PC 1
to header-relative word offset 2. Different hashes, changed surrounding code,
wrong offset, and absent identity fail closed. Existing navigation tests also
cover asynchronous opening, divergent source, and leaving the draft unchanged.
These are isolated helper tests, not a browser or production end-to-end run.

Thus the IDE **can match a captured simulator instruction to registered exact
artifact identity plus complete loaded code**, when those inputs exist. This
does not independently attest the supplied identity, compare every localized
C-list/body byte, or authenticate a map. Synthetic test hashes are not
cryptographic artifact verification.

Hardware retire NIA is byte-addressed. Simulator memory and LUMP offsets here
are word-addressed. For hardware mapping, use the **captured code capability
base and exact installed layout**, verify alignment/bounds, and compute the
header-relative offset `(faultNIA - codeBaseBytes) / 4`. Never use a later live
CR14, current slot occupant, latest catalog revision, or editor selection to
infer the historical origin.

Hardware snapshot fields alone do not carry the simulator's secure artifact
identity and complete code evidence. Raw NIA/CR14 or a matching word cannot
establish the exact loaded artifact. This investigation has **not proved**
hardware-to-IDE exact-artifact attribution or serial delivery.

There is currently **no HARDFAULT reason-map emitter, serialization contract,
authenticated map lookup, or intentional-site classifier**. Existing
disassembly attribution is useful infrastructure, not the approved feature
already implemented. Without exact identity and a matching site map, retain
raw INVALID_OP/location/word diagnostics; do not invent a reason. Static
reason/method/source-line/explanation must never be reconstructed from current
registers or export proof/private-authority material.

## Selection and enablement gates

1. **Selected by Genesis:** `0xF7000000`, permanently non-executable.
   This approval does not waive the remaining enablement gates.
2. Specify and bind static fault maps to exact immutable compiled artifacts.
   Test missing/stale/tampered maps, identical-word accidental INVALID_OP sites,
   multiple offsets/methods, and mismatching identities before enabling emission.
3. Verify full target integration: deferred fault fetch suppression, original
   NIA/CR14/word capture, snapshot transport, installed-artifact provenance,
   and unit-correct IDE offset attribution. Default-reset targets need a
   pre-reset capture solution or an explicit unsupported status.
4. Keep any generated-RTL and physical acceptance evidence separate.
   **Physical behavior is NOT VERIFIED; no board was flashed or contacted.**

No runtime implementation gap has been silently “fixed” or accepted as PASS.
The returned result is a selected encoding with isolated evidence and explicit
integration and attribution limits, to resolve before compiler emission.

## Deferred release validation

The user approved moving forward with release approval deferred. Completion
validation twice failed to reach a terminal result within its monitoring
budget while `wukong-release-bundle` and `method-dispatch-rtl-release` were
running. Those checks are **outstanding, not PASS**. The release checker allows
up to four hours; no successful release result is inferred from a timeout.

The unrelated canonical-dot-name fixture errors uncovered by the first
completion attempt were corrected with user approval. The four affected
Python test files passed together (61 tests), and the three related Node
checks passed. On the second completion attempt, all configured checks other
than the two still-running release checks reported PASS.

The isolated candidate evidence above remains valid. Re-run and obtain
terminal release results before release approval; additionally satisfy the
map, target integration, and physical acceptance gates appropriate to the
intended use. Deferring release approval does not waive any of those gates.

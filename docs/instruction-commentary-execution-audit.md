# Instruction commentary execution audit (task3531)

Implementation and isolated regression evidence; this document does **not** mark
the task complete. No user workload, source, or binary was modified.

## Simulator evidence contract

Every active `step()` attempt has a reset epoch and monotonically increasing
`occurrenceId` (`epoch:sequence`), independent of PC and architectural step count.
Returned results have `executionEvidence` before the `step` event is emitted.
The evidence and all nested records are copied and frozen:

- `version: 1`, `epoch`, `occurrenceId`
- `instruction: { raw, decoded, physicalPC }`: the actual fetched word and
  physical fetch address, not a post-CALL/RETURN address. Null if no fetch occurred;
  HALT has raw zero and decoded null.
- `pre`, `post`: DR and CR arrays, flags, logical and physical PC, step count,
  call depth, STO, halted state, and artifact context.
- `pre.artifact` / `post.artifact`: code capability, namespace slot, resident
  header word, and a copied resident slot identity record (binary/identity hash,
  generation and token when registered). An absent identity remains explicitly
  null: label or program name is **not** a verified artifact hash.
- `programName`, `programLabels`, and artifact label are frozen presentation
  context, not independent proof of artifact identity.
- `outcome`: `retired`, `skipped`, `fault`, `suspended`, `rejected`, `interrupt`,
  or `aborted`; `fault` carries the actual fault type and message.
- `description`: actual executor result description, or actual fault message.
- `effects`: observed DR writes (including DR0's retirement zeroing), and normal
  DREAD/DWRITE data transactions with exact effective offset/address/value.
  Data writes include the prior memory word for non-MMIO destinations.

Register snapshots are not full memory snapshots. Effects are not a universal
bus log: abstract-manager and special MMIO intercepts may provide their exact
outcome only through the executor description and register snapshots. Never
invent an unrecorded memory value or peripheral read from these records.

Faults retain their historical null return contract. `sim.lastStepEvidence`
provides the attempt after `step()` returns, including fetch/decode faults.
Existing fault events can precede final evidence; consumers must not substitute
a prior attempt's evidence while a fault is still being handled. Idle halted or
already-suspended polls do not create occurrences. Reset clears last evidence
and advances the epoch. External references to old evidence remain immutable.

## Opcode audit

| Opcodes | Execution-derived commentary assessment |
| --- | --- |
| LOAD, SAVE | Capability source/index and validated label are captured in executor locals. No DR reverse inference. Suspended/rejected returns are explicitly distinguished from retirement. |
| CALL, ELOADCALL, XLOADLAMBDA, RETURN | Transfer descriptions use executor targets/frame locals. Historical `eventLocation` now uses pre-transfer PC/context and exact fetch address rather than mutated CR14/PC. Both boundary identities are retained. |
| CHANGE | Context restoration details come from the executed validation/restoration path. Evidence retains both register banks. |
| SWITCH | Destination M admission is not source-M authority. Fixed a successful CR12 non-Thread probe description being overwritten by the generic success description. Guarded CR15 no-op remains explicitly described as such. |
| TPERM | Flags and permission-test outcomes come from actual checks; failure of a test is not automatically an execution fault. |
| LAMBDA | Saved and new STO and capability label are executor locals. |
| DREAD, DWRITE | Offsets and values are captured before destination writes; indexed offset is base plus unsigned DR index, saturating before validation. Immediate mode uses unsigned imm14. DWRITE does not infer the input from memory after writing. |
| BFEXT, BFINS | Source, destination old word, position and width are captured before writes. Corrected range prose to conventional `[high:low]`, LSB=0. BFINS now reports the actual resulting word as well as inserted low bits. Invalid fields fault without claiming success. |
| MCMP | Both unsigned operands captured before flags update. |
| IADD, ISUB | Both operands were already captured before `_writeDR`; keep these exact inputs even when destination aliases either operand. Register operands are u32; immediate selector bit14 chooses **unsigned imm14**, not signed imm15. Results display modulo-2^32 u32; flags reflect the executor computation. |
| BRANCH | Signed imm15 offset is captured and bounds checked; target is pre-PC plus offset, not post-PC plus offset. |
| SHL, SHR | Source, low-five-bit amount, carry-out and result captured before writes. SHR bit5 selects arithmetic versus logical; displayed results are u32. |
| Reserved / WORD | Fault outcomes, not successful instruction explanations. |
| HALT / false conditions | HALT's exact zero word is retained. Skips have unchanged operand registers/flags and an explicit skipped outcome, not a hypothetical result. |

DR0-target DREAD, BFEXT/BFINS, IADD/ISUB and shifts now distinguish the computed
value/flags from the final discarded destination (`DR0=0`). This does not change
the simulator's write/retirement semantics. Explanations must not reverse-engineer
pre-state from post-state: aliasing, overflow, shifts, masked writes, returns,
faults and DR0 make that inference invalid.

## Isolated validation

`node simulator/test_instruction_execution_evidence.js`

Covers arithmetic aliases (left/right/both), negative/wrapped results,
unsigned immediate boundary, DR0, logical/arithmetic/zero shifts, aliased
bitfields and bit numbering, indexed DWRITE and DREAD actual values,
skips, invalid-op/bitfield/null-capability faults, repeated-PC loops, reset
epochs, guarded SWITCH, real CALL/RETURN boundaries, emission timing and
artifact-identity immutability after later metadata mutation. Memory tests use
an explicitly synthetic authority gate, not a user workload.

The simulator file is also checked with `node --check simulator/simulator.js`.
Visual/UI validation and task completion remain with the owning agent.
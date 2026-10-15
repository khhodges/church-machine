# Independent Phase 1 RTL fixtures — initial results

## Instruction RTL update

The three confirmed failures are corrected: indexed CALL recognition and
checked row/method operands, runtime BFEXT/BFINS positions, and executed
CHANGE CR13 rejection with INVALID_OP before effects.
DREAD/DWRITE now use the common signed-magnitude offset and capture their
index at acceptance. BRANCH uses the approved DR-indexed 18-bit magnitude
with checked byte-address/code-fence bounds. IADD/ISUB stay unsigned.

**88 focused simulations pass:** 40 independent fixtures, 34 new operand
fixtures, three indexed-CALL regressions, three TPERM regressions and eight
retired-opcode checks. Evidence is from a combined run plus targeted reruns of
corrected fixture assertions/additions; no RTL behavior changed after the combined run.
Fault trace events carry `retire_fault_valid`; they are not successful retirement.
The corrected tests require exact fault origin/code and unchanged state across
the fault edge, rather than incorrectly requiring all trace events to disappear.

Old indexed CALL words are explicitly rejected. Existing saved images and
application compilers were not migrated. Static method-table BRANCH descriptors
use the new encoding; dynamic/conditional descriptor forms are rejected rather
than interpreted through the old 15-bit format.

The acceptance-boundary operand implementation uses extra combinational
read/arithmetic paths rather than a new staged frontend. This engineering
refinement is recorded in the Master; resources/timing remain unmeasured.

This is not complete ISA qualification: full runtime method dispatch, all
frame/continuation cases, combined CHANGE/SWITCH transition completion, exact
generated/mapped RTL and physical evidence remain outstanding. No vendor build,
upload, flashing or live image changes occurred.

## Pre-update fixture findings (superseded by the RTL results above)

Command:
`python3 -m pytest hardware/test_phase1_independent_execution.py -q`

Current suite: **40 cases; 37 passing and 3 known failures**.
The latest targeted run passed all ten unsigned-immediate cases; the other
30 cases retain their unchanged prior results (27 passes, 3 failures).
No xfail conversion. This is cumulative evidence, not a claim that all 40
cases were rerun after the immediate clarification.
These are Amaranth simulations, not generated/mapped RTL or board evidence.

| Coverage | Observation |
|---|---|
| H02 decoder conditions | All 15 defined conditions × 16 NZCV states, with valid asserted/deasserted, pass. NV remains unspecified. This does not prove condition-skipped core side effects. |
| H01 IADD unsigned immediates | 0, 1, 8191, 8192 and 16383 pass, including exact data/flags, NIA advancement, unchanged CRs, no memory writes and no duplicate retirement. `0xAF087FFF` means +16383; `0xAF086000` means +8192. |
| H01 ISUB unsigned immediates | Subtract 0, 1, 8191, 8192 and 16383 from zero. Exact results and NZCV pass, including no-borrow C=1 for 0−0 and negative results for positive subtrahends. |
| H01 DR0/aliasing | Destination DR0 stays zero; DR1←DR1+1 uses the pre-write value. Pass. |
| H01 MCMP | Three independent greater/equal/less cases pass full NZCV and no-data-write assertions. |
| H02 core skips | NE with Z=1 skips IADD, SAVE through NULL, CHANGE CR13 and an invalid-range BRANCH, preserving DR/CR/flags and preventing memory writes. Four cases pass. |
| H03 indexed CALL recognition | `0x1714C000` sets approved indexed bit18, row DR2 and method DR3. Decoder reports `call_indexed=0`; expected 1. Execution coverage remains outstanding. |
| H03 LOAD arithmetic | Five core cases check DR11±magnitude and DR0 indexing against the first memory address; underflow/overflow must fault before any read. Selected NULL rows prevent capability installation. Pass. |
| H04 BFEXT position index | `0x97098821`, DR2=4, DR3=32: expected bit at position 4+1 = 1; observed 0. |
| H07 TPERM unit | Eleven NULL/EXACT cases pass: literal and nonzero/B-set NULL, Inform/Abstract non-NULL, reserved modifier31, one/both NULL EXACT, equal/unequal non-NULL. These prove unit Z/fault/no-CR-write behavior, not full-core NZCV or encoding conformance. |
| H06 permission gate | Isolated generation equality across all 512 encodings, every one-bit generation mismatch, all 32 seal-bit mismatches and denied W through an R-only GT. This is not proof of GT extraction, integrity calculation or integrated bounds. |
| H05 RETURN encoding | All 4,096 keep masks decode unchanged. No execution/frame-validation claim. |
| H09 executed CHANGE CR13 | `0x276E8000`: expected immediate reserved-operand INVALID_OP `0x0B`; observed fault `0x07` at cycle3. Pre-fault CR/DR/flags and no-memory-write assertions pass. |

**Resolved on 2026-10-15:** The user explicitly selected unsigned IADD/ISUB
immediates, 0–16383, preserving existing hardware behavior. The Master and
independent expectations now use zero extension. The two former signed-
interpretation failures were specification-restoration errors, not approved
RTL defects; their old observations are superseded by this explicit decision.
Indexed sign/magnitude formats are unaffected. No production RTL was changed.

Fixtures use independent literal words/expected results, three checked real
retirements after boot, a nonzero destination sentinel and deferred fault reset.
They assert data writes, capability preservation, memory-write absence and
retirement identity. No compiler or decoder generates the expected values.

## Coverage limits and remaining work

| Group | Status of this new suite |
|---|---|
| H01 | Partial; ten unsigned-immediate ADD/SUB cases, DR0, aliasing and three MCMP vectors. Arithmetic overflow, all ordinary opcodes and all register positions remain. |
| H02 | Complete defined decoder truth table; four core skip vectors only. Full cross-product instruction-effect coverage remains. NV is blocked on its oracle. |
| H03 | Five LOAD arithmetic/access-boundary cases plus failing CALL recognition. SAVE/DREAD/DWRITE/BRANCH and complete CALL execution remain. |
| H04 | Failing runtime-position BFEXT vector; BFINS and boundary/fault cross-product remain. |
| H05 | Complete keep-mask decode space only. Protected frame/indicator and LAMBDA continuation expectations remain oracle blockers; do not infer them from legacy return shortcuts. |
| H06 | Isolated equality/seal/permission gate only. End-to-end extraction, Namespace integrity calculation, bounds and MMIO still require Phase 1 fixtures. |
| H07 | Execution-unit NULL/EXACT tests only; broader preset packing and full-core NZCV/first-fault cases remain. |
| H08 | Not implemented here. Full context-fault injection requires explicit private-frame fixtures; fault-code assignment tests alone do not cover triggers. |
| H09 | Executed and skipped reserved-CR13 cases only; positive/negative CHANGE/SWITCH activation and authority fixtures remain. |

Generated/mapped RTL replay and physical evidence are **not covered**.
Existing suites must be reconciled against current Phase 1 expectations before
their results count toward coverage. The broader instruction-test task remains
in progress; this report does not close it or qualify a release.

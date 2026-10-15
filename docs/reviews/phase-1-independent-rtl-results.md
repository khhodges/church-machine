# Independent Phase 1 RTL fixtures — initial results

Command:
`python3 -m pytest hardware/test_phase1_independent_execution.py -q`

Observed across the 30-case run and four subsequently added cases:
**29 pytest cases passed, 5 failed** (34 total). The four additions were tested
separately without changing the earlier fixtures. No xfail conversion.
These are Amaranth simulations, not generated/mapped RTL or board evidence.

| Coverage | Observation |
|---|---|
| H02 decoder conditions | All 15 defined conditions × 16 NZCV states, with valid asserted/deasserted, pass. NV remains unspecified. This does not prove condition-skipped core side effects. |
| H01 IADD immediate +1/+8191 | Pass, including exact data/flags, NIA advancement, unchanged CRs, no memory writes and no duplicate retirement. |
| H01 IADD immediate −1 | Literal word `0xAF087FFF`: expected `0xFFFFFFFF`, observed `0x00003FFF`. |
| H01 IADD immediate −8192 | Literal word `0xAF086000`: expected `0xFFFFE000`, observed `0x00002000`. |
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

The current Phase 1 Master specifies signed immediate payloads; the hardware
and existing shift-test setup use unsigned payloads. This is a conformance
conflict, not evidence that the expectation should be weakened. Resolve the
contract/implementation difference explicitly before asserting qualification.
The signed wording was restored from the archived encoding reference, not
from a separately recorded explicit sign-selection approval. Changing the
interpretation changes existing instruction words; user confirmation is needed
before treating these two failures as approved RTL-change requirements.
Production RTL and the Master were not altered by this test slice.

Fixtures use independent literal words/expected results, three checked real
retirements after boot, a nonzero destination sentinel and deferred fault reset.
They assert data writes, capability preservation, memory-write absence and
retirement identity. No compiler or decoder generates the expected values.

## Coverage limits and remaining work

| Group | Status of this new suite |
|---|---|
| H01 | Partial; positive, negative-immediate, DR0, aliasing and three MCMP vectors. Arithmetic overflow, all ordinary opcodes and all register positions remain. |
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

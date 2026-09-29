# Instruction commentary / trace audit (task3531)

Implementation inventory; task status is not changed by this document.

## Presentation paths

| Path | Evidence and treatment |
| --- | --- |
| `app-misc.js`: `_cmDecodeWord`, `_instrPlainEnglish`, `_instrRoleAnnotation` | Static word decoding only. English explicitly says symbolic, with execution/operand values unavailable and encoded predicate shown. Corrected DWRITE operand direction, immediate/register arithmetic, source shifts, packed bitfield geometry, RETURN mask, SWITCH and LAMBDA semantics. ABI roles distinguish CR5 instance data, CR6 C-List, CR12 Thread, CR13 IRQ. |
| `_cmBuildDisasmHtml` rows, expanded rows, callhome spotlight | All share the symbolic English helper. Boot caches/current memory are reference disassembly, not historical operand evidence. |
| `_chlogNsSlotName` | Removed live simulator namespace fallback for hardware callhome labels; fixed boot-map names remain reference labels. |
| `app-cr-detail.js`: `_codeViewCallContext`, `_indexedCallTarget`, `_decompileWord`, C-list tooltip | Code listings copy the displayed allocation's words and report its indexed C-list row as literal `GT 0x…`, or `unresolved C-list target` when absent/out of bounds. A GT or embedded capability declaration is not proof of a named abstraction's identity: no mutable Namespace label, token resolver or CR0 alias is used to name the target. Static descriptions do not mutate `crPets`. SAVE reads CRdst and writes its GT to CRsrc's C-list row; LAMBDA uses CRdst without overwriting it. |
| `app-lumps.js`: Content listing `_autoComment`, C-list annotation | Auto-comments use the same static decoder with the displayed artifact words; disassembly/annotations use exact GT or unresolved row text, not current Namespace identity. Authored method comments take precedence and remain unchanged. ELOADCALL's low five immediate bits select the row; method zero is the fast path. |
| `app-run.js`: `_callReturnInstructionLocation` and drilldown | Use event/context identity and captured instruction only. No live memory, namespace owner, namespace labels or call-stack fallback. Preserve NIA, event-supplied label, depth and raw word. Missing data stays unavailable. Browsing surrounding memory is explicitly current-memory reference. Zero CR values remain visible. |
| `_appendSimulatorStepLog` | Retains the result's immutable `executionEvidence`, prefers its recorded description, never reads newest `lastStepEvidence` for old rows. CALL/RETURN identity remains eventLocation-based. |
| `_wukongNormalizeEvent`, `_wukongFormatEvent`, `_wukongTraceLocationText` | Existing hardware metadata/correlation fields retained. Formatted instruction decode explicitly symbolic; operand effects unavailable. Flags/GT payload are observed fields, not inferred operand effects. |
| Hardware CALL_PUSH/RETURN_POP links | Capture original event and displayed depth before execution advances; cloned log rows retain drilldown handlers. |
| `_wukongBuildHwFaultObj` | No longer fabricates fault CR snapshot from simulator/current HW-mirrored registers. Full CR/DR bank unavailable for trace-only faults; missing flags remain unavailable. |
| Hardware snapshot/fault persistence and identity correlation | No changes to identity matching, sequence/epoch checks, promotion, or accepted snapshot selection. A snapshot is not promoted to operand-effect evidence by commentary. |

## Evidence boundaries

Hardware GT trace events and full register snapshots now update a separate,
labelled board-register display, never software simulator CR/DR state.
Reconnect/server restart clears those observations. CALL/RETURN drilldowns
use only the selected event's GT payload, not poll-level latest registers.
Trace-only hardware operands remain unavailable.

Simulator occurrence evidence includes captured memory/register-home writes
and identifies discarded DR0 results. Rolled-back SWITCH writes are not
reported as committed effects. Synthetic tests cover the reported
ISUB/IADD/DWRITE/SWITCH sequence, repeated occurrences, resets and transfer
boundaries without modifying user programs.

Static descriptions specify intent, not proof that predicate, permission checks,
memory access or control transfer succeeded. Incomplete hardware trace packets
cannot establish numeric operand effects. Full fault snapshots remain separate
observations under the existing correlation rules.

Simulator execution evidence is produced by the simulator-owned implementation:
`result.executionEvidence` is the frozen per-attempt record. This UI consumes the
recorded description and retains the object; it does not reconstruct historical
effects. No execution behavior or workloads are changed.

## Isolated regression coverage

Static semantics also cover LOAD/SAVE C-list rows, CR6-indexed CALL, packed
ELOADCALL row/method (including method-zero fast path), XLOADLAMBDA's full
row immediate, DREAD/DWRITE immediate versus base-plus-DR addressing,
unsigned 14-bit IADD/ISUB immediates and arithmetic flags despite DR0
discarded writes, signed 15-bit BRANCH displacement relative to instruction
PC, SHR sign-fill versus zero-fill, TPERM presets/attenuation, invalid
bitfield geometry and CHANGE destination modes. The original SAVE arrow
CRdst → CRsrc[row] matches the simulator: encoded destination field A is
the capability being saved, not the destination C-list. No extra runtime
dependencies are introduced. The existing CALL/RETURN resolver regression now
requires unavailable data instead of reading live simulator memory. The log
renderer uses recorded `executionEvidence.post.stepCount` when the result has
no step count; its link retains the recorded pre-transfer event location.

Run `node tests/simulator/instruction_commentary_trace_audit.js`. Tests deny all
live simulator/ownership access, check missing hardware operands and captured
identity, cover symbolic predicates and corrected operand semantics, and assert
the simulator evidence and hardware event capture wiring.

For static-listing coverage, run `node simulator/test_truthful_instruction_comments.js`
and `node simulator/test_indexed_call_annotation.js`. These exercise symbolic
signed branch offsets (−1 for `0x7FFF`), SAVE direction, packed indexed
methods, repeated rendering, exact-allocation changes and throwing Proxy
guards against live Namespace/token/cache reads. Mismatched or missing declared
names cannot replace the displayed allocation's literal GT; absent rows
remain unresolved. They do not assert historical execution outcomes.
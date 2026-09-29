# Instruction commentary: static audit (task 3531)

This records the static-listing portion, not task completion. References:
`docs/isa_reference.md`, `docs/isa_encoding.md`, and the corresponding
`_exec*` implementations in `simulator/simulator.js`. No authored comments,
binary words, Namespace entries, or execution behavior were changed.

## Evidence contract and inventory

| Producer / consumer | Available context | Policy |
| --- | --- | --- |
| `app-cr-detail.js` `_decompileWord` | Instruction word; optional exact-allocation C-list context | Returns `kind: static`; symbolic operands only, no live DR/CR/device reads or inferred historical arithmetic |
| `_codeViewCallContext`, `_indexedCallTarget` | Copied displayed allocation and embedded capability declarations | Preserve GT validation; absent/mismatched metadata yields unresolved target or literal GT, never CR0's earlier alias |
| `app-memory.js` code listing | Displayed allocation | Static meaning column; passes exact call context |
| `app-cr-display.js` both code tables | Displayed allocation | Static meaning column; both pass exact call context |
| `app-lumps.js` `_autoComment` | Displayed artifact words and embedded API | Uses shared symbolic decoder, not live capability aliases; authored method comments remain untouched |
| `app-lumps.js` branch pre-scan | Instruction words | Correct opcode 23, not DWRITE opcode 17 |
| Register hover/popups | Current simulator register state | Live inspection only; not input to instruction commentary |
| Simulator execution and hardware trace renderers | Separately owned occurrence evidence | Must not use static commentary as proof of retirement or a software snapshot as hardware evidence |

Static expressions describe what an instruction means **if executed and accepted**,
not whether it ran. Conditions remain symbolic. No executed/skipped/faulted outcome
is inferred. Instruction-zero and LUMP headers remain omitted from decompilation.
Removing linear CR alias propagation also avoids claiming that an unexecuted or
conditional LOAD proves the target of a later register CALL.

## Opcode audit

* LOAD/SAVE: source/destination direction corrected in the LUMP commentary;
  conditional/faulted operations do not assert actual transfers.
* CALL: indexed targets use only exact displayed C-list evidence; register calls
  are symbolic. No guessed DR3 method from current state or neighbouring code.
  Indexed CALL splits row bits 4:0 and method bits 11:5 before target lookup;
  register CALL uses the full unsigned 15-bit method selector. Static commentary
  and hardware `_cmDecodeWord` / `_instrSymbolicMeaning` agree on these forms.
* RETURN: low12 keep mask; for CR0–CR4/CR7–CR11, set bits keep the current
  descriptor and clear bits zero it directly, never restore caller snapshots.
  Bits 5/6 are ignored: CR5 descriptor unchanged, CR6 reconstructed from caller
  context. All M bits reset, then CR6 is rearmed.
* CHANGE: privileged destination requirement and Thread-context forms explicit.
* SWITCH: isolated reload; destination M required and consumed on success.
  Removed the unconditional “CR15/CR15 is no-op” and alias-swap claims.
* TPERM: ordinary presets test exact permissions, CLEAR checks existence,
  FRAME queries frame, EXACT asserts identity, 0x7FFF attenuates without expansion.
  B modifier clears B on a successful ordinary test; reserved presets identified.
* LAMBDA/XLOADLAMBDA: symbolic closure/reduction operation, no result claimed.
* ELOADCALL: row bits 4:0 and method bits 11:5, not a full-immediate C-list row.
* DREAD/DWRITE: immediate unsigned 14-bit offset or indexed unsigned 10-bit base
  plus DR index; correct transfer direction. No current LED/UART/timer predictions.
* BFEXT/BFINS: LSB-based high:low range, zero extension / low source bits,
  preserved destination bits, invalid zero width or crossing bit 31 faults.
  Flags N/Z reflect result; C/V clear.
* MCMP: subtraction flags, no destination write.
* IADD/ISUB: unsigned 14-bit immediates, low four-bit register operand,
  modulo-32-bit result; negative constants require subtraction, not sign extension.
  DR0 reads zero; destination writes discarded, flags still calculated.
* BRANCH: signed 15-bit word offset relative to instruction PC, not next PC.
* SHL/SHR: five-bit shift count; logical versus arithmetic right shift;
  zero shift clears carry, V clears, N/Z reflect result.
* Reserved opcode gaps and inline WORD: fault if executed, not an inferred effect.

## Verification

`node simulator/test_instruction_commentary_static.js` uses isolated synthetic
words, including every opcode/condition combination. A throwing simulator proxy
proves static decoding does not read live state. Tests cover the reported
ISUB/IADD/DWRITE/SWITCH sequence, mutated/reset state, DR0, unsigned immediates,
negative branch offsets, bitfield/shift boundaries, memory addressing, TPERM,
CALL context absence, RETURN masks and branch-label integration.

`node simulator/test_indexed_call_annotation.js` verifies exact-artifact indexed
CALL names, stale/missing/mismatched metadata and unchanged source/binary words.

Execution-owner coordination: immutable per-occurrence evidence is required for
actual arithmetic operands, effects, authorization/M outcomes, skipped/faulted
instructions, loop iterations and reset identity. Static renderers intentionally
cannot supply those facts. Hardware needs its own matched instruction/artifact
evidence and must report unavailable operands rather than borrow simulator state.
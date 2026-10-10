# Church Machine Instruction Set

## Navigation

- [Document authority](#document-authority)
- [BFEXT/BFINS bitfield contract](#bfextbfins-bitfield-contract)
- [CHANGE: one-GT Thread activation](#change-one-gt-thread-activation)
- [Uniform indexed operands](#uniform-indexed-operands)
- [SWITCH: isolated-register LOAD](#switch-isolated-register-load)
- [Retired opcodes and reference forms](#retired-opcodes-and-directindirect-reference-forms)
- [Historical evidence and inventory](instruction-set-history.md)
- [Legacy section links](#historical-section-links)

## Document authority

This is the **master ISA document**. Its requirements take precedence over
`isa_reference.md`, `isa_encoding.md`, the `isa-indexed-*` proposals, derived
PDFs and implementation descriptions. Those documents support this master;
assembler, simulator or hardware behavior does not override it.

The previously approved retirement of **ELOADCALL (opcode 8)** and
**XLOADLAMBDA (opcode 9)** remains in force. Descriptions of those encodings
below are historical only; they do not authorize execution or automatic
translation of saved programs.

The one-GT CHANGE and indexed-operand corrections below are authoritative.
Existing encoding tables and repeated instruction descriptions elsewhere in
this document remain baseline records pending reconciliation; they do not
override these corrections or establish a new encoding layout.

## BFEXT/BFINS: bitfield contract

**Normative correction — 2026-10-04.** This supersedes the repeated baseline
bitfield descriptions below. Assembly syntax is `BFEXT DRd, DRs, #lsb, #width`
and `BFINS DRd, DRs, #lsb, #width`, preserving the existing assembler syntax.
Immediate bits 4:0 encode width directly (1–31); bits 9:5 encode lsb (0–31).
Zero width and lsb + width > 32 fault with BOUNDS, without changing registers
or condition flags. Assemblers reject out-of-range operands before masking.
No new interpretation of immediate bits 14:10 is introduced here.

BFEXT zero-extends the selected source field. BFINS replaces only the selected
destination field with the low width bits of the pre-write source. Both set
N/Z from the computed result and clear C/V; DR0 writes remain discarded.
The usual condition predicate applies; a false predicate has no effects.

## CHANGE: one-GT Thread activation

**Normative correction — 2026-10-03.** This section supersedes the indexed
CHANGE descriptions, privileged-register-write variants, and encoding tables
elsewhere in this document and in derived references.

### General programmatic case

CHANGE takes **one GT identifying the new Thread**:

```asm
CHANGE CRn
```

CRn supplies the GT already held in that register. It is not a destination
register or a C-list to index. CHANGE suspends the current Thread and activates
the Thread identified by that GT. There is no second register operand,
Namespace-slot operand, or implicit `[0]` lookup. CHANGE is not a protected
instruction; CR13 must not be rejected while CR12 is specially exempted.
Capability and Thread-context validation remain execution concerns.

Self-target CHANGE is valid, including `CHANGE CR12` when CR12 identifies the
running Thread. Save and restore the newly captured continuation and resume
after CHANGE; do not restore an older dormant snapshot or accumulate frames.
Neither CR12.M nor CR13.M is required merely to supply the operand GT.

**Thread GT permissions and microcode authority:** The GT supplied for a valid
CHANGE has **no permissions**. This deliberately prevents programmer access to
the protected Thread state through that GT. CHANGE performs its save/restore
work using **microcode privileges**, not permissions granted by the operand GT.
It must not require R, W, X, L, S, or E on that GT to perform the transition.
A permissionless GT is not a NULL GT: identity, validity and the target Thread
context still require validation. Internal access must not grant those
microcode privileges to subsequent programmer instructions.

**Mandatory acceptance checks:** Microcode must check that the supplied Thread
GT has **no permissions set**, not merely accept zero permissions as optional.
A GT with any permission set fails this requirement. It must also validate the
incoming stack frame and a valid C-List usable by the restored context.
**Any error is a hard fault.** Do not ignore errors, strip permissions to make
the GT acceptable, substitute another frame/C-List, or continue with a partial
transition. Microcode privileges enable access for the transition; they do not
waive these checks. The detailed C-List validation algorithm and fault-code
assignments are not specified by this semantic correction.

This is distinct from validation of the executable Enter GT in a saved
continuation frame. Do not transfer that frame's E-permission requirement to
the permissionless Thread GT supplied to CHANGE. The proposed M-gated hidden
IRQ return is also a separate operation, not an added prerequisite for general
programmatic CHANGE.

Loading a GT into a register with SWITCH and activating its Thread with CHANGE
are distinct operations. `CHANGE CR13` is a programmatic use of the GT in CR13;
it must not be interpreted as installing an interrupt-handler GT into CR13.

### Boot exception

**Simulator implementation boundary:** General CHANGE now consumes the GT in
the register named by the existing assembler's one-operand spelling. For
software compatibility, that word repeats the register in both legacy fields
and has zero immediate; no indexed lookup is performed. Other legacy indexed
words are rejected. This is not approval of a new hardware encoding, migration
of saved binaries, or implementation of the proposed IRQ-return trigger.
The simulator checks the incoming frame, C-List geometry, matching executable
SELF and resolvable Inform entries before publishing restored context.
Unoccupied rows and unresolved Abstract locks retain their existing meanings.
An already active Thread is not accepted as a dormant incoming context.
The isolated regression is `node simulator/test_change_one_gt.js`.

Boot uses the **back half** of the Thread transition: the incoming Thread is
loaded into CR12. There is no outgoing programmatic Thread context to suspend.
This special initialization path does not add operands to programmatic CHANGE.

### IRQ hardware exception

IRQ entry is **not a CHANGE instruction**. Hardware can swap CR12 and CR13
directly, without the additional work of the general programmatic CHANGE path.
IRQ return must perform the **matching hidden swap back**, not CHANGE. The
entry and return operations are paired hardware exceptions; neither uses the
general programmatic Thread-transition path. The earlier statement that IRQ
return uses `CHANGE CR12` is withdrawn. The trigger or instruction encoding
for the return operation is not specified by this correction.

An [M-gated hidden-return proposal](irq-hidden-return-proposal.md) explores
requiring both CR12.M and CR13.M and a candidate `CHANGE CR13, CR13` trigger.
It is **discussion only**, not an approved extension to general CHANGE.
The meaning of a hidden swap with an unchanged CR13, the back-half behavior,
and the return authorization/consumption rules remain to be agreed.

### Encoding and implementation status

This correction documents semantics only. It does not assign a new bit-field
layout, change the compiler/simulator/RTL, regenerate saved LUMPs, or approve a
bitstream. The legacy `CRd, CRs, idx` implementation is not ISA authority.
In particular, expanding `CHANGE CR13` to `CHANGE CR13, CR13[0x0000]` and emitting
`0x276E8000` is not established as a conforming encoding by assembler/disassembler
round-trip tests. Neither the corrected word nor a binary migration policy is
specified here. Implementation conformance remains separate work.

## Uniform indexed operands

Every instruction operand that denotes an index uses the selected data register's
runtime value added to the immediate, within the indexed instruction itself:

```text
effective_index = DR[r] + immediate
```

* Any data register may supply the runtime value. Use its contents, not its
  register number.
* The instruction performs the calculation itself; no separate ADD instruction
  is required.
* Register-only indexing uses immediate zero. Immediate-only indexing uses DR0,
  whose value is zero.
* Subtractive offsets use `DR[r] - magnitude`, the negative-offset form.
* For example, DR11 containing 7 plus immediate 3 selects index 10—not 14 and
  not 3.
* The operand retains its defined units and meaning (for example, a c-list row
  or data-word offset). Non-index immediates are not changed by this rule.

Indexing grants no additional authority. Existing permission, type and bounds
checks apply to the resulting access or target. Arithmetic overflow, underflow
and out-of-range indices must not wrap into a permitted access. Reject before
an unauthorized read, write or control transfer.

### Compact indexed LOAD/SAVE operand

The selected LOAD/SAVE encoding keeps one 32-bit instruction and reduces the
index immediate to a **10-bit unsigned magnitude**, with a separate sign bit
and a four-bit data-register selector in the existing 15-bit operand field:

| Instruction bits | Field | Meaning |
|---|---|---|
| 14 | S | 0 adds the magnitude; 1 subtracts it |
| 13:4 | M | Immediate magnitude, 0–1023 |
| 3:0 | R | Index register, DR0–DR15 |

```text
operand15 = (S << 14) | (M << 4) | R
effective_index = unsigned32(DR[R]) + (S ? -M : M)
```

The immediate offset range is **−1023 through +1023**, not a signed 10-bit
two's-complement range. M=0 uses S=0 canonically; assemblers normalize `DRr - 0`
to `DRr`. The effective index is not restricted to ten bits: the selected DR
supplies a full 32-bit value. Perform the calculation without wraparound and
apply the access checks above. Reject source magnitudes greater than 1023,
rather than truncating or emitting a separate arithmetic instruction.

Examples of the operand field (not complete instruction words):

| Index expression | Operand field |
|---|---|
| `DR11 + 3` | `0x003B` |
| `DR11 - 3` | `0x403B` |
| `DR15 + 1023` | `0x3FFF` |
| `DR15 - 1023` | `0x7FFF` |
| `DR0 + 3` (immediate-only) | `0x0030` |

No prefix or extension word is required for this operand. The earlier multiword
IDX1/20-bit-magnitude proposal is not the selected LOAD/SAVE encoding.
This decision does not narrow non-index immediates such as IADD's arithmetic
immediate. Other indexed operand roles still require their explicit field mapping.

**Direct ISA cutover:** backward compatibility does not constrain this layout.
Use it directly for LOAD/SAVE; do not add a legacy decoding mode, packet format
or compatibility profile merely to preserve earlier encodings. For example,
operand `0x0003` now means DR3 with immediate zero, not immediate 3.
Previously compiled binaries are not assumed compatible and may require
recompilation. This is not permission to delete or automatically rewrite saved
files. Focused assembler, simulator and Amaranth compact LOAD/SAVE tests now
pass; this does not certify every instruction or the currently flashed FPGA.

The ordinary DREAD/DWRITE indexed forms already implement register-plus-immediate
addition within their existing field limits. Immediate-only LOAD/SAVE now uses
the selected compact field with DR0; it is not an exception to the uniform rule.
Assembler, simulator and Amaranth must follow the same reconciled encoding.
This documentation correction does not itself rewrite saved programs,
Namespace contents or boot images. Existing binaries are not compatibility
requirements for the new ISA.

## Retired opcodes and direct/indirect reference forms

**Current ISA guidance — 2026-10-10.** ELOADCALL (8) and XLOADLAMBDA
(9) are reserved, retired encodings: compilation rejects their mnemonics and
execution must fault. Neither is a callable instruction, a shorthand, nor an
automatic replacement target. Correct old source explicitly and recompile;
do not translate or rewrite stored binaries. A description of a historical IRQ
as “hidden ELOADCALL” does not authorize executing opcode 8.

| Form | Authority/reference used |
|---|---|
| `CALL CRn` | The E-GT already held in CRn; no implicit C-List lookup |
| `CALL CR6[PetName], Method` | Select the declared PetName's GT from the caller's C-List, then the method |
| `LOAD CRd, CRs, #n` / `SAVE CRd, CRs, #n` | Index n, encoded with DR0 and the signed magnitude |
| `LOAD CRd, CRs, DRr + n` / `SAVE CRd, CRs, DRr - n` | Runtime unsigned DR value plus/minus magnitude, with non-wrapping arithmetic and access checks |
| `CHANGE CRn` | The permissionless Thread GT in CRn, not `CRn[0]` |

For LOAD/SAVE, the magnitude is 10 unsigned bits plus a separate sign bit
(±1023). Immediate 7 encodes as operand `0x0070`; operand `0x0007` instead
selects DR7 with zero offset. Do not apply this layout to CALL's C-List-row
or method-selector fields. See the normative sections above for full rules.

The explicit experimental IDX1 packet implementation has separate layout
tests. Its continued existence is **not** authority to change the selected
ordinary LOAD/SAVE encoding or a claim that FPGA execution supports IDX1.

## SWITCH: isolated-register LOAD

**Current contract retained from the existing SWITCH specification.** This
concise definition and [SWITCH lifecycle](switch-lifecycle.md) describe the
same register, authorization, and fault rules; no new encoding is introduced.

`SWITCH CRd, CRs, #row` is the special LOAD form for isolated registers.
CRd must be CR12–CR15, and its M bit is latched at instruction acceptance.
CRs must be CR0–CR11 and hold a valid ordinary c-list capability with L
permission. Source M is not consulted. The selected `CRs[row]` passes normal
LOAD bounds, version, integrity, and type checks; reserved encoding bits
must be zero.

On success, the selected capability replaces CRd and destination M clears.
Namespace must reauthorize that exact destination through the corresponding
bit in the single-word M-bit I/O object before another SWITCH to it.
M is register state, not a GT permission.

A non-isolated destination, isolated source, or malformed operand encoding
faults with `INVALID_OP`. An otherwise well-formed SWITCH whose latched
destination M is clear faults with `PERM_L`. Invalid sources, bounds,
version, integrity, and type failures fault before commit. No failure may
change any capability register, M bit, Namespace entry, memory word, or
source capability. A false condition skips the instruction without consuming
M authorization.

# Historical baseline — not current instruction guidance

The repeated baseline has moved to the [Historical ISA baseline reference](instruction-set-history.md).
It is evidence only, not current instruction guidance. No saved program has
been changed. Both distinct RETURN versions and all other historical text
are preserved; the reference explains the exact-copy inventory.

## Historical section links

Old section anchors below lead to the preserved historical text. For current
rules, use the normative sections above. Numbered duplicate anchors are also
retained for links made by Markdown viewers that numbered repeated headings.

## Encoding Format

<a id="encoding-format-1"></a><a id="encoding-format-2"></a><a id="encoding-format-3"></a><a id="encoding-format-4"></a><a id="encoding-format-5"></a><a id="encoding-format-6"></a><a id="encoding-format-7"></a><a id="encoding-format-8"></a><a id="encoding-format-9"></a><a id="encoding-format-10"></a><a id="encoding-format-11"></a><a id="encoding-format-12"></a><a id="encoding-format-13"></a><a id="encoding-format-14"></a><a id="encoding-format-15"></a><a id="encoding-format-16"></a><a id="encoding-format-17"></a><a id="encoding-format-18"></a><a id="encoding-format-19"></a><a id="encoding-format-20"></a><a id="encoding-format-21"></a><a id="encoding-format-22"></a><a id="encoding-format-23"></a><a id="encoding-format-24"></a><a id="encoding-format-25"></a><a id="encoding-format-26"></a><a id="encoding-format-27"></a><a id="encoding-format-28"></a><a id="encoding-format-29"></a><a id="encoding-format-30"></a><a id="encoding-format-31"></a>

Historical only: [Encoding Format](instruction-set-history.md#encoding-format).

## Condition Codes

<a id="condition-codes-1"></a><a id="condition-codes-2"></a><a id="condition-codes-3"></a><a id="condition-codes-4"></a><a id="condition-codes-5"></a><a id="condition-codes-6"></a><a id="condition-codes-7"></a><a id="condition-codes-8"></a><a id="condition-codes-9"></a><a id="condition-codes-10"></a><a id="condition-codes-11"></a><a id="condition-codes-12"></a><a id="condition-codes-13"></a><a id="condition-codes-14"></a><a id="condition-codes-15"></a><a id="condition-codes-16"></a><a id="condition-codes-17"></a><a id="condition-codes-18"></a><a id="condition-codes-19"></a><a id="condition-codes-20"></a><a id="condition-codes-21"></a><a id="condition-codes-22"></a><a id="condition-codes-23"></a><a id="condition-codes-24"></a><a id="condition-codes-25"></a><a id="condition-codes-26"></a><a id="condition-codes-27"></a><a id="condition-codes-28"></a><a id="condition-codes-29"></a><a id="condition-codes-30"></a><a id="condition-codes-31"></a>

Historical only: [Condition Codes](instruction-set-history.md#condition-codes).

## Church Domain (10 Instructions)

<a id="church-domain-10-instructions-1"></a><a id="church-domain-10-instructions-2"></a><a id="church-domain-10-instructions-3"></a><a id="church-domain-10-instructions-4"></a><a id="church-domain-10-instructions-5"></a><a id="church-domain-10-instructions-6"></a><a id="church-domain-10-instructions-7"></a><a id="church-domain-10-instructions-8"></a><a id="church-domain-10-instructions-9"></a><a id="church-domain-10-instructions-10"></a><a id="church-domain-10-instructions-11"></a><a id="church-domain-10-instructions-12"></a><a id="church-domain-10-instructions-13"></a><a id="church-domain-10-instructions-14"></a><a id="church-domain-10-instructions-15"></a><a id="church-domain-10-instructions-16"></a><a id="church-domain-10-instructions-17"></a><a id="church-domain-10-instructions-18"></a><a id="church-domain-10-instructions-19"></a><a id="church-domain-10-instructions-20"></a><a id="church-domain-10-instructions-21"></a><a id="church-domain-10-instructions-22"></a><a id="church-domain-10-instructions-23"></a><a id="church-domain-10-instructions-24"></a><a id="church-domain-10-instructions-25"></a><a id="church-domain-10-instructions-26"></a><a id="church-domain-10-instructions-27"></a><a id="church-domain-10-instructions-28"></a><a id="church-domain-10-instructions-29"></a><a id="church-domain-10-instructions-30"></a><a id="church-domain-10-instructions-31"></a>

Historical only: [Church Domain (10 Instructions)](instruction-set-history.md#church-domain-10-instructions).

### LOAD (opcode 0)

<a id="load-opcode-0-1"></a><a id="load-opcode-0-2"></a><a id="load-opcode-0-3"></a><a id="load-opcode-0-4"></a><a id="load-opcode-0-5"></a><a id="load-opcode-0-6"></a><a id="load-opcode-0-7"></a><a id="load-opcode-0-8"></a><a id="load-opcode-0-9"></a><a id="load-opcode-0-10"></a><a id="load-opcode-0-11"></a><a id="load-opcode-0-12"></a><a id="load-opcode-0-13"></a><a id="load-opcode-0-14"></a><a id="load-opcode-0-15"></a><a id="load-opcode-0-16"></a><a id="load-opcode-0-17"></a><a id="load-opcode-0-18"></a><a id="load-opcode-0-19"></a><a id="load-opcode-0-20"></a><a id="load-opcode-0-21"></a><a id="load-opcode-0-22"></a><a id="load-opcode-0-23"></a><a id="load-opcode-0-24"></a><a id="load-opcode-0-25"></a><a id="load-opcode-0-26"></a><a id="load-opcode-0-27"></a><a id="load-opcode-0-28"></a><a id="load-opcode-0-29"></a><a id="load-opcode-0-30"></a><a id="load-opcode-0-31"></a>

Historical only: [LOAD (opcode 0)](instruction-set-history.md#load-opcode-0).

### SAVE (opcode 1)

<a id="save-opcode-1-1"></a><a id="save-opcode-1-2"></a><a id="save-opcode-1-3"></a><a id="save-opcode-1-4"></a><a id="save-opcode-1-5"></a><a id="save-opcode-1-6"></a><a id="save-opcode-1-7"></a><a id="save-opcode-1-8"></a><a id="save-opcode-1-9"></a><a id="save-opcode-1-10"></a><a id="save-opcode-1-11"></a><a id="save-opcode-1-12"></a><a id="save-opcode-1-13"></a><a id="save-opcode-1-14"></a><a id="save-opcode-1-15"></a><a id="save-opcode-1-16"></a><a id="save-opcode-1-17"></a><a id="save-opcode-1-18"></a><a id="save-opcode-1-19"></a><a id="save-opcode-1-20"></a><a id="save-opcode-1-21"></a><a id="save-opcode-1-22"></a><a id="save-opcode-1-23"></a><a id="save-opcode-1-24"></a><a id="save-opcode-1-25"></a><a id="save-opcode-1-26"></a><a id="save-opcode-1-27"></a><a id="save-opcode-1-28"></a><a id="save-opcode-1-29"></a><a id="save-opcode-1-30"></a><a id="save-opcode-1-31"></a>

Historical only: [SAVE (opcode 1)](instruction-set-history.md#save-opcode-1).

### CALL (opcode 2)

<a id="call-opcode-2-1"></a><a id="call-opcode-2-2"></a><a id="call-opcode-2-3"></a><a id="call-opcode-2-4"></a><a id="call-opcode-2-5"></a><a id="call-opcode-2-6"></a><a id="call-opcode-2-7"></a><a id="call-opcode-2-8"></a><a id="call-opcode-2-9"></a><a id="call-opcode-2-10"></a><a id="call-opcode-2-11"></a><a id="call-opcode-2-12"></a><a id="call-opcode-2-13"></a><a id="call-opcode-2-14"></a><a id="call-opcode-2-15"></a><a id="call-opcode-2-16"></a><a id="call-opcode-2-17"></a><a id="call-opcode-2-18"></a><a id="call-opcode-2-19"></a><a id="call-opcode-2-20"></a><a id="call-opcode-2-21"></a><a id="call-opcode-2-22"></a><a id="call-opcode-2-23"></a><a id="call-opcode-2-24"></a><a id="call-opcode-2-25"></a><a id="call-opcode-2-26"></a><a id="call-opcode-2-27"></a><a id="call-opcode-2-28"></a><a id="call-opcode-2-29"></a><a id="call-opcode-2-30"></a><a id="call-opcode-2-31"></a>

Historical only: [CALL (opcode 2)](instruction-set-history.md#call-opcode-2).

### RETURN (opcode 3)

Historical only: [RETURN (opcode 3), first baseline](instruction-set-history.md#return-opcode-3).

<a id="return-opcode-3-1"></a><a id="return-opcode-3-2"></a><a id="return-opcode-3-3"></a><a id="return-opcode-3-4"></a><a id="return-opcode-3-5"></a><a id="return-opcode-3-6"></a><a id="return-opcode-3-7"></a><a id="return-opcode-3-8"></a><a id="return-opcode-3-9"></a><a id="return-opcode-3-10"></a><a id="return-opcode-3-11"></a><a id="return-opcode-3-12"></a><a id="return-opcode-3-13"></a><a id="return-opcode-3-14"></a><a id="return-opcode-3-15"></a><a id="return-opcode-3-16"></a><a id="return-opcode-3-17"></a><a id="return-opcode-3-18"></a><a id="return-opcode-3-19"></a><a id="return-opcode-3-20"></a><a id="return-opcode-3-21"></a><a id="return-opcode-3-22"></a><a id="return-opcode-3-23"></a><a id="return-opcode-3-24"></a><a id="return-opcode-3-25"></a><a id="return-opcode-3-26"></a><a id="return-opcode-3-27"></a><a id="return-opcode-3-28"></a><a id="return-opcode-3-29"></a><a id="return-opcode-3-30"></a><a id="return-opcode-3-31"></a>

Historical copies 2–32: [earlier RETURN variant](instruction-set-history.md#earlier-return-variant).

### CHANGE (opcode 4)

<a id="change-opcode-4-1"></a><a id="change-opcode-4-2"></a><a id="change-opcode-4-3"></a><a id="change-opcode-4-4"></a><a id="change-opcode-4-5"></a><a id="change-opcode-4-6"></a><a id="change-opcode-4-7"></a><a id="change-opcode-4-8"></a><a id="change-opcode-4-9"></a><a id="change-opcode-4-10"></a><a id="change-opcode-4-11"></a><a id="change-opcode-4-12"></a><a id="change-opcode-4-13"></a><a id="change-opcode-4-14"></a><a id="change-opcode-4-15"></a><a id="change-opcode-4-16"></a><a id="change-opcode-4-17"></a><a id="change-opcode-4-18"></a><a id="change-opcode-4-19"></a><a id="change-opcode-4-20"></a><a id="change-opcode-4-21"></a><a id="change-opcode-4-22"></a><a id="change-opcode-4-23"></a><a id="change-opcode-4-24"></a><a id="change-opcode-4-25"></a><a id="change-opcode-4-26"></a><a id="change-opcode-4-27"></a><a id="change-opcode-4-28"></a><a id="change-opcode-4-29"></a><a id="change-opcode-4-30"></a><a id="change-opcode-4-31"></a>

Historical only: [CHANGE (opcode 4)](instruction-set-history.md#change-opcode-4).

### SWITCH (opcode 5)

<a id="switch-opcode-5-1"></a><a id="switch-opcode-5-2"></a><a id="switch-opcode-5-3"></a><a id="switch-opcode-5-4"></a><a id="switch-opcode-5-5"></a><a id="switch-opcode-5-6"></a><a id="switch-opcode-5-7"></a><a id="switch-opcode-5-8"></a><a id="switch-opcode-5-9"></a><a id="switch-opcode-5-10"></a><a id="switch-opcode-5-11"></a><a id="switch-opcode-5-12"></a><a id="switch-opcode-5-13"></a><a id="switch-opcode-5-14"></a><a id="switch-opcode-5-15"></a><a id="switch-opcode-5-16"></a><a id="switch-opcode-5-17"></a><a id="switch-opcode-5-18"></a><a id="switch-opcode-5-19"></a><a id="switch-opcode-5-20"></a><a id="switch-opcode-5-21"></a><a id="switch-opcode-5-22"></a><a id="switch-opcode-5-23"></a><a id="switch-opcode-5-24"></a><a id="switch-opcode-5-25"></a><a id="switch-opcode-5-26"></a><a id="switch-opcode-5-27"></a><a id="switch-opcode-5-28"></a><a id="switch-opcode-5-29"></a><a id="switch-opcode-5-30"></a><a id="switch-opcode-5-31"></a>

Historical only: [SWITCH (opcode 5)](instruction-set-history.md#switch-opcode-5).

### TPERM (opcode 6)

<a id="tperm-opcode-6-1"></a><a id="tperm-opcode-6-2"></a><a id="tperm-opcode-6-3"></a><a id="tperm-opcode-6-4"></a><a id="tperm-opcode-6-5"></a><a id="tperm-opcode-6-6"></a><a id="tperm-opcode-6-7"></a><a id="tperm-opcode-6-8"></a><a id="tperm-opcode-6-9"></a><a id="tperm-opcode-6-10"></a><a id="tperm-opcode-6-11"></a><a id="tperm-opcode-6-12"></a><a id="tperm-opcode-6-13"></a><a id="tperm-opcode-6-14"></a><a id="tperm-opcode-6-15"></a><a id="tperm-opcode-6-16"></a><a id="tperm-opcode-6-17"></a><a id="tperm-opcode-6-18"></a><a id="tperm-opcode-6-19"></a><a id="tperm-opcode-6-20"></a><a id="tperm-opcode-6-21"></a><a id="tperm-opcode-6-22"></a><a id="tperm-opcode-6-23"></a><a id="tperm-opcode-6-24"></a><a id="tperm-opcode-6-25"></a><a id="tperm-opcode-6-26"></a><a id="tperm-opcode-6-27"></a><a id="tperm-opcode-6-28"></a><a id="tperm-opcode-6-29"></a><a id="tperm-opcode-6-30"></a><a id="tperm-opcode-6-31"></a>

Historical only: [TPERM (opcode 6)](instruction-set-history.md#tperm-opcode-6).

#### Encoding

<a id="encoding-1"></a><a id="encoding-2"></a><a id="encoding-3"></a><a id="encoding-4"></a><a id="encoding-5"></a><a id="encoding-6"></a><a id="encoding-7"></a><a id="encoding-8"></a><a id="encoding-9"></a><a id="encoding-10"></a><a id="encoding-11"></a><a id="encoding-12"></a><a id="encoding-13"></a><a id="encoding-14"></a><a id="encoding-15"></a><a id="encoding-16"></a><a id="encoding-17"></a><a id="encoding-18"></a><a id="encoding-19"></a><a id="encoding-20"></a><a id="encoding-21"></a><a id="encoding-22"></a><a id="encoding-23"></a><a id="encoding-24"></a><a id="encoding-25"></a><a id="encoding-26"></a><a id="encoding-27"></a><a id="encoding-28"></a><a id="encoding-29"></a><a id="encoding-30"></a><a id="encoding-31"></a>

Historical only: [Encoding](instruction-set-history.md#encoding).

#### Mode 1 — Health Check (flag-setting)

<a id="mode-1--health-check-flag-setting"></a>

<a id="mode-1--health-check-flag-setting-1"></a><a id="mode-1--health-check-flag-setting-2"></a><a id="mode-1--health-check-flag-setting-3"></a><a id="mode-1--health-check-flag-setting-4"></a><a id="mode-1--health-check-flag-setting-5"></a><a id="mode-1--health-check-flag-setting-6"></a><a id="mode-1--health-check-flag-setting-7"></a><a id="mode-1--health-check-flag-setting-8"></a><a id="mode-1--health-check-flag-setting-9"></a><a id="mode-1--health-check-flag-setting-10"></a><a id="mode-1--health-check-flag-setting-11"></a><a id="mode-1--health-check-flag-setting-12"></a><a id="mode-1--health-check-flag-setting-13"></a><a id="mode-1--health-check-flag-setting-14"></a><a id="mode-1--health-check-flag-setting-15"></a><a id="mode-1--health-check-flag-setting-16"></a><a id="mode-1--health-check-flag-setting-17"></a><a id="mode-1--health-check-flag-setting-18"></a><a id="mode-1--health-check-flag-setting-19"></a><a id="mode-1--health-check-flag-setting-20"></a><a id="mode-1--health-check-flag-setting-21"></a><a id="mode-1--health-check-flag-setting-22"></a><a id="mode-1--health-check-flag-setting-23"></a><a id="mode-1--health-check-flag-setting-24"></a><a id="mode-1--health-check-flag-setting-25"></a><a id="mode-1--health-check-flag-setting-26"></a><a id="mode-1--health-check-flag-setting-27"></a><a id="mode-1--health-check-flag-setting-28"></a><a id="mode-1--health-check-flag-setting-29"></a><a id="mode-1--health-check-flag-setting-30"></a><a id="mode-1--health-check-flag-setting-31"></a><a id="mode-1-health-check-flag-setting-1"></a><a id="mode-1-health-check-flag-setting-2"></a><a id="mode-1-health-check-flag-setting-3"></a><a id="mode-1-health-check-flag-setting-4"></a><a id="mode-1-health-check-flag-setting-5"></a><a id="mode-1-health-check-flag-setting-6"></a><a id="mode-1-health-check-flag-setting-7"></a><a id="mode-1-health-check-flag-setting-8"></a><a id="mode-1-health-check-flag-setting-9"></a><a id="mode-1-health-check-flag-setting-10"></a><a id="mode-1-health-check-flag-setting-11"></a><a id="mode-1-health-check-flag-setting-12"></a><a id="mode-1-health-check-flag-setting-13"></a><a id="mode-1-health-check-flag-setting-14"></a><a id="mode-1-health-check-flag-setting-15"></a><a id="mode-1-health-check-flag-setting-16"></a><a id="mode-1-health-check-flag-setting-17"></a><a id="mode-1-health-check-flag-setting-18"></a><a id="mode-1-health-check-flag-setting-19"></a><a id="mode-1-health-check-flag-setting-20"></a><a id="mode-1-health-check-flag-setting-21"></a><a id="mode-1-health-check-flag-setting-22"></a><a id="mode-1-health-check-flag-setting-23"></a><a id="mode-1-health-check-flag-setting-24"></a><a id="mode-1-health-check-flag-setting-25"></a><a id="mode-1-health-check-flag-setting-26"></a><a id="mode-1-health-check-flag-setting-27"></a><a id="mode-1-health-check-flag-setting-28"></a><a id="mode-1-health-check-flag-setting-29"></a><a id="mode-1-health-check-flag-setting-30"></a><a id="mode-1-health-check-flag-setting-31"></a>

Historical only: [Mode 1 — Health Check (flag-setting)](instruction-set-history.md#mode-1-health-check-flag-setting).

##### Conditional Execution: Zero-Cost Try-Catch

<a id="conditional-execution-zero-cost-try-catch-1"></a><a id="conditional-execution-zero-cost-try-catch-2"></a><a id="conditional-execution-zero-cost-try-catch-3"></a><a id="conditional-execution-zero-cost-try-catch-4"></a><a id="conditional-execution-zero-cost-try-catch-5"></a><a id="conditional-execution-zero-cost-try-catch-6"></a><a id="conditional-execution-zero-cost-try-catch-7"></a><a id="conditional-execution-zero-cost-try-catch-8"></a><a id="conditional-execution-zero-cost-try-catch-9"></a><a id="conditional-execution-zero-cost-try-catch-10"></a><a id="conditional-execution-zero-cost-try-catch-11"></a><a id="conditional-execution-zero-cost-try-catch-12"></a><a id="conditional-execution-zero-cost-try-catch-13"></a><a id="conditional-execution-zero-cost-try-catch-14"></a><a id="conditional-execution-zero-cost-try-catch-15"></a><a id="conditional-execution-zero-cost-try-catch-16"></a><a id="conditional-execution-zero-cost-try-catch-17"></a><a id="conditional-execution-zero-cost-try-catch-18"></a><a id="conditional-execution-zero-cost-try-catch-19"></a><a id="conditional-execution-zero-cost-try-catch-20"></a><a id="conditional-execution-zero-cost-try-catch-21"></a><a id="conditional-execution-zero-cost-try-catch-22"></a><a id="conditional-execution-zero-cost-try-catch-23"></a><a id="conditional-execution-zero-cost-try-catch-24"></a><a id="conditional-execution-zero-cost-try-catch-25"></a><a id="conditional-execution-zero-cost-try-catch-26"></a><a id="conditional-execution-zero-cost-try-catch-27"></a><a id="conditional-execution-zero-cost-try-catch-28"></a><a id="conditional-execution-zero-cost-try-catch-29"></a><a id="conditional-execution-zero-cost-try-catch-30"></a><a id="conditional-execution-zero-cost-try-catch-31"></a>

Historical only: [Conditional Execution: Zero-Cost Try-Catch](instruction-set-history.md#conditional-execution-zero-cost-try-catch).

#### Mode 2 — Permission Restriction (monotonic attenuation)

<a id="mode-2--permission-restriction-monotonic-attenuation"></a>

<a id="mode-2--permission-restriction-monotonic-attenuation-1"></a><a id="mode-2--permission-restriction-monotonic-attenuation-2"></a><a id="mode-2--permission-restriction-monotonic-attenuation-3"></a><a id="mode-2--permission-restriction-monotonic-attenuation-4"></a><a id="mode-2--permission-restriction-monotonic-attenuation-5"></a><a id="mode-2--permission-restriction-monotonic-attenuation-6"></a><a id="mode-2--permission-restriction-monotonic-attenuation-7"></a><a id="mode-2--permission-restriction-monotonic-attenuation-8"></a><a id="mode-2--permission-restriction-monotonic-attenuation-9"></a><a id="mode-2--permission-restriction-monotonic-attenuation-10"></a><a id="mode-2--permission-restriction-monotonic-attenuation-11"></a><a id="mode-2--permission-restriction-monotonic-attenuation-12"></a><a id="mode-2--permission-restriction-monotonic-attenuation-13"></a><a id="mode-2--permission-restriction-monotonic-attenuation-14"></a><a id="mode-2--permission-restriction-monotonic-attenuation-15"></a><a id="mode-2--permission-restriction-monotonic-attenuation-16"></a><a id="mode-2--permission-restriction-monotonic-attenuation-17"></a><a id="mode-2--permission-restriction-monotonic-attenuation-18"></a><a id="mode-2--permission-restriction-monotonic-attenuation-19"></a><a id="mode-2--permission-restriction-monotonic-attenuation-20"></a><a id="mode-2--permission-restriction-monotonic-attenuation-21"></a><a id="mode-2--permission-restriction-monotonic-attenuation-22"></a><a id="mode-2--permission-restriction-monotonic-attenuation-23"></a><a id="mode-2--permission-restriction-monotonic-attenuation-24"></a><a id="mode-2--permission-restriction-monotonic-attenuation-25"></a><a id="mode-2--permission-restriction-monotonic-attenuation-26"></a><a id="mode-2--permission-restriction-monotonic-attenuation-27"></a><a id="mode-2--permission-restriction-monotonic-attenuation-28"></a><a id="mode-2--permission-restriction-monotonic-attenuation-29"></a><a id="mode-2--permission-restriction-monotonic-attenuation-30"></a><a id="mode-2--permission-restriction-monotonic-attenuation-31"></a><a id="mode-2-permission-restriction-monotonic-attenuation-1"></a><a id="mode-2-permission-restriction-monotonic-attenuation-2"></a><a id="mode-2-permission-restriction-monotonic-attenuation-3"></a><a id="mode-2-permission-restriction-monotonic-attenuation-4"></a><a id="mode-2-permission-restriction-monotonic-attenuation-5"></a><a id="mode-2-permission-restriction-monotonic-attenuation-6"></a><a id="mode-2-permission-restriction-monotonic-attenuation-7"></a><a id="mode-2-permission-restriction-monotonic-attenuation-8"></a><a id="mode-2-permission-restriction-monotonic-attenuation-9"></a><a id="mode-2-permission-restriction-monotonic-attenuation-10"></a><a id="mode-2-permission-restriction-monotonic-attenuation-11"></a><a id="mode-2-permission-restriction-monotonic-attenuation-12"></a><a id="mode-2-permission-restriction-monotonic-attenuation-13"></a><a id="mode-2-permission-restriction-monotonic-attenuation-14"></a><a id="mode-2-permission-restriction-monotonic-attenuation-15"></a><a id="mode-2-permission-restriction-monotonic-attenuation-16"></a><a id="mode-2-permission-restriction-monotonic-attenuation-17"></a><a id="mode-2-permission-restriction-monotonic-attenuation-18"></a><a id="mode-2-permission-restriction-monotonic-attenuation-19"></a><a id="mode-2-permission-restriction-monotonic-attenuation-20"></a><a id="mode-2-permission-restriction-monotonic-attenuation-21"></a><a id="mode-2-permission-restriction-monotonic-attenuation-22"></a><a id="mode-2-permission-restriction-monotonic-attenuation-23"></a><a id="mode-2-permission-restriction-monotonic-attenuation-24"></a><a id="mode-2-permission-restriction-monotonic-attenuation-25"></a><a id="mode-2-permission-restriction-monotonic-attenuation-26"></a><a id="mode-2-permission-restriction-monotonic-attenuation-27"></a><a id="mode-2-permission-restriction-monotonic-attenuation-28"></a><a id="mode-2-permission-restriction-monotonic-attenuation-29"></a><a id="mode-2-permission-restriction-monotonic-attenuation-30"></a><a id="mode-2-permission-restriction-monotonic-attenuation-31"></a>

Historical only: [Mode 2 — Permission Restriction (monotonic attenuation)](instruction-set-history.md#mode-2-permission-restriction-monotonic-attenuation).

#### Preset Table

<a id="preset-table-1"></a><a id="preset-table-2"></a><a id="preset-table-3"></a><a id="preset-table-4"></a><a id="preset-table-5"></a><a id="preset-table-6"></a><a id="preset-table-7"></a><a id="preset-table-8"></a><a id="preset-table-9"></a><a id="preset-table-10"></a><a id="preset-table-11"></a><a id="preset-table-12"></a><a id="preset-table-13"></a><a id="preset-table-14"></a><a id="preset-table-15"></a><a id="preset-table-16"></a><a id="preset-table-17"></a><a id="preset-table-18"></a><a id="preset-table-19"></a><a id="preset-table-20"></a><a id="preset-table-21"></a><a id="preset-table-22"></a><a id="preset-table-23"></a><a id="preset-table-24"></a><a id="preset-table-25"></a><a id="preset-table-26"></a><a id="preset-table-27"></a><a id="preset-table-28"></a><a id="preset-table-29"></a><a id="preset-table-30"></a><a id="preset-table-31"></a>

Historical only: [Preset Table](instruction-set-history.md#preset-table).

#### Design Rationale

<a id="design-rationale-1"></a><a id="design-rationale-2"></a><a id="design-rationale-3"></a><a id="design-rationale-4"></a><a id="design-rationale-5"></a><a id="design-rationale-6"></a><a id="design-rationale-7"></a><a id="design-rationale-8"></a><a id="design-rationale-9"></a><a id="design-rationale-10"></a><a id="design-rationale-11"></a><a id="design-rationale-12"></a><a id="design-rationale-13"></a><a id="design-rationale-14"></a><a id="design-rationale-15"></a><a id="design-rationale-16"></a><a id="design-rationale-17"></a><a id="design-rationale-18"></a><a id="design-rationale-19"></a><a id="design-rationale-20"></a><a id="design-rationale-21"></a><a id="design-rationale-22"></a><a id="design-rationale-23"></a><a id="design-rationale-24"></a><a id="design-rationale-25"></a><a id="design-rationale-26"></a><a id="design-rationale-27"></a><a id="design-rationale-28"></a><a id="design-rationale-29"></a><a id="design-rationale-30"></a><a id="design-rationale-31"></a>

Historical only: [Design Rationale](instruction-set-history.md#design-rationale).

### LAMBDA (opcode 7)

<a id="lambda-opcode-7-1"></a><a id="lambda-opcode-7-2"></a><a id="lambda-opcode-7-3"></a><a id="lambda-opcode-7-4"></a><a id="lambda-opcode-7-5"></a><a id="lambda-opcode-7-6"></a><a id="lambda-opcode-7-7"></a><a id="lambda-opcode-7-8"></a><a id="lambda-opcode-7-9"></a><a id="lambda-opcode-7-10"></a><a id="lambda-opcode-7-11"></a><a id="lambda-opcode-7-12"></a><a id="lambda-opcode-7-13"></a><a id="lambda-opcode-7-14"></a><a id="lambda-opcode-7-15"></a><a id="lambda-opcode-7-16"></a><a id="lambda-opcode-7-17"></a><a id="lambda-opcode-7-18"></a><a id="lambda-opcode-7-19"></a><a id="lambda-opcode-7-20"></a><a id="lambda-opcode-7-21"></a><a id="lambda-opcode-7-22"></a><a id="lambda-opcode-7-23"></a><a id="lambda-opcode-7-24"></a><a id="lambda-opcode-7-25"></a><a id="lambda-opcode-7-26"></a><a id="lambda-opcode-7-27"></a><a id="lambda-opcode-7-28"></a><a id="lambda-opcode-7-29"></a><a id="lambda-opcode-7-30"></a><a id="lambda-opcode-7-31"></a>

Historical only: [LAMBDA (opcode 7)](instruction-set-history.md#lambda-opcode-7).

### ELOADCALL (opcode 8)

<a id="eloadcall-opcode-8-1"></a><a id="eloadcall-opcode-8-2"></a><a id="eloadcall-opcode-8-3"></a><a id="eloadcall-opcode-8-4"></a><a id="eloadcall-opcode-8-5"></a><a id="eloadcall-opcode-8-6"></a><a id="eloadcall-opcode-8-7"></a><a id="eloadcall-opcode-8-8"></a><a id="eloadcall-opcode-8-9"></a><a id="eloadcall-opcode-8-10"></a><a id="eloadcall-opcode-8-11"></a><a id="eloadcall-opcode-8-12"></a><a id="eloadcall-opcode-8-13"></a><a id="eloadcall-opcode-8-14"></a><a id="eloadcall-opcode-8-15"></a><a id="eloadcall-opcode-8-16"></a><a id="eloadcall-opcode-8-17"></a><a id="eloadcall-opcode-8-18"></a><a id="eloadcall-opcode-8-19"></a><a id="eloadcall-opcode-8-20"></a><a id="eloadcall-opcode-8-21"></a><a id="eloadcall-opcode-8-22"></a><a id="eloadcall-opcode-8-23"></a><a id="eloadcall-opcode-8-24"></a><a id="eloadcall-opcode-8-25"></a><a id="eloadcall-opcode-8-26"></a><a id="eloadcall-opcode-8-27"></a><a id="eloadcall-opcode-8-28"></a><a id="eloadcall-opcode-8-29"></a><a id="eloadcall-opcode-8-30"></a><a id="eloadcall-opcode-8-31"></a>

Historical only: [ELOADCALL (opcode 8)](instruction-set-history.md#eloadcall-opcode-8).

### XLOADLAMBDA (opcode 9)

<a id="xloadlambda-opcode-9-1"></a><a id="xloadlambda-opcode-9-2"></a><a id="xloadlambda-opcode-9-3"></a><a id="xloadlambda-opcode-9-4"></a><a id="xloadlambda-opcode-9-5"></a><a id="xloadlambda-opcode-9-6"></a><a id="xloadlambda-opcode-9-7"></a><a id="xloadlambda-opcode-9-8"></a><a id="xloadlambda-opcode-9-9"></a><a id="xloadlambda-opcode-9-10"></a><a id="xloadlambda-opcode-9-11"></a><a id="xloadlambda-opcode-9-12"></a><a id="xloadlambda-opcode-9-13"></a><a id="xloadlambda-opcode-9-14"></a><a id="xloadlambda-opcode-9-15"></a><a id="xloadlambda-opcode-9-16"></a><a id="xloadlambda-opcode-9-17"></a><a id="xloadlambda-opcode-9-18"></a><a id="xloadlambda-opcode-9-19"></a><a id="xloadlambda-opcode-9-20"></a><a id="xloadlambda-opcode-9-21"></a><a id="xloadlambda-opcode-9-22"></a><a id="xloadlambda-opcode-9-23"></a><a id="xloadlambda-opcode-9-24"></a><a id="xloadlambda-opcode-9-25"></a><a id="xloadlambda-opcode-9-26"></a><a id="xloadlambda-opcode-9-27"></a><a id="xloadlambda-opcode-9-28"></a><a id="xloadlambda-opcode-9-29"></a><a id="xloadlambda-opcode-9-30"></a><a id="xloadlambda-opcode-9-31"></a>

Historical only: [XLOADLAMBDA (opcode 9)](instruction-set-history.md#xloadlambda-opcode-9).

## Turing Domain (10 Instructions + shared RETURN)

<a id="turing-domain-10-instructions--shared-return"></a>

<a id="turing-domain-10-instructions--shared-return-1"></a><a id="turing-domain-10-instructions--shared-return-2"></a><a id="turing-domain-10-instructions--shared-return-3"></a><a id="turing-domain-10-instructions--shared-return-4"></a><a id="turing-domain-10-instructions--shared-return-5"></a><a id="turing-domain-10-instructions--shared-return-6"></a><a id="turing-domain-10-instructions--shared-return-7"></a><a id="turing-domain-10-instructions--shared-return-8"></a><a id="turing-domain-10-instructions--shared-return-9"></a><a id="turing-domain-10-instructions--shared-return-10"></a><a id="turing-domain-10-instructions--shared-return-11"></a><a id="turing-domain-10-instructions--shared-return-12"></a><a id="turing-domain-10-instructions--shared-return-13"></a><a id="turing-domain-10-instructions--shared-return-14"></a><a id="turing-domain-10-instructions--shared-return-15"></a><a id="turing-domain-10-instructions--shared-return-16"></a><a id="turing-domain-10-instructions--shared-return-17"></a><a id="turing-domain-10-instructions--shared-return-18"></a><a id="turing-domain-10-instructions--shared-return-19"></a><a id="turing-domain-10-instructions--shared-return-20"></a><a id="turing-domain-10-instructions--shared-return-21"></a><a id="turing-domain-10-instructions--shared-return-22"></a><a id="turing-domain-10-instructions--shared-return-23"></a><a id="turing-domain-10-instructions--shared-return-24"></a><a id="turing-domain-10-instructions--shared-return-25"></a><a id="turing-domain-10-instructions--shared-return-26"></a><a id="turing-domain-10-instructions--shared-return-27"></a><a id="turing-domain-10-instructions--shared-return-28"></a><a id="turing-domain-10-instructions--shared-return-29"></a><a id="turing-domain-10-instructions--shared-return-30"></a><a id="turing-domain-10-instructions--shared-return-31"></a><a id="turing-domain-10-instructions-shared-return-1"></a><a id="turing-domain-10-instructions-shared-return-2"></a><a id="turing-domain-10-instructions-shared-return-3"></a><a id="turing-domain-10-instructions-shared-return-4"></a><a id="turing-domain-10-instructions-shared-return-5"></a><a id="turing-domain-10-instructions-shared-return-6"></a><a id="turing-domain-10-instructions-shared-return-7"></a><a id="turing-domain-10-instructions-shared-return-8"></a><a id="turing-domain-10-instructions-shared-return-9"></a><a id="turing-domain-10-instructions-shared-return-10"></a><a id="turing-domain-10-instructions-shared-return-11"></a><a id="turing-domain-10-instructions-shared-return-12"></a><a id="turing-domain-10-instructions-shared-return-13"></a><a id="turing-domain-10-instructions-shared-return-14"></a><a id="turing-domain-10-instructions-shared-return-15"></a><a id="turing-domain-10-instructions-shared-return-16"></a><a id="turing-domain-10-instructions-shared-return-17"></a><a id="turing-domain-10-instructions-shared-return-18"></a><a id="turing-domain-10-instructions-shared-return-19"></a><a id="turing-domain-10-instructions-shared-return-20"></a><a id="turing-domain-10-instructions-shared-return-21"></a><a id="turing-domain-10-instructions-shared-return-22"></a><a id="turing-domain-10-instructions-shared-return-23"></a><a id="turing-domain-10-instructions-shared-return-24"></a><a id="turing-domain-10-instructions-shared-return-25"></a><a id="turing-domain-10-instructions-shared-return-26"></a><a id="turing-domain-10-instructions-shared-return-27"></a><a id="turing-domain-10-instructions-shared-return-28"></a><a id="turing-domain-10-instructions-shared-return-29"></a><a id="turing-domain-10-instructions-shared-return-30"></a><a id="turing-domain-10-instructions-shared-return-31"></a>

Historical only: [Turing Domain (10 Instructions + shared RETURN)](instruction-set-history.md#turing-domain-10-instructions-shared-return).

### DREAD (opcode 16)

<a id="dread-opcode-16-1"></a><a id="dread-opcode-16-2"></a><a id="dread-opcode-16-3"></a><a id="dread-opcode-16-4"></a><a id="dread-opcode-16-5"></a><a id="dread-opcode-16-6"></a><a id="dread-opcode-16-7"></a><a id="dread-opcode-16-8"></a><a id="dread-opcode-16-9"></a><a id="dread-opcode-16-10"></a><a id="dread-opcode-16-11"></a><a id="dread-opcode-16-12"></a><a id="dread-opcode-16-13"></a><a id="dread-opcode-16-14"></a><a id="dread-opcode-16-15"></a><a id="dread-opcode-16-16"></a><a id="dread-opcode-16-17"></a><a id="dread-opcode-16-18"></a><a id="dread-opcode-16-19"></a><a id="dread-opcode-16-20"></a><a id="dread-opcode-16-21"></a><a id="dread-opcode-16-22"></a><a id="dread-opcode-16-23"></a><a id="dread-opcode-16-24"></a><a id="dread-opcode-16-25"></a><a id="dread-opcode-16-26"></a><a id="dread-opcode-16-27"></a><a id="dread-opcode-16-28"></a><a id="dread-opcode-16-29"></a><a id="dread-opcode-16-30"></a><a id="dread-opcode-16-31"></a>

Historical only: [DREAD (opcode 16)](instruction-set-history.md#dread-opcode-16).

### DWRITE (opcode 17)

<a id="dwrite-opcode-17-1"></a><a id="dwrite-opcode-17-2"></a><a id="dwrite-opcode-17-3"></a><a id="dwrite-opcode-17-4"></a><a id="dwrite-opcode-17-5"></a><a id="dwrite-opcode-17-6"></a><a id="dwrite-opcode-17-7"></a><a id="dwrite-opcode-17-8"></a><a id="dwrite-opcode-17-9"></a><a id="dwrite-opcode-17-10"></a><a id="dwrite-opcode-17-11"></a><a id="dwrite-opcode-17-12"></a><a id="dwrite-opcode-17-13"></a><a id="dwrite-opcode-17-14"></a><a id="dwrite-opcode-17-15"></a><a id="dwrite-opcode-17-16"></a><a id="dwrite-opcode-17-17"></a><a id="dwrite-opcode-17-18"></a><a id="dwrite-opcode-17-19"></a><a id="dwrite-opcode-17-20"></a><a id="dwrite-opcode-17-21"></a><a id="dwrite-opcode-17-22"></a><a id="dwrite-opcode-17-23"></a><a id="dwrite-opcode-17-24"></a><a id="dwrite-opcode-17-25"></a><a id="dwrite-opcode-17-26"></a><a id="dwrite-opcode-17-27"></a><a id="dwrite-opcode-17-28"></a><a id="dwrite-opcode-17-29"></a><a id="dwrite-opcode-17-30"></a><a id="dwrite-opcode-17-31"></a>

Historical only: [DWRITE (opcode 17)](instruction-set-history.md#dwrite-opcode-17).

### BFEXT (opcode 18)

<a id="bfext-opcode-18-1"></a><a id="bfext-opcode-18-2"></a><a id="bfext-opcode-18-3"></a><a id="bfext-opcode-18-4"></a><a id="bfext-opcode-18-5"></a><a id="bfext-opcode-18-6"></a><a id="bfext-opcode-18-7"></a><a id="bfext-opcode-18-8"></a><a id="bfext-opcode-18-9"></a><a id="bfext-opcode-18-10"></a><a id="bfext-opcode-18-11"></a><a id="bfext-opcode-18-12"></a><a id="bfext-opcode-18-13"></a><a id="bfext-opcode-18-14"></a><a id="bfext-opcode-18-15"></a><a id="bfext-opcode-18-16"></a><a id="bfext-opcode-18-17"></a><a id="bfext-opcode-18-18"></a><a id="bfext-opcode-18-19"></a><a id="bfext-opcode-18-20"></a><a id="bfext-opcode-18-21"></a><a id="bfext-opcode-18-22"></a><a id="bfext-opcode-18-23"></a><a id="bfext-opcode-18-24"></a><a id="bfext-opcode-18-25"></a><a id="bfext-opcode-18-26"></a><a id="bfext-opcode-18-27"></a><a id="bfext-opcode-18-28"></a><a id="bfext-opcode-18-29"></a><a id="bfext-opcode-18-30"></a><a id="bfext-opcode-18-31"></a>

Historical only: [BFEXT (opcode 18)](instruction-set-history.md#bfext-opcode-18).

### BFINS (opcode 19)

<a id="bfins-opcode-19-1"></a><a id="bfins-opcode-19-2"></a><a id="bfins-opcode-19-3"></a><a id="bfins-opcode-19-4"></a><a id="bfins-opcode-19-5"></a><a id="bfins-opcode-19-6"></a><a id="bfins-opcode-19-7"></a><a id="bfins-opcode-19-8"></a><a id="bfins-opcode-19-9"></a><a id="bfins-opcode-19-10"></a><a id="bfins-opcode-19-11"></a><a id="bfins-opcode-19-12"></a><a id="bfins-opcode-19-13"></a><a id="bfins-opcode-19-14"></a><a id="bfins-opcode-19-15"></a><a id="bfins-opcode-19-16"></a><a id="bfins-opcode-19-17"></a><a id="bfins-opcode-19-18"></a><a id="bfins-opcode-19-19"></a><a id="bfins-opcode-19-20"></a><a id="bfins-opcode-19-21"></a><a id="bfins-opcode-19-22"></a><a id="bfins-opcode-19-23"></a><a id="bfins-opcode-19-24"></a><a id="bfins-opcode-19-25"></a><a id="bfins-opcode-19-26"></a><a id="bfins-opcode-19-27"></a><a id="bfins-opcode-19-28"></a><a id="bfins-opcode-19-29"></a><a id="bfins-opcode-19-30"></a><a id="bfins-opcode-19-31"></a>

Historical only: [BFINS (opcode 19)](instruction-set-history.md#bfins-opcode-19).

### MCMP (opcode 20)

<a id="mcmp-opcode-20-1"></a><a id="mcmp-opcode-20-2"></a><a id="mcmp-opcode-20-3"></a><a id="mcmp-opcode-20-4"></a><a id="mcmp-opcode-20-5"></a><a id="mcmp-opcode-20-6"></a><a id="mcmp-opcode-20-7"></a><a id="mcmp-opcode-20-8"></a><a id="mcmp-opcode-20-9"></a><a id="mcmp-opcode-20-10"></a><a id="mcmp-opcode-20-11"></a><a id="mcmp-opcode-20-12"></a><a id="mcmp-opcode-20-13"></a><a id="mcmp-opcode-20-14"></a><a id="mcmp-opcode-20-15"></a><a id="mcmp-opcode-20-16"></a><a id="mcmp-opcode-20-17"></a><a id="mcmp-opcode-20-18"></a><a id="mcmp-opcode-20-19"></a><a id="mcmp-opcode-20-20"></a><a id="mcmp-opcode-20-21"></a><a id="mcmp-opcode-20-22"></a><a id="mcmp-opcode-20-23"></a><a id="mcmp-opcode-20-24"></a><a id="mcmp-opcode-20-25"></a><a id="mcmp-opcode-20-26"></a><a id="mcmp-opcode-20-27"></a><a id="mcmp-opcode-20-28"></a><a id="mcmp-opcode-20-29"></a><a id="mcmp-opcode-20-30"></a><a id="mcmp-opcode-20-31"></a>

Historical only: [MCMP (opcode 20)](instruction-set-history.md#mcmp-opcode-20).

### IADD (opcode 21)

<a id="iadd-opcode-21-1"></a><a id="iadd-opcode-21-2"></a><a id="iadd-opcode-21-3"></a><a id="iadd-opcode-21-4"></a><a id="iadd-opcode-21-5"></a><a id="iadd-opcode-21-6"></a><a id="iadd-opcode-21-7"></a><a id="iadd-opcode-21-8"></a><a id="iadd-opcode-21-9"></a><a id="iadd-opcode-21-10"></a><a id="iadd-opcode-21-11"></a><a id="iadd-opcode-21-12"></a><a id="iadd-opcode-21-13"></a><a id="iadd-opcode-21-14"></a><a id="iadd-opcode-21-15"></a><a id="iadd-opcode-21-16"></a><a id="iadd-opcode-21-17"></a><a id="iadd-opcode-21-18"></a><a id="iadd-opcode-21-19"></a><a id="iadd-opcode-21-20"></a><a id="iadd-opcode-21-21"></a><a id="iadd-opcode-21-22"></a><a id="iadd-opcode-21-23"></a><a id="iadd-opcode-21-24"></a><a id="iadd-opcode-21-25"></a><a id="iadd-opcode-21-26"></a><a id="iadd-opcode-21-27"></a><a id="iadd-opcode-21-28"></a><a id="iadd-opcode-21-29"></a><a id="iadd-opcode-21-30"></a><a id="iadd-opcode-21-31"></a>

Historical only: [IADD (opcode 21)](instruction-set-history.md#iadd-opcode-21).

### ISUB (opcode 22)

<a id="isub-opcode-22-1"></a><a id="isub-opcode-22-2"></a><a id="isub-opcode-22-3"></a><a id="isub-opcode-22-4"></a><a id="isub-opcode-22-5"></a><a id="isub-opcode-22-6"></a><a id="isub-opcode-22-7"></a><a id="isub-opcode-22-8"></a><a id="isub-opcode-22-9"></a><a id="isub-opcode-22-10"></a><a id="isub-opcode-22-11"></a><a id="isub-opcode-22-12"></a><a id="isub-opcode-22-13"></a><a id="isub-opcode-22-14"></a><a id="isub-opcode-22-15"></a><a id="isub-opcode-22-16"></a><a id="isub-opcode-22-17"></a><a id="isub-opcode-22-18"></a><a id="isub-opcode-22-19"></a><a id="isub-opcode-22-20"></a><a id="isub-opcode-22-21"></a><a id="isub-opcode-22-22"></a><a id="isub-opcode-22-23"></a><a id="isub-opcode-22-24"></a><a id="isub-opcode-22-25"></a><a id="isub-opcode-22-26"></a><a id="isub-opcode-22-27"></a><a id="isub-opcode-22-28"></a><a id="isub-opcode-22-29"></a><a id="isub-opcode-22-30"></a><a id="isub-opcode-22-31"></a>

Historical only: [ISUB (opcode 22)](instruction-set-history.md#isub-opcode-22).

### BRANCH (opcode 23)

<a id="branch-opcode-23-1"></a><a id="branch-opcode-23-2"></a><a id="branch-opcode-23-3"></a><a id="branch-opcode-23-4"></a><a id="branch-opcode-23-5"></a><a id="branch-opcode-23-6"></a><a id="branch-opcode-23-7"></a><a id="branch-opcode-23-8"></a><a id="branch-opcode-23-9"></a><a id="branch-opcode-23-10"></a><a id="branch-opcode-23-11"></a><a id="branch-opcode-23-12"></a><a id="branch-opcode-23-13"></a><a id="branch-opcode-23-14"></a><a id="branch-opcode-23-15"></a><a id="branch-opcode-23-16"></a><a id="branch-opcode-23-17"></a><a id="branch-opcode-23-18"></a><a id="branch-opcode-23-19"></a><a id="branch-opcode-23-20"></a><a id="branch-opcode-23-21"></a><a id="branch-opcode-23-22"></a><a id="branch-opcode-23-23"></a><a id="branch-opcode-23-24"></a><a id="branch-opcode-23-25"></a><a id="branch-opcode-23-26"></a><a id="branch-opcode-23-27"></a><a id="branch-opcode-23-28"></a><a id="branch-opcode-23-29"></a><a id="branch-opcode-23-30"></a><a id="branch-opcode-23-31"></a>

Historical only: [BRANCH (opcode 23)](instruction-set-history.md#branch-opcode-23).

### SHL (opcode 24)

<a id="shl-opcode-24-1"></a><a id="shl-opcode-24-2"></a><a id="shl-opcode-24-3"></a><a id="shl-opcode-24-4"></a><a id="shl-opcode-24-5"></a><a id="shl-opcode-24-6"></a><a id="shl-opcode-24-7"></a><a id="shl-opcode-24-8"></a><a id="shl-opcode-24-9"></a><a id="shl-opcode-24-10"></a><a id="shl-opcode-24-11"></a><a id="shl-opcode-24-12"></a><a id="shl-opcode-24-13"></a><a id="shl-opcode-24-14"></a><a id="shl-opcode-24-15"></a><a id="shl-opcode-24-16"></a><a id="shl-opcode-24-17"></a><a id="shl-opcode-24-18"></a><a id="shl-opcode-24-19"></a><a id="shl-opcode-24-20"></a><a id="shl-opcode-24-21"></a><a id="shl-opcode-24-22"></a><a id="shl-opcode-24-23"></a><a id="shl-opcode-24-24"></a><a id="shl-opcode-24-25"></a><a id="shl-opcode-24-26"></a><a id="shl-opcode-24-27"></a><a id="shl-opcode-24-28"></a><a id="shl-opcode-24-29"></a><a id="shl-opcode-24-30"></a><a id="shl-opcode-24-31"></a>

Historical only: [SHL (opcode 24)](instruction-set-history.md#shl-opcode-24).

### SHR (opcode 25)

<a id="shr-opcode-25-1"></a><a id="shr-opcode-25-2"></a><a id="shr-opcode-25-3"></a><a id="shr-opcode-25-4"></a><a id="shr-opcode-25-5"></a><a id="shr-opcode-25-6"></a><a id="shr-opcode-25-7"></a><a id="shr-opcode-25-8"></a><a id="shr-opcode-25-9"></a><a id="shr-opcode-25-10"></a><a id="shr-opcode-25-11"></a><a id="shr-opcode-25-12"></a><a id="shr-opcode-25-13"></a><a id="shr-opcode-25-14"></a><a id="shr-opcode-25-15"></a><a id="shr-opcode-25-16"></a><a id="shr-opcode-25-17"></a><a id="shr-opcode-25-18"></a><a id="shr-opcode-25-19"></a><a id="shr-opcode-25-20"></a><a id="shr-opcode-25-21"></a><a id="shr-opcode-25-22"></a><a id="shr-opcode-25-23"></a><a id="shr-opcode-25-24"></a><a id="shr-opcode-25-25"></a><a id="shr-opcode-25-26"></a><a id="shr-opcode-25-27"></a><a id="shr-opcode-25-28"></a><a id="shr-opcode-25-29"></a><a id="shr-opcode-25-30"></a><a id="shr-opcode-25-31"></a>

Historical only: [SHR (opcode 25)](instruction-set-history.md#shr-opcode-25).

## Assembly Syntax

<a id="assembly-syntax-1"></a><a id="assembly-syntax-2"></a><a id="assembly-syntax-3"></a><a id="assembly-syntax-4"></a><a id="assembly-syntax-5"></a><a id="assembly-syntax-6"></a><a id="assembly-syntax-7"></a><a id="assembly-syntax-8"></a><a id="assembly-syntax-9"></a><a id="assembly-syntax-10"></a><a id="assembly-syntax-11"></a><a id="assembly-syntax-12"></a><a id="assembly-syntax-13"></a><a id="assembly-syntax-14"></a><a id="assembly-syntax-15"></a><a id="assembly-syntax-16"></a><a id="assembly-syntax-17"></a><a id="assembly-syntax-18"></a><a id="assembly-syntax-19"></a><a id="assembly-syntax-20"></a><a id="assembly-syntax-21"></a><a id="assembly-syntax-22"></a><a id="assembly-syntax-23"></a><a id="assembly-syntax-24"></a><a id="assembly-syntax-25"></a><a id="assembly-syntax-26"></a><a id="assembly-syntax-27"></a><a id="assembly-syntax-28"></a><a id="assembly-syntax-29"></a><a id="assembly-syntax-30"></a><a id="assembly-syntax-31"></a>

Historical only: [Assembly Syntax](instruction-set-history.md#assembly-syntax).

### Labels

<a id="labels-1"></a><a id="labels-2"></a><a id="labels-3"></a><a id="labels-4"></a><a id="labels-5"></a><a id="labels-6"></a><a id="labels-7"></a><a id="labels-8"></a><a id="labels-9"></a><a id="labels-10"></a><a id="labels-11"></a><a id="labels-12"></a><a id="labels-13"></a><a id="labels-14"></a><a id="labels-15"></a><a id="labels-16"></a><a id="labels-17"></a><a id="labels-18"></a><a id="labels-19"></a><a id="labels-20"></a><a id="labels-21"></a><a id="labels-22"></a><a id="labels-23"></a><a id="labels-24"></a><a id="labels-25"></a><a id="labels-26"></a><a id="labels-27"></a><a id="labels-28"></a><a id="labels-29"></a><a id="labels-30"></a><a id="labels-31"></a>

Historical only: [Labels](instruction-set-history.md#labels).

### Comments

<a id="comments-1"></a><a id="comments-2"></a><a id="comments-3"></a><a id="comments-4"></a><a id="comments-5"></a><a id="comments-6"></a><a id="comments-7"></a><a id="comments-8"></a><a id="comments-9"></a><a id="comments-10"></a><a id="comments-11"></a><a id="comments-12"></a><a id="comments-13"></a><a id="comments-14"></a><a id="comments-15"></a><a id="comments-16"></a><a id="comments-17"></a><a id="comments-18"></a><a id="comments-19"></a><a id="comments-20"></a><a id="comments-21"></a><a id="comments-22"></a><a id="comments-23"></a><a id="comments-24"></a><a id="comments-25"></a><a id="comments-26"></a><a id="comments-27"></a><a id="comments-28"></a><a id="comments-29"></a><a id="comments-30"></a><a id="comments-31"></a>

Historical only: [Comments](instruction-set-history.md#comments).

### Register Names

<a id="register-names-1"></a><a id="register-names-2"></a><a id="register-names-3"></a><a id="register-names-4"></a><a id="register-names-5"></a><a id="register-names-6"></a><a id="register-names-7"></a><a id="register-names-8"></a><a id="register-names-9"></a><a id="register-names-10"></a><a id="register-names-11"></a><a id="register-names-12"></a><a id="register-names-13"></a><a id="register-names-14"></a><a id="register-names-15"></a><a id="register-names-16"></a><a id="register-names-17"></a><a id="register-names-18"></a><a id="register-names-19"></a><a id="register-names-20"></a><a id="register-names-21"></a><a id="register-names-22"></a><a id="register-names-23"></a><a id="register-names-24"></a><a id="register-names-25"></a><a id="register-names-26"></a><a id="register-names-27"></a><a id="register-names-28"></a><a id="register-names-29"></a><a id="register-names-30"></a><a id="register-names-31"></a>

Historical only: [Register Names](instruction-set-history.md#register-names).

### Immediate Values

<a id="immediate-values-1"></a><a id="immediate-values-2"></a><a id="immediate-values-3"></a><a id="immediate-values-4"></a><a id="immediate-values-5"></a><a id="immediate-values-6"></a><a id="immediate-values-7"></a><a id="immediate-values-8"></a><a id="immediate-values-9"></a><a id="immediate-values-10"></a><a id="immediate-values-11"></a><a id="immediate-values-12"></a><a id="immediate-values-13"></a><a id="immediate-values-14"></a><a id="immediate-values-15"></a><a id="immediate-values-16"></a><a id="immediate-values-17"></a><a id="immediate-values-18"></a><a id="immediate-values-19"></a><a id="immediate-values-20"></a><a id="immediate-values-21"></a><a id="immediate-values-22"></a><a id="immediate-values-23"></a><a id="immediate-values-24"></a><a id="immediate-values-25"></a><a id="immediate-values-26"></a><a id="immediate-values-27"></a><a id="immediate-values-28"></a><a id="immediate-values-29"></a><a id="immediate-values-30"></a><a id="immediate-values-31"></a>

Historical only: [Immediate Values](instruction-set-history.md#immediate-values).

## Three-Tier Fault Recovery (Task #1077)

<a id="three-tier-fault-recovery-task-1077-1"></a><a id="three-tier-fault-recovery-task-1077-2"></a><a id="three-tier-fault-recovery-task-1077-3"></a><a id="three-tier-fault-recovery-task-1077-4"></a><a id="three-tier-fault-recovery-task-1077-5"></a><a id="three-tier-fault-recovery-task-1077-6"></a><a id="three-tier-fault-recovery-task-1077-7"></a><a id="three-tier-fault-recovery-task-1077-8"></a><a id="three-tier-fault-recovery-task-1077-9"></a><a id="three-tier-fault-recovery-task-1077-10"></a><a id="three-tier-fault-recovery-task-1077-11"></a><a id="three-tier-fault-recovery-task-1077-12"></a><a id="three-tier-fault-recovery-task-1077-13"></a><a id="three-tier-fault-recovery-task-1077-14"></a><a id="three-tier-fault-recovery-task-1077-15"></a><a id="three-tier-fault-recovery-task-1077-16"></a><a id="three-tier-fault-recovery-task-1077-17"></a><a id="three-tier-fault-recovery-task-1077-18"></a><a id="three-tier-fault-recovery-task-1077-19"></a><a id="three-tier-fault-recovery-task-1077-20"></a><a id="three-tier-fault-recovery-task-1077-21"></a><a id="three-tier-fault-recovery-task-1077-22"></a><a id="three-tier-fault-recovery-task-1077-23"></a><a id="three-tier-fault-recovery-task-1077-24"></a><a id="three-tier-fault-recovery-task-1077-25"></a><a id="three-tier-fault-recovery-task-1077-26"></a><a id="three-tier-fault-recovery-task-1077-27"></a><a id="three-tier-fault-recovery-task-1077-28"></a><a id="three-tier-fault-recovery-task-1077-29"></a><a id="three-tier-fault-recovery-task-1077-30"></a><a id="three-tier-fault-recovery-task-1077-31"></a>

Historical only: [Three-Tier Fault Recovery (Task #1077)](instruction-set-history.md#three-tier-fault-recovery-task-1077).

### Tier 1 — `.catch` Method on the Faulting Abstraction

<a id="tier-1-catch-method-on-the-faulting-abstraction"></a><a id="tier-1--catch-method-on-the-faulting-abstraction"></a>

<a id="tier-1--catch-method-on-the-faulting-abstraction-1"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-2"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-3"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-4"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-5"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-6"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-7"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-8"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-9"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-10"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-11"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-12"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-13"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-14"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-15"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-16"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-17"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-18"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-19"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-20"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-21"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-22"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-23"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-24"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-25"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-26"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-27"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-28"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-29"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-30"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-31"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-1"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-2"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-3"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-4"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-5"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-6"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-7"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-8"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-9"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-10"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-11"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-12"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-13"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-14"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-15"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-16"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-17"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-18"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-19"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-20"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-21"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-22"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-23"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-24"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-25"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-26"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-27"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-28"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-29"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-30"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-31"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-1"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-2"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-3"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-4"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-5"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-6"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-7"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-8"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-9"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-10"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-11"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-12"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-13"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-14"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-15"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-16"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-17"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-18"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-19"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-20"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-21"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-22"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-23"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-24"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-25"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-26"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-27"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-28"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-29"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-30"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-31"></a>

Historical only: [Tier 1 — `.catch` Method on the Faulting Abstraction](instruction-set-history.md#tier-1-catch-method-on-the-faulting-abstraction).

### Tier 2 — Scheduler.IRQ (Hidden ELOADCALL)

<a id="tier-2--schedulerirq-hidden-eloadcall"></a>

<a id="tier-2--schedulerirq-hidden-eloadcall-1"></a><a id="tier-2--schedulerirq-hidden-eloadcall-2"></a><a id="tier-2--schedulerirq-hidden-eloadcall-3"></a><a id="tier-2--schedulerirq-hidden-eloadcall-4"></a><a id="tier-2--schedulerirq-hidden-eloadcall-5"></a><a id="tier-2--schedulerirq-hidden-eloadcall-6"></a><a id="tier-2--schedulerirq-hidden-eloadcall-7"></a><a id="tier-2--schedulerirq-hidden-eloadcall-8"></a><a id="tier-2--schedulerirq-hidden-eloadcall-9"></a><a id="tier-2--schedulerirq-hidden-eloadcall-10"></a><a id="tier-2--schedulerirq-hidden-eloadcall-11"></a><a id="tier-2--schedulerirq-hidden-eloadcall-12"></a><a id="tier-2--schedulerirq-hidden-eloadcall-13"></a><a id="tier-2--schedulerirq-hidden-eloadcall-14"></a><a id="tier-2--schedulerirq-hidden-eloadcall-15"></a><a id="tier-2--schedulerirq-hidden-eloadcall-16"></a><a id="tier-2--schedulerirq-hidden-eloadcall-17"></a><a id="tier-2--schedulerirq-hidden-eloadcall-18"></a><a id="tier-2--schedulerirq-hidden-eloadcall-19"></a><a id="tier-2--schedulerirq-hidden-eloadcall-20"></a><a id="tier-2--schedulerirq-hidden-eloadcall-21"></a><a id="tier-2--schedulerirq-hidden-eloadcall-22"></a><a id="tier-2--schedulerirq-hidden-eloadcall-23"></a><a id="tier-2--schedulerirq-hidden-eloadcall-24"></a><a id="tier-2--schedulerirq-hidden-eloadcall-25"></a><a id="tier-2--schedulerirq-hidden-eloadcall-26"></a><a id="tier-2--schedulerirq-hidden-eloadcall-27"></a><a id="tier-2--schedulerirq-hidden-eloadcall-28"></a><a id="tier-2--schedulerirq-hidden-eloadcall-29"></a><a id="tier-2--schedulerirq-hidden-eloadcall-30"></a><a id="tier-2--schedulerirq-hidden-eloadcall-31"></a><a id="tier-2-schedulerirq-hidden-eloadcall-1"></a><a id="tier-2-schedulerirq-hidden-eloadcall-2"></a><a id="tier-2-schedulerirq-hidden-eloadcall-3"></a><a id="tier-2-schedulerirq-hidden-eloadcall-4"></a><a id="tier-2-schedulerirq-hidden-eloadcall-5"></a><a id="tier-2-schedulerirq-hidden-eloadcall-6"></a><a id="tier-2-schedulerirq-hidden-eloadcall-7"></a><a id="tier-2-schedulerirq-hidden-eloadcall-8"></a><a id="tier-2-schedulerirq-hidden-eloadcall-9"></a><a id="tier-2-schedulerirq-hidden-eloadcall-10"></a><a id="tier-2-schedulerirq-hidden-eloadcall-11"></a><a id="tier-2-schedulerirq-hidden-eloadcall-12"></a><a id="tier-2-schedulerirq-hidden-eloadcall-13"></a><a id="tier-2-schedulerirq-hidden-eloadcall-14"></a><a id="tier-2-schedulerirq-hidden-eloadcall-15"></a><a id="tier-2-schedulerirq-hidden-eloadcall-16"></a><a id="tier-2-schedulerirq-hidden-eloadcall-17"></a><a id="tier-2-schedulerirq-hidden-eloadcall-18"></a><a id="tier-2-schedulerirq-hidden-eloadcall-19"></a><a id="tier-2-schedulerirq-hidden-eloadcall-20"></a><a id="tier-2-schedulerirq-hidden-eloadcall-21"></a><a id="tier-2-schedulerirq-hidden-eloadcall-22"></a><a id="tier-2-schedulerirq-hidden-eloadcall-23"></a><a id="tier-2-schedulerirq-hidden-eloadcall-24"></a><a id="tier-2-schedulerirq-hidden-eloadcall-25"></a><a id="tier-2-schedulerirq-hidden-eloadcall-26"></a><a id="tier-2-schedulerirq-hidden-eloadcall-27"></a><a id="tier-2-schedulerirq-hidden-eloadcall-28"></a><a id="tier-2-schedulerirq-hidden-eloadcall-29"></a><a id="tier-2-schedulerirq-hidden-eloadcall-30"></a><a id="tier-2-schedulerirq-hidden-eloadcall-31"></a>

Historical only: [Tier 2 — Scheduler.IRQ (Hidden ELOADCALL)](instruction-set-history.md#tier-2-schedulerirq-hidden-eloadcall).

### Tier 3 — Double-Fault (CHANGE to CR13)

<a id="tier-3--double-fault-change-to-cr13"></a>

<a id="tier-3--double-fault-change-to-cr13-1"></a><a id="tier-3--double-fault-change-to-cr13-2"></a><a id="tier-3--double-fault-change-to-cr13-3"></a><a id="tier-3--double-fault-change-to-cr13-4"></a><a id="tier-3--double-fault-change-to-cr13-5"></a><a id="tier-3--double-fault-change-to-cr13-6"></a><a id="tier-3--double-fault-change-to-cr13-7"></a><a id="tier-3--double-fault-change-to-cr13-8"></a><a id="tier-3--double-fault-change-to-cr13-9"></a><a id="tier-3--double-fault-change-to-cr13-10"></a><a id="tier-3--double-fault-change-to-cr13-11"></a><a id="tier-3--double-fault-change-to-cr13-12"></a><a id="tier-3--double-fault-change-to-cr13-13"></a><a id="tier-3--double-fault-change-to-cr13-14"></a><a id="tier-3--double-fault-change-to-cr13-15"></a><a id="tier-3--double-fault-change-to-cr13-16"></a><a id="tier-3--double-fault-change-to-cr13-17"></a><a id="tier-3--double-fault-change-to-cr13-18"></a><a id="tier-3--double-fault-change-to-cr13-19"></a><a id="tier-3--double-fault-change-to-cr13-20"></a><a id="tier-3--double-fault-change-to-cr13-21"></a><a id="tier-3--double-fault-change-to-cr13-22"></a><a id="tier-3--double-fault-change-to-cr13-23"></a><a id="tier-3--double-fault-change-to-cr13-24"></a><a id="tier-3--double-fault-change-to-cr13-25"></a><a id="tier-3--double-fault-change-to-cr13-26"></a><a id="tier-3--double-fault-change-to-cr13-27"></a><a id="tier-3--double-fault-change-to-cr13-28"></a><a id="tier-3--double-fault-change-to-cr13-29"></a><a id="tier-3--double-fault-change-to-cr13-30"></a><a id="tier-3--double-fault-change-to-cr13-31"></a><a id="tier-3-double-fault-change-to-cr13-1"></a><a id="tier-3-double-fault-change-to-cr13-2"></a><a id="tier-3-double-fault-change-to-cr13-3"></a><a id="tier-3-double-fault-change-to-cr13-4"></a><a id="tier-3-double-fault-change-to-cr13-5"></a><a id="tier-3-double-fault-change-to-cr13-6"></a><a id="tier-3-double-fault-change-to-cr13-7"></a><a id="tier-3-double-fault-change-to-cr13-8"></a><a id="tier-3-double-fault-change-to-cr13-9"></a><a id="tier-3-double-fault-change-to-cr13-10"></a><a id="tier-3-double-fault-change-to-cr13-11"></a><a id="tier-3-double-fault-change-to-cr13-12"></a><a id="tier-3-double-fault-change-to-cr13-13"></a><a id="tier-3-double-fault-change-to-cr13-14"></a><a id="tier-3-double-fault-change-to-cr13-15"></a><a id="tier-3-double-fault-change-to-cr13-16"></a><a id="tier-3-double-fault-change-to-cr13-17"></a><a id="tier-3-double-fault-change-to-cr13-18"></a><a id="tier-3-double-fault-change-to-cr13-19"></a><a id="tier-3-double-fault-change-to-cr13-20"></a><a id="tier-3-double-fault-change-to-cr13-21"></a><a id="tier-3-double-fault-change-to-cr13-22"></a><a id="tier-3-double-fault-change-to-cr13-23"></a><a id="tier-3-double-fault-change-to-cr13-24"></a><a id="tier-3-double-fault-change-to-cr13-25"></a><a id="tier-3-double-fault-change-to-cr13-26"></a><a id="tier-3-double-fault-change-to-cr13-27"></a><a id="tier-3-double-fault-change-to-cr13-28"></a><a id="tier-3-double-fault-change-to-cr13-29"></a><a id="tier-3-double-fault-change-to-cr13-30"></a><a id="tier-3-double-fault-change-to-cr13-31"></a>

Historical only: [Tier 3 — Double-Fault (CHANGE to CR13)](instruction-set-history.md#tier-3-double-fault-change-to-cr13).

### Scheduler.pause and Timer Interrupts

<a id="schedulerpause-and-timer-interrupts-1"></a><a id="schedulerpause-and-timer-interrupts-2"></a><a id="schedulerpause-and-timer-interrupts-3"></a><a id="schedulerpause-and-timer-interrupts-4"></a><a id="schedulerpause-and-timer-interrupts-5"></a><a id="schedulerpause-and-timer-interrupts-6"></a><a id="schedulerpause-and-timer-interrupts-7"></a><a id="schedulerpause-and-timer-interrupts-8"></a><a id="schedulerpause-and-timer-interrupts-9"></a><a id="schedulerpause-and-timer-interrupts-10"></a><a id="schedulerpause-and-timer-interrupts-11"></a><a id="schedulerpause-and-timer-interrupts-12"></a><a id="schedulerpause-and-timer-interrupts-13"></a><a id="schedulerpause-and-timer-interrupts-14"></a><a id="schedulerpause-and-timer-interrupts-15"></a><a id="schedulerpause-and-timer-interrupts-16"></a><a id="schedulerpause-and-timer-interrupts-17"></a><a id="schedulerpause-and-timer-interrupts-18"></a><a id="schedulerpause-and-timer-interrupts-19"></a><a id="schedulerpause-and-timer-interrupts-20"></a><a id="schedulerpause-and-timer-interrupts-21"></a><a id="schedulerpause-and-timer-interrupts-22"></a><a id="schedulerpause-and-timer-interrupts-23"></a><a id="schedulerpause-and-timer-interrupts-24"></a><a id="schedulerpause-and-timer-interrupts-25"></a><a id="schedulerpause-and-timer-interrupts-26"></a><a id="schedulerpause-and-timer-interrupts-27"></a><a id="schedulerpause-and-timer-interrupts-28"></a><a id="schedulerpause-and-timer-interrupts-29"></a><a id="schedulerpause-and-timer-interrupts-30"></a><a id="schedulerpause-and-timer-interrupts-31"></a>

Historical only: [Scheduler.pause and Timer Interrupts](instruction-set-history.md#schedulerpause-and-timer-interrupts).

<a id="church-machine-instruction-set-1"></a><a id="church-machine-instruction-set-2"></a><a id="church-machine-instruction-set-3"></a><a id="church-machine-instruction-set-4"></a><a id="church-machine-instruction-set-5"></a><a id="church-machine-instruction-set-6"></a><a id="church-machine-instruction-set-7"></a><a id="church-machine-instruction-set-8"></a><a id="church-machine-instruction-set-9"></a><a id="church-machine-instruction-set-10"></a><a id="church-machine-instruction-set-11"></a><a id="church-machine-instruction-set-12"></a><a id="church-machine-instruction-set-13"></a><a id="church-machine-instruction-set-14"></a><a id="church-machine-instruction-set-15"></a><a id="church-machine-instruction-set-16"></a><a id="church-machine-instruction-set-17"></a><a id="church-machine-instruction-set-18"></a><a id="church-machine-instruction-set-19"></a><a id="church-machine-instruction-set-20"></a><a id="church-machine-instruction-set-21"></a><a id="church-machine-instruction-set-22"></a><a id="church-machine-instruction-set-23"></a><a id="church-machine-instruction-set-24"></a><a id="church-machine-instruction-set-25"></a><a id="church-machine-instruction-set-26"></a><a id="church-machine-instruction-set-27"></a><a id="church-machine-instruction-set-28"></a><a id="church-machine-instruction-set-29"></a><a id="church-machine-instruction-set-30"></a><a id="church-machine-instruction-set-31"></a>

[Historical baseline copies](instruction-set-history.md#preservation-inventory).

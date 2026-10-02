# ISA compatibility audit — 2026-10-02

## Verdict and scope

**The Amaranth implementation and JavaScript simulator are not ISA-compatible.
LOAD/SAVE is not the only problem.** Matching each other is also insufficient:
both implementations sometimes disagree with the master specification.

Authority: `docs/instruction-set.md`, including its opening precedence rules.
Source baseline: `945b27c9`. This is a full opcode-inventory review with targeted
execution probes, **not exhaustive equivalence certification**. In particular,
all capability states, malformed encodings, asynchronous events, and fault
rollback combinations have not been tested.

No assembler, simulator, RTL, saved LUMP, Namespace, boot image, or bitstream
was changed by this audit. Only audit probes and this report were added.
No synthesis, flashing, physical-board execution, or production action occurred.

Evidence labels:
- **Measured**: executed actual Amaranth logic and/or simulator routines.
- **Source-confirmed**: a concrete difference in active implementation paths;
  not yet reproduced as a full end-to-end instruction trace.
- **Specification gap**: the master lacks an unambiguous encoding or contains
  conflicting baseline descriptions; do not silently choose an implementation.
- **Not certified**: reviewed or tested in part, but not proven equivalent.

## Priority findings

### 1. LOAD/SAVE compact indexing — blocking, measured

The master specifies sign bit 14, magnitude bits 13:4, DR selector bits 3:0.
RTL still wires the entire literal operand into the c-list index.

| Expression (DR11=5) | operand15 | Simulator row | RTL index |
|---|---|---:|---:|
| Immediate 3 | 0x0030 | 3 | 48 |
| DR11 + 3 | 0x003B | 8 | 59 |
| DR11 - 3 | 0x403B | 2 | 16443 |

Evidence: preceding decoder simulation; `hardware/decoder.py:92`,
`hardware/core.py:1440,1758`; simulator `decodeInstruction`,
`_resolveCompactIndex`, `_execLoad`, `_execSave`.

No runtime DR addition/subtraction exists in that RTL path. The 16-bit unit
index interfaces cannot represent the full 32-bit effective index. Arithmetic
overflow/underflow must be detected before narrowing. SAVE's existing row-zero
guard consequently checks the wrong row for the new encoding.

### 2. BFEXT/BFINS field order and invalid ranges — blocking, measured

Simulator/assembler: width in bits 4:0, position in bits 9:5.
RTL: position in bits 4:0, width in bits 9:5.

With DR1=255 and DR2=7, using destination DR2 and source DR1:

| Opcode | imm15 | Simulator DR2 | RTL DR2 |
|---|---|---:|---:|
| BFEXT | 0x0008 | 255 | 0 |
| BFEXT | 0x0088 | 15 | 0 |
| BFINS | 0x0008 | 255 | 7 |
| BFINS | 0x0088 | 4087 | 3847 |

For operand 0x03FF, simulator faults BOUNDS (position 31 + width 31);
RTL retires successfully. BFINS writes 2147483655 in that invalid-range probe.
Both Full and IoT cores reproduce these differences.

Evidence: `hardware/core.py:1653–1716`; simulator `_execBfext`, `_execBfins`.
RTL's comment says width zero means 32, but its mask expression produces zero.
The master describes width and LSB but does not fix their bit positions or
zero-width encoding. Thus the implementation disagreement is proven, while
the final field mapping requires explicit specification reconciliation.

### 3. MCMP operands and flags — blocking, measured/source-confirmed

Master: compare DRd and DRs without storing a result.
Simulator follows that operand rule and uses subtraction flags.
RTL computes DR[src] minus the zero-extended low 14 immediate bits, ignoring
DRdst as an operand; C uses the borrow bit and V is forced to zero.

Probe: DR2=7, DR1=255, MCMP DR2,DR1, imm15=0:
- Simulator: N/Z/C/V = 1/0/0/0.
- RTL, both profiles: 0/0/0/0.

Evidence: `hardware/core.py:1718–1734`, `_execMcmp`, `_setSubFlags`.
The operand discrepancy conflicts directly with the master, not merely with
the simulator. C/V edge cases still need dedicated differential vectors.

### 4. TPERM — multiple independent gaps

| Behavior | Finding | Evidence strength |
|---|---|---|
| EXACT mismatch | Both simulator and RTL raise BIND; master says Z=0, no fault | Measured in both implementations |
| CLEAR on NULL | RTL returns Z=1; simulator returns Z=0; master NULL rule says Z=0 | Measured in both |
| FRAME | Core ties `stack_has_frame` to zero; simulator returns Z=1 for a real non-sentinel frame | Source-confirmed wiring plus isolated unit/simulator probes |
| B modifier | Decoder drops bit 4; unit only receives a four-bit preset, so it cannot implement clearing B | Source-confirmed; unit R probe retains B |
| Attenuation sentinel | Simulator treats imm15=0x7FFF as CR-to-CR permission attenuation; RTL decodes preset 15, a reserved-preset fault | Source-confirmed decode/unit paths |
| Health-check mode | Master places preset in src and bounds offset in imm15; both ordinary implementations decode preset from low imm bits; RTL unit has no offset input | Source-confirmed / specification reconciliation needed |
| Validity and bounds | RTL unit's ordinary check inspects permission bits without Namespace validity/seal/bounds inputs promised by master health-check mode | Source-confirmed; end-to-end stale-capability cases not tested |

Evidence: `hardware/tperm.py`, `hardware/decoder.py:93`,
`hardware/core.py:1420–1430`; simulator `_execTperm`.

Do not fix this by copying simulator behavior wholesale. EXACT is an example
where matching implementations still violate the selected authority.
The master itself also conflicts between a preset-in-src restriction table
and its separately described CR-to-CR sentinel form.

### 5. DREAD/DWRITE — bounds width and permission differences

RTL derives the bound from `limit_offset[:16]`; simulator uses the wider
Namespace limit representation. A DREAD unit probe with limit=65536 and
offset=1 faults BOUNDS because the RTL truncates that limit to zero.
The exact same descriptor has not been driven through a complete JS
Namespace setup; the cross-implementation limit-width difference is
source-confirmed, while the RTL truncation behavior is measured.

Simulator DREAD allows X instead of R when the source is CR14.
RTL DREAD requires R without that exception. An X-only CR14 unit probe
faulted PERM_R, with no read/write. The master's DREAD paragraph requires R;
the simulator exception therefore needs an explicit authority decision,
not an automatic RTL relaxation.

Ordinary RTL R-permitted DREAD performed one read and one DR write.
An overflowing indexed sum (DR=0xFFFFFFFF plus base=1) faulted BOUNDS with
zero reads and writes: this particular RTL containment case passes.

Both current ordinary encodings lack the uniform subtractive-index form
required by the master. The master explicitly says other index roles still
need field mappings; do not reuse the LOAD/SAVE sign bit here without a
specification change because DREAD/DWRITE already use it as a mode bit.

Evidence: `hardware/dread.py:85–171`, `hardware/dwrite.py:102–198`;
simulator `_execDread`, `_execDwrite`.
Abstract-manager dispatch and MMIO authority/fault ordering differ and
remain **not certified**; no complete adversarial MMIO test was run.

### 6. LAMBDA/RETURN context model — source-confirmed, not certified

Simulator LAMBDA saves canonical private-stack state; RTL uses
`lambda_active_reg`/`lambda_pc_reg`, and its lambda RETURN path does not
pop that frame. The master RETURN section explicitly records this as an
unresolved implementation limit. It also records a synthetic boot RETURN
cLoad bypass that is not an approved architectural exemption.

Evidence: `_execLambda`, `hardware/lambda_unit.py`,
`hardware/ret.py:236–250`, master RETURN section.
This audit did not execute a nested LAMBDA/interrupt/context-switch
differential sequence. Passing ordinary RETURN tests does not close this gap.

### 7. SWITCH CR15,CR15 placeholder — source-confirmed master violation

The master requires source CR0–CR11 and INVALID_OP for isolated sources.
Both `_execSwitch` and `hardware/switch.py` instead accept the CR15/CR15
pair as a boot placeholder before the ordinary source/M checks.
The unit has no boot-state qualification on that pair in the inspected path.
The simulator consumes destination M. Full integrated M-state parity on
this special path was not tested.

This is not authority to remove a boot dependency during an audit.
Replace/reconcile it explicitly when correcting the implementation.

### 8. BRANCH target checking — source-level difference requiring a test

Simulator checks the computed relative PC against global memory before
assigning PC. RTL writes the 32-bit byte-address sum to NIA; the inspected
gate checks the current fetch address, not the new target. This can differ
in wrapping, the faulting PC, and the timing of a later fetch fault.

Evidence: `_execBranch`; `hardware/core.py:1021–1025,1735–1744`.
Byte-versus-word representation alone is not a mismatch.
No branch-target overflow/underflow or capability-edge differential probe
was run here, so this remains a test candidate rather than a demonstrated
unauthorized control transfer.

## Complete opcode inventory

| Opcode | Instruction | Audit status |
|---:|---|---|
| 0 | LOAD | Blocking compact-index mismatch |
| 1 | SAVE | Blocking compact-index mismatch; master operand-role conflict |
| 2 | CALL | Indexed CR6 regression tests pass; full transition/fault equivalence not certified |
| 3 | RETURN | Keep-mask/stack regression tests pass; lambda/boot exceptions remain |
| 4 | CHANGE | Thread scheduler/context regression suite passes; all authority and rollback cases not certified |
| 5 | SWITCH | CR15/CR15 master violation; normal transaction parity not fully tested |
| 6 | TPERM | Multiple differences, including shared master violations |
| 7 | LAMBDA | Context/return model difference; nested paths not certified |
| 8–9 | Retired fused ops | Decoder rejects in both profiles; simulator rejects; no restoration proposed |
| 10–15 | Unassigned | RTL decoder rejects; no full simulator execution sweep |
| 16 | DREAD | Bounds width / CR14 permission differences; selected RTL containment passes |
| 17 | DWRITE | Shared bounds-width issue by source; full write/authority parity not certified |
| 18 | BFEXT | Measured field-order and invalid-range mismatch |
| 19 | BFINS | Measured field-order and invalid-range mismatch |
| 20 | MCMP | Measured operand/flag mismatch |
| 21 | IADD | Sampled results/flags match; arithmetic setup/overflow tests pass |
| 22 | ISUB | Sampled results/flags match; arithmetic setup/overflow tests pass |
| 23 | BRANCH | Normal relative form reviewed; target-fault behavior needs differential tests |
| 24 | SHL | Sampled parity plus shift/conditional regressions pass |
| 25 | SHR | Sampled parity plus LSR/ASR/conditional regressions pass |
| 26–29 | Unassigned | RTL decoder rejects; no full simulator execution sweep |
| 30 | WORD data | RTL decoder rejects execution; reserved data is not an executable opcode |
| 31 | Header/data | RTL decoder rejects execution |

Full accepts Church opcodes 0–7 and Turing 16–25. IoT additionally excludes
CHANGE, SWITCH, LAMBDA. That profile restriction is intentional; it is not
evidence that the Full implementations are equivalent.

## Passing checks and exact limits

- All 16 condition codes across all 16 NZCV combinations matched JS's
  condition evaluator in both profiles. Sweep included all 32 opcode values:
  16,384 decoder observations. This tests the condition function, not all
  conditional fault/side-effect ordering.
- 22 full-core arithmetic/bitfield/compare probe executions (11 per profile).
  14 disagreed and 8 matched. JS half invoked the actual execution methods
  with in-memory DR writes/trace sinks, not a full JS boot/fetch path.
- Four standalone TPERM baseline probes, four additional TPERM probes,
  and four DREAD probes. Unit probes do not establish all core wiring behavior.
- **150 existing hardware pytest cases passed** in two runs:
  - `hardware/test_shift_ops.py`
  - `hardware/test_tperm.py`
  - `tests/hardware/test_return_mask.py`
  - `tests/hardware/test_return_stack_contract.py`
  - `tests/hardware/test_indexed_call_cr6.py`
  - `hardware/test_wukong_thread_scheduler_contract.py`

Those tests are regressions for their own contracts, not independent proof
of conformance to every master requirement. This audit did not rerun the
whole application suite or claim that its unrelated failures are resolved.

## Master-document reconciliation needed

1. SAVE baseline says CRd is the destination c-list and CRs is the saved GT;
   both implementations use the opposite roles. The compact operand section
   settles index encoding, not this operand-role contradiction.
2. BFEXT/BFINS do not have an authoritative detailed field mapping here.
3. TPERM mode tables, ordinary exact-set prose, no-trap health-check prose,
   B variants, and attenuation forms need one consistent encoding/contract.
4. CALL prose calls restored CR6 E-only; implementations use a derived c-list
   view. Permissions, units, and method-table examples need reconciliation.
5. Other indexed roles have uniform runtime semantics but no final compact
   bit mapping. Mark them as incomplete, not compatible by assumption.
6. Historical fused-op text is explicitly superseded by the opening
   retirement rule. It must not be used to re-enable opcodes 8/9.

## Reproduction

Audit-only probes are in `.local/isa-audit/`.

```bash
PYTHONPATH=.:${PYTHONPATH:-} python3 .local/isa-audit/probe.py > /tmp/isa-audit-rtl.json
node .local/isa-audit/compare.js /tmp/isa-audit-rtl.json
PYTHONPATH=.:${PYTHONPATH:-} python3 .local/isa-audit/units.py
python3 -m pytest hardware/test_shift_ops.py hardware/test_tperm.py \
  tests/hardware/test_return_mask.py tests/hardware/test_return_stack_contract.py \
  tests/hardware/test_indexed_call_cr6.py \
  hardware/test_wukong_thread_scheduler_contract.py -q --disable-warnings
```

The JSON comparison's `match` is observational, not a master-ISA oracle.
Never interpret a `true` result as approval of an undocumented instruction.

## Recommended correction order

1. Resolve the contradictory/underspecified contracts above without modifying
   saved artifacts; keep settled LOAD/SAVE decisions unchanged.
2. Fix settled blocking differences: compact LOAD/SAVE and MCMP.
3. Correct BFEXT/BFINS and TPERM against the reconciled master, including
   cases where the simulator is also wrong.
4. Complete data-access, SWITCH, LAMBDA/RETURN, and branch containment tests,
   then correct proven remaining gaps.
5. Use an independent ISA oracle plus full fetch/decode/retire comparisons,
   with state snapshots before failed operations. Only then consider a
   separately approved hardware release. No current bitstream is certified
   by this audit.
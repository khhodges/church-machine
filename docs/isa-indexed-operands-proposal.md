# Uniform indexed operands — correction proposal

Status: **prior implementation proposal; not approval of the packet encoding
for the corrected indexing requirement** (2026-10-02).

The controlling requirement is now stated in [ISA reference §1.1](isa_reference.md#11-uniform-indexed-operands--required-semantics):
an indexed instruction adds the selected DR's runtime value to its immediate.
This does not settle the encoding or instruction word count. The packet choices
and implementation checkpoint below are historical design records, not a mandate
to add packet fetching to Amaranth. Do not use them to override that requirement.

## Implementation checkpoint

Implemented: pure JS expression parsing, packet encoding/decoding and arithmetic;
explicit opt-in assembler sizing/relocation and source boundaries; Python
envelope structural validation; isolated Amaranth packet/arithmetic preflight;
and an isolated simulator execution-reference sequencer. Synthetic assembly
output also round-trips through the Python envelope validator.

These components do not enable IDX1 in the IDE. Runtime admission deliberately
rejects it. Envelope hashes prove integrity, not executable authority.
Production per-object bindings, mutation protection, semantic execution,
cross-profile CALL/RETURN, all entry/resume gates, FPGA-core integration and
authenticated transport negotiation remain unimplemented. Existing legacy
execution is unchanged. No user artifacts were rebuilt or hardware flashed.

Detailed contracts:

* [Encoding, source grammar, canonical masks and vectors](isa-indexed-encoding.md)
* [Containment, faults and fault-test admission](isa-indexed-containment.md)
* [Version carrier, boundaries and execution identity](isa-indexed-profile.md)

Where this earlier proposal leaves a rule open, the detailed documents supply
the proposed decision. Exact envelope identifiers and device wire mappings are
not approved by the indexed-operand semantic requirement.

This document records the first milestone: requirements, operand inventory,
containment contract, encoding options, implementation dependencies, and
acceptance criteria. User programs, immutable artifacts, Namespace state, and
hardware images are not changed by this milestone.

## 1. Confirmed requirements

Every indexed operand supports:

```text
immediate
DRn
DRn + immediate
DRn - immediate
```

Any DR0–DR15 may supply the runtime value. The register is not evaluated by
the compiler. Its normal architectural read semantics apply, including DR0.
No source rewrite to a fixed number is permitted.

Containment always applies. Arithmetic cannot manufacture authority, bypass
permissions, wrap an invalid index into an allowed range, or disclose protected
data. Successful normal operations should not introduce extra approval prompts.

## 2. Operand inventory

This separates intended instructions from stale implementations. The current
opcode table still lists retired operations; it is not evidence that they
should be extended or reintroduced.

| Instruction family | Indexed quantity | Unit | Proposed role |
| --- | --- | --- | --- |
| LOAD, SAVE | Source/destination C-list row | Capability word | 0: row |
| SWITCH | C-list row | Capability word | 0: row |
| CHANGE | Authorized context-selection index | CR12/13: source-capability word offset; CR14/15: Namespace ordinal; detailed draft resolves backend disagreement | 0: index |
| CALL, direct capability | Method-table selector | Selector, preserving fast-entry convention | 1: method |
| CALL, indexed capability source | C-list row and method selector, independently | Row / selector | 0: row, 1: method |
| DREAD, DWRITE | Object/device offset | Data word; byte conversion checked separately | 0: offset |
| BRANCH | Relative target displacement | Instruction words, not number of source statements | 0: displacement |
| BFEXT, BFINS | Bit position | Bit, least-significant bit numbered zero | 0: position |

Not new indexed operands: RETURN keep masks, TPERM permission presets, LAMBDA's
capability-register selector, MCMP values, IADD/ISUB arithmetic values, shift
counts, and bit-field widths. Register identifiers themselves remain encoded
register identifiers, not recursively indexed registers.

ELOADCALL and XLOADLAMBDA remain retired under the approved cutover. Residual
assembler/simulator/RTL support must be reconciled, not extended into this
proposal. WORD and LUMP-header values remain non-executable data.

### Current evidence and prerequisites

* `simulator/assembler.js`, `simulator/simulator.js`, `hardware/decoder.py`:
  ordinary LOAD/SAVE index fields consume all 15 immediate bits. There is no
  unused LOAD mode bit to appropriate without changing existing binary meaning.
* CALL currently has separately packed row and method fields. Source-level
  method ordinals and encoded selectors are not interchangeable. Freeze
  direct/named/indexed CALL golden vectors before assigning replacement fields.
* DREAD/DWRITE already have immediate and register-plus-base forms, but their
  ranges and handling are not the requested uniform plus/minus contract.
* `hardware/change.py` has indexed and mask-driven context operations:
  specify each architecturally exposed mode, not an invented universal slot.
* `simulator/simulator.js` reads bit position from the high five field bits
  and width from the low five. `hardware/core.py` currently interprets those
  fields in the reverse order. Simulator width zero faults; RTL comments
  describe width zero as 32 but its mask expression does not implement that.
  Reconcile this before extending bit-field positions. Do not silently select
  one old interpretation or introduce width 32 as part of indexing.
* Simulator branch checks and hardware code-fence checks require alignment.
  Target containment must not be satisfied merely by being inside total RAM.
* Some device-dispatch and SAVE paths perform work before all current checks.
  Audit ordering before claiming a new dynamic-index operation is contained.
* `docs/instruction-matrix.md` labels itself historical. It is supporting
  history, not authority for current opcode allocation.
* The current LUMP header has no demonstrated spare ISA-profile field.
  Namespace generations and transport-version numbers are not ISA versions.

## 3. Proposed arithmetic and containment contract

These recommendations require specification approval.

1. **Object, row, method and bit-position operands:** read DR as unsigned
   32-bit. Add or subtract a nonnegative immediate magnitude using exact wide
   arithmetic. For a full uint32 magnitude, signed 34-bit intermediate
   arithmetic suffices; implementations may use wider arithmetic.
2. Reject negative results, values beyond uint32, and values outside the
   actual authorized object/table range. Never mask, saturate, or truncate an
   invalid result into a valid index.
3. **BRANCH:** interpret DR as a signed 32-bit word displacement, then apply
   the explicit immediate sign using wide arithmetic. Add to the instruction
   start PC without wrap and require a legal instruction start inside the
   executing code extent. This signed interpretation is a proposal, not an
   accidental consequence of a language cast.
4. Check scaling, base addition, alignment, and the complete access width.
   A valid word offset does not prove that its byte address is valid.
5. Latch operands, flags, capabilities, and relevant authorization state at
   instruction acceptance. Resolve and latch operands atomically even if DR
   read-port limitations require multiple internal cycles. Do not mix contexts.
6. Decode and validate instruction structure before applying its predicate.
   A valid predicate-false instruction has no operand transactions, index
   faults, or architectural effects and advances past the complete instruction.
7. For an executed operation, validate arithmetic and static prerequisites,
   then authority and dependent bounds, then perform the authorized operation.
   Necessary protected metadata reads must themselves be authorized before
   dependent target reads. No unchecked memory or MMIO request may be issued.
8. Reject before protected payload reads, device dispatch, writes, capability
   replacement, or call-frame commitment. Stage multi-effect instructions so
   a late failure cannot leave an earlier effect committed.
9. Preserve SELF immutability, M-bit checks, privilege gates, type, seal, and
   access-permission rules. SAVE to effective row zero remains prohibited.
10. Define fault precedence explicitly. Existing fault classes differ by
    instruction (for example NO_CAPABILITY versus BOUNDS). Do not invent a
    new wire fault number or normalize existing ones without a fault-table
    decision. Fault delivery/recovery effects remain permitted; "no effects"
    refers to the rejected operation, not suppression of fault reporting.

Fault diagnostics must not expose protected data. Bus-level assertions must
verify absence of unauthorized accesses, not just unchanged destination
registers. Timing and speculative channels require an explicit threat model;
functional tests alone cannot establish an absolute absence of side channels.

## 4. Encoding options and recommended direction

Do not steal high immediate bits from existing instructions. Do not use
retired opcodes 8/9 as an implicit revival or reinterpretation.

### Recommended draft: version-gated indexed instruction packet

An explicitly assigned extension opcode under a new ISA profile introduces an
operation word and one or two index descriptors. Opcode 10 is a **candidate**,
not allocated by this document.

For review, recommend a compact packet with a 20-bit immediate magnitude.
The DR value remains full 32-bit; the magnitude limit does not limit the
runtime index to 20 bits.

| Word | Draft contents |
| --- | --- |
| W0 | Extension opcode [31:27]; role mask [26:25]; subtraction flag [24]; DR number [23:20]; unsigned magnitude [19:0] |
| W1 | Operation word, with its actual condition, ordinary register operands and untouched fields |
| W2, only when both roles selected | Reserved zero [31:25]; subtraction flag [24]; DR number [23:20]; magnitude [19:0] |

W0 describes the lowest selected role; W2 describes role 1 when both are
selected. W0 has a distinct prefix format: its bits [26:23] are NOT a
condition. Only W1 supplies a condition; dispatch must recognize the prefix
before predicate decoding. Mask zero, unknown role bits, unsupported
operations, nonzero reserved fields, nested packets, and retired operations
are invalid. Replaced W1 operand-value fields must be canonical zero;
unchanged mode discriminators are retained. An opcode-by-opcode
canonical-bit table is required before encoding freeze, including the data
access mode bit and indexed CALL mode selection.

One index uses **two words**, two use **three words**. DR0 plus a magnitude
expresses an extended literal; magnitude zero expresses a register-only
operand. Existing supported one-word literal forms can remain one word.

Magnitude range is 0..1,048,575, with a separate plus/minus operator. It
includes the existing 15-bit literal range. Larger magnitudes produce an
encoding-range diagnostic, never truncation, automatic extra instructions,
or a substituted live DR value.

Illustrative proposed vector, **not an assigned encoding or executable
release artifact**:

```text
LOAD CR1, CR6, DR11 + 2
W0 = 0x52B00002
W1 = 0x070B0000
```

For comparison, the existing fixed-index `LOAD CR1, CR6, 2` is
`0x070B0002`. It is not equivalent to the proposed expression unless DR11
contains zero. LUMP serialization of these words is big-endian; transport
formats must retain their separately specified byte order.

An alternative separates a fixed prefix, operation, and one/two compact
descriptors: three/four words. It may simplify decoder structure, at the
cost of one extra fetch. Full uint32 magnitudes require a larger format
(four/six words in the separately described header/descriptor/magnitude
approach), without a demonstrated requirement for that literal range.

A fixed-width alternative is a new wide instruction record with two always
present index descriptors. It simplifies boundary recognition but expands
all instructions in that profile. Neither approach is a parser-only change.

### Required packet and compatibility machinery

* Fetch the complete packet within the executable extent before issue.
  Truncation faults at W0. W1 and descriptor words are never independent entry
  points, breakpoints, or instructions.
* Derive and bind instruction-start and code/data extent metadata to exact
  admitted bytes. Enforce boundaries on branches, calls, returns, thread
  restore, initial execution and debugger PC changes. Invalidate metadata on
  any permitted code modification before further execution.
* Treat the packet as one retirement/step, with interrupts only before or
  after it. Return addresses and fall-through PCs advance by packet length.
* Labels and relocations count actual words. Simulator word PCs and hardware
  byte NIAs must map consistently. Branch origin is the packet start.
* Add an integrity-bound ISA profile and required-feature declaration, plus
  loader/hardware negotiation and trusted per-code-object decoder selection.
  Audit existing embedded metadata versus a new envelope before choosing the
  carrier. Do not claim a free LUMP-header bit or infer a profile from bytes.
* Calls and returns must install/restore the correct target decoder profile.
  Old readers/loaders must reject unsupported artifacts rather than strip
  metadata and execute payload under an old decoder.
* Preserve supported legacy bytes and meanings. Any excluded legacy behavior
  gets an explicit incompatibility diagnostic, not silent rewriting.

The detailed drafts now specify the profile carrier, canonical field table,
method numbering, context modes, and bit-field decisions. These must be
implemented consistently and accepted as a coordinated specification before
claiming support. Device negotiation and wire fault mapping remain unallocated.

## 5. Implementation sequence after design approval

1. Freeze the operand/encoding/fault tables and old/new golden vectors.
2. Build a pure index-expression parser and reference evaluator; reject
   malformed syntax without reading live register state.
3. Implement assembler sizing, label relocation, disassembly, feature
   declarations, and code-boundary metadata.
4. Add profile-gated simulator packet fetch, atomic operand capture, checked
   arithmetic, authorization ordering, and operation handlers.
5. Implement the corresponding RTL decoder, DR-port scheduling, packet buffer,
   widened arithmetic, transaction gates, and instruction-boundary checks.
6. Update artifact admission, static audits, save paths, and deployment
   compatibility together. A DR identifier is not a literal capability row.
   Runtime-dependent bounds are not compile errors. Separate structural
   validity from warnings about intentional fault tests; do not enlarge
   Mallory's C-list, fabricate approval, or make saving a design certify a build.
   Explicitly settle the existing literal out-of-range save restriction too.
7. Update listings, editor diagnostics, trace decoding and source maps.
   Static comments stay symbolic. Recorded results use the exact accepted
   operands and retirement occurrence, never later live DR values or unrelated
   hardware snapshots.
8. Run isolated cross-model verification and publish the compatibility matrix.
   FPGA synthesis, rebuilding user LUMPs, changing Namespace contents, and
   flashing remain separate authorization steps.

Each stage gets a confirmation of changes, evidence, and remaining gaps.
Do not call a stage implemented merely because its documentation is complete.

## 6. Synthetic acceptance matrix

| Area | Required cases |
| --- | --- |
| Syntax/round trip | All indexed roles; DR0–DR15; literals, DR, DR+M, DR−M; named operands unchanged; exact disassembly round trip |
| Arithmetic | Zero, last legal index, first illegal index, 0−1, 0xffffffff+1, maximum magnitude; no aliasing to zero |
| C-list | cc=4: index 3 valid with authority, index 4 rejected; SAVE effective 0 rejected; failed operation leaves grants unchanged |
| CALL | Independently dynamic row/method; same DR for both; fast entry and named-method equivalence; late method failure commits no frame |
| Data/MMIO | No read/write strobe or device side effect after failed checks; checked word-to-byte conversion and base addition |
| Context changes | Authorized/unauthorized slot, type, privilege and M gates; no partial context replacement |
| Branch | Signed negative/positive displacement, target at boundary, outside code, inside packet or data; no unauthorized target fetch |
| Bit position | Width 8: position 24 valid, 25 invalid; retain chosen width semantics; no flags/destination change on failed operation |
| Predicates | False condition skips whole valid packet without runtime-index fault or operand access; malformed encoding still rejected |
| Atomicity | Change live inputs while busy; retained accepted values used; interrupt/reset/replay never combines contexts |
| Compatibility | Supported old vectors unchanged; retired/unsupported profile rejected before execution; malformed/truncated packet rejected |
| Evidence | One retirement per packet; correct byte/word source mapping; repeated occurrences retain distinct operands; no protected values in faults |
| Persistence | Structurally valid dynamic candidates remain editable/saveable without claims of runtime safety; build admission separately enforced |

Use disposable synthetic objects and simulated RTL bus monitors. No user
workload execution or modification is needed for these checks.

## 7. Milestone status

* Confirmed: user requirement, any DR, plus/minus, containment always.
* Complete: initial operand inventory and implementation-discrepancy audit.
* Approved direction: compact two/three-word packet and 20-bit magnitude.
* Drafted: arithmetic/fault ordering, exact canonical fields, CHANGE modes,
  CALL selector grammar, bit-field semantics, profile carrier, and boundaries.
* Approved for implementation: the coordinated detailed specification,
  including the outer envelope and compatibility rules.
* Pending allocation: device negotiation commands and physical fault mapping.
* Implemented foundations: parser/codec, opt-in assembler, envelope validator,
  isolated RTL preflight and synthetic execution reference.
* Not implemented: production execution/admission and FPGA-core integration.

This is not a completed ISA correction and does not certify existing binaries.
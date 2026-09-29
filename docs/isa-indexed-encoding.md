# IDX1 compact indexed-operand encoding

Status: **detailed specification draft following approval of the compact
two/three-word direction; not an implemented ISA or a released binary format**.
IDX1 is a profile name, not a release number. Opcode 10 is allocated to the
packet introducer **within this proposed profile only**. Nothing here changes
legacy opcode allocation, artifacts, user programs, simulator behavior or RTL.

See [the requirements and implementation proposal](isa-indexed-operands-proposal.md).
This specification details the approved compact direction. The larger
four/six-word alternative was not selected.
See also [containment and fault ordering](isa-indexed-containment.md) and
[profile, packaging and boundaries](isa-indexed-profile.md). Their exact
new-profile contracts are drafts, not previously approved released behavior.

## 1. Scope and compatibility

An IDX1 code object contains supported ordinary one-word instructions and
compact indexed packets. Ordinary literal encodings need not expand. A packet
replaces one or two semantic index operands, not register identifiers, masks,
permission presets, arithmetic operands, shift counts or bit-field widths.
Opcodes 8/9 remain retired in IDX1; no packet may contain them. Opcodes 30/31
remain non-executable data/header values.

IDX1 MUST be selected from integrity-bound, admitted code-object metadata.
Unknown profiles or required features MUST be rejected before execution.
Absence of metadata cannot select IDX1. A legacy admission path may accept
supported legacy artifacts without changing their bytes or interpretation.
Calls, returns and thread activation install or restore the target object's
trusted profile. They do not inherit an untrusted caller-supplied decoder mode.

The metadata carrier is proposed in the profile document; transport commands
and numeric device feature identifiers remain unallocated. The
existing LUMP header is full: magic5, allocation4, code-count13, type2 and
c-list-count8. Namespace generations and transport versions are not ISA
profiles. Existing loaders/devices do not become IDX1-capable by specification.
Deployment MUST negotiate support and MUST NOT strip IDX1 metadata and feed
the payload to an old decoder.

## 2. Packet format

Words are unsigned 32-bit quantities. Bit zero is the least significant bit.

| Word | Bits | Meaning |
| --- | --- | --- |
| W0 | 31:27 | 10, IDX1 packet introducer |
| W0 | 26:25 | Role mask: 01 role0, 10 role1, 11 both; 00 invalid |
| W0 | 24 | S: 0 addition, 1 subtraction |
| W0 | 23:20 | R: DR number, 0–15 |
| W0 | 19:0 | M: unsigned immediate magnitude, 0–1,048,575 |
| W1 | 31:27 | Wrapped operation opcode |
| W1 | 26:23 | The operation's sole condition code |
| W1 | 22:19 | A, ordinary destination/first-register field |
| W1 | 18:15 | B, ordinary source/second-register field |
| W1 | 14:0 | I, canonical residual immediate/mode fields |
| W2, only for mask11 | 31:25 | Reserved, MUST be zero |
| W2 | 24, 23:20, 19:0 | S, R, M for role1 |

W0 describes the lowest selected role: role0 for masks01/11, role1 for mask10.
Mask01 or10 consumes two words; mask11 consumes three. There is no fourth word.
The role mask determines length without inspecting W1 or evaluating flags.
No W0 bit is a condition bit. In particular, a decoder MUST recognize opcode10
before applying legacy condition-field extraction. W1 condition14 means AL;
every other defined condition, including NV, is also legal.

For an index expression `DRr +/- magnitude`, the descriptor is
`(S << 24) | (r << 20) | magnitude`. W0 additionally contains
`(10 << 27) | (roleMask << 25)`. Magnitude zero is canonical with S=0;
S=1,M=0 is rejected to avoid two encodings of a register-only operand.
DR0 plus a magnitude represents an immediate; DR0 minus a magnitude represents
a negative branch displacement, or an arithmetic-underflow test for an unsigned
consumer. Registers supply values at runtime, never during assembly.

The magnitude range includes every unsigned imm15 literal through32767.
Runtime DR values remain full32. Twenty-bit magnitude is not a twenty-bit
effective-index restriction. Larger magnitudes are encoding errors; they MUST
NOT truncate, silently expand into scratch-register sequences, or select a
different profile.

## 3. Wrapped operation and canonical replacement table

All masks below are **32-bit W1 masks**, written with eight hexadecimal digits.
For each selected role, `(W1 & replacementMask)` MUST be zero. The evaluated
value is supplied as a separate semantic operand; it MUST NOT be repacked into
the narrow replaced field. Non-selected index fields retain their literal
meaning. Additional constraints apply even when the operation's predicate is
false.

This table is exhaustive for IDX1 packets. Other opcodes are not wrappable.
Permissions, register-class restrictions, SELF rules and M-bit rules remain
independent execution checks; a valid packet is not a grant of authority.

| Opcode / mode | Allowed role masks | Role0 replacement | Role1 replacement | Required residual form and unit |
| --- | --- | --- | --- | --- |
| 0 LOAD | 01 | `00007FFF` | — | A=destination CR, B=source CR; c-list capability-word row |
| 1 SAVE | 01 | `00007FFF` | — | A=destination c-list CR, B=source CR; capability-word row in A |
| 5 SWITCH, isolated load | 01 | `00007FFF` | — | A=12..15, B=0..11; source c-list capability-word row |
| 4 CHANGE, system register | 01 | `00007FFF` | — | A=12 or13; B=source CR; normal source-capability word offset (see §4) |
| 4 CHANGE, Thread context | 01 | `00007FFF` | — | A=14 or15; B=source-authority CR; Namespace entry ordinal (see §4) |
| 2 CALL, direct capability | 10 | — | `00007FFF` | B=0, A=target CR; method selector |
| 2 CALL, indexed capability | 01,10,11 | `0000001F` | `00000FE0` | A=0, B=6; I[14:12]=0; role0=CR6 c-list row, role1=method selector |
| 16 DREAD | 01 | `00003FFF` | — | I[14]=1; A=destination DR, B=base CR; data-word/device-word offset |
| 17 DWRITE | 01 | `00003FFF` | — | I[14]=1; A=source DR, B=base CR; data-word/device-word offset |
| 23 BRANCH | 01 | `00007FFF` | — | A=B=0; signed displacement in physical instruction words from W0 |
| 18 BFEXT | 01 | `000003E0` | — | I[14:10]=0, I[4:0]=width1..31; A=destination DR, B=source DR; bit position |
| 19 BFINS | 01 | `000003E0` | — | I[14:10]=0, I[4:0]=width1..31; A=destination DR, B=source DR; bit position |

CALL has exactly the two structural forms in this table. For example A=1,B=6
is not a third IDX1 packet CALL mode. Direct CALL through CR6 is A=6,B=0,
not the indexed-capability form. Authority restrictions on callable registers
remain applicable.

DREAD/DWRITE deliberately use only the immediate-shaped W1 mode, I[14]=1.
The packet replaces its entire offset, while preserving this discriminator.
An I[14]=0 W1 is rejected, not interpreted as a second, cumulative DR addition.
Legacy one-word register-plus-base addressing is not removed by this rule.

SWITCH CR15,CR15 is the existing guarded boot placeholder, not an indexed load.
It is not wrappable. CHANGE A<12 is not an IDX1 packet mode. Boot microcode and
internal scheduler commands are not new W1 encodings.

### Method selectors and source notation

The runtime selector is unsigned: 0 means the object's declared fast entry;
1 means the first method-table selector, and k>0 selects table entry k.
Dynamic `DRn`, `DRn + M` and `DRn - M` in a method operand denote the **runtime
selector**, without an implicit increment. A constant runtime selector in an
explicit index expression likewise receives no increment.

Existing named methods and existing numeric source-level method ordinals retain
their mapping: ordinal n becomes runtime selector n+1. An omitted method
selects0. Assemblers/disassemblers MUST distinguish runtime selector expressions
from the older ordinal syntax, rather than silently reinterpreting a bare
numeric method argument.

Proposed IDX1 source grammar:

* An indexed operand is a literal, a DR token, or `DRn +/- magnitude`.
  Whitespace and an optional `#` before a magnitude are permitted.
  No nested arithmetic, implicit scratch register, or multiple-DR expression
  is introduced. Magnitudes are nonnegative literals in supported number bases.
* LOAD keeps its existing three-operand spelling:
  `LOAD CR1, CR6, DR11 + 2`.
* Method operands accept DR expressions as runtime selectors. The explicit
  form `selector(expression)` also accepts a runtime-selector literal.
  Thus `CALL CR3, selector(1)` selects the first table entry,
  while legacy `CALL CR3, 1` retains its ordinal mapping to selector2.
  `CALL CR3, DR9` is equivalent to `CALL CR3, selector(DR9)`.
* Existing indexed-source CALL brackets contain a row expression, independently
  of the method expression. Exact accepted legacy punctuation stays supported;
  this does not introduce a new named-capability lookup convention.
* Disassembly uses explicit `selector(...)` for packet method operands and
  preserves packet form. Assembly canonicalizes `DRn - 0` to `DRn`; binary
  subtract-zero descriptors remain noncanonical.

The untouched method in an indexed CALL occupies I[11:5] and is already a
runtime selector; untouched row occupies I[4:0]. A descriptor frees its own
operand from these narrow encoding ranges, not from actual table/c-list bounds.

## 4. CHANGE modes and compatibility decision

CHANGE is not uniformly a Namespace slot operand. The inspected RTL supplies
`cap_index` to `ChurchChange.index`. In normal CR12/CR13 system-register loading,
`CR12_CR13_LOAD` supplies it to mLoad's `sub_index`; mLoad forms
`source.word1_location + (sub_index << 2)`. IDX1 therefore defines role0 here as
an unsigned **source-capability word offset**, with the same authorized source
view, not a raw byte offset or a universal Namespace ordinal.

For A=14/15, the current Thread-context path uses
`namespace.word1_location + (index << 4) + 4` to read entry authority and uses a
direct GT path. IDX1 role0 is the **Namespace entry ordinal**, with a16-byte
entry stride and an authority-word offset of4 bytes on that hardware path.
Selection of Thread context does not authorize arbitrary Namespace access.
Source-authority and target-type checks must precede context commitment.

The simulator currently treats CHANGE's immediate as a Namespace index for
both families. This disagrees with the normal CR12/CR13 mLoad path. IDX1 chooses
the units above; a backend implementing the simulator's universal-slot behavior
MUST NOT advertise conforming IDX1 CHANGE support until corrected.

Boot-window direct-GT restore and internal scheduler restore use privileged
state and internally selected masks. IDX1 packets are not accepted as boot
microcode. This specification does not extend those internal interfaces.
The architectural CHANGE immediate is not a keep/restore mask:
`hardware/decoder.py` scrubs `call_mask` to zero; `hardware/change.py` derives
boot/Thread masks internally. No mask bits are replaced or exposed by IDX1.
Existing 16-bit index/sub_index wires are implementation limits, not permission
to truncate a full32 computed index; widen or reject before issuing a request.

## 5. Bit-field decision and compatibility block

IDX1 freezes the assembler/simulator order: position in I[9:5], width in I[4:0].
Width is1..31, never dynamic; zero is invalid and does not mean32. Position is
the least-significant-bit-numbered start. Require position+width<=32 using
non-truncating arithmetic. BFEXT/BFINS operate on DR values, not capability
memory offsets. Position is replaced by role0 and must not be masked to5 bits.

`hardware/core.py` currently extracts position from I[4:0] and width from
I[9:5], the reverse order. It is not an IDX1 implementation. Do not claim that
one encoding preserves both interpretations. An old object retains its
identified legacy backend/profile semantics; IDX1 bit-field execution requires
the frozen order above. Admission must reject unsupported/ambiguous legacy
provenance rather than relabel old bit-field bytes as IDX1.

## 6. Evaluation, acceptance and fault ordering

For rows, offsets, method selectors and bit positions, interpret DR as unsigned
32-bit and compute `DR +/- M` exactly. For BRANCH only, interpret DR as signed
32-bit displacement before adding/subtracting M. Signed34-bit intermediate
arithmetic is sufficient for these expressions; implementations may use wider
arithmetic. Do not use host bitwise casts to validate results.

Unsigned consumers reject results outside0..0xFFFFFFFF. BRANCH adds its signed
result to W0's word PC with widened arithmetic and validates the resulting
target; a negative displacement is not itself a fault. Scale word addresses to
bytes only with checked widened arithmetic. Validate base addition, alignment,
the complete access width and the active authorized extent. Containment always
applies, regardless of B flags. No wrap, saturation or masking can turn an
invalid index into an authorized one.

The acceptance sequence is:

1. Authenticate profile and legal instruction start. Check fetch containment
   and obtain the complete packet; structural errors precede predication.
2. Validate role/mode/canonical/reserved fields. Nested packets and forbidden
   opcodes are invalid even under NV.
3. Capture W1 condition flags and evaluate the predicate once. If false,
   advance by packet length with no
   index arithmetic fault, operand transaction or operation side effect.
4. If true, capture the selected DR values, capabilities and relevant
   authorization state, including destination M, as one stable accepted
   snapshot. Acceptance is serialized across any multi-cycle register reads.
5. Follow the authority-first ordering in the containment specification.
   Arithmetic may be computed internally early, but no index fault is exposed
   ahead of a higher-priority authority fault. Once base authority is validated,
   check both CALL expressions for arithmetic errors, in role order, before
   selecting the c-list row. Validate the selected callee's E authority before
   classifying its method-table range. Authorized metadata reads are permitted;
   every read must pass its own checks before it can establish a dependent bound.
6. Stage multi-effect operations. No unchecked payload/MMIO request, capability
   replacement, context save or call-frame commitment may escape a failed
   preflight. Preserve SELF, source permission, type, generation, seal and
   M-bit rules. A dynamically computed SAVE row0 remains forbidden.

Necessary instruction fetch and checked metadata reads are not promises of
zero bus traffic on every failure. The required property is no unauthorized
transaction and no rejected-operation commit. Fault-delivery effects remain
permitted. Replays must either retain the complete accepted snapshot or restart
acceptance; mixing stale and fresh operands is forbidden.

Diagnostic classes used here are symbolic, not allocated wire fault numbers:
PROFILE, FETCH, STRUCTURE, INDEX_ARITHMETIC, CONTAINMENT and AUTHORITY.
Within structure checking use header/length, W1 opcode/mode, role mask, reserved
and replacement fields, then descriptor canonicality. Dynamic checks follow
the containment specification, including authority-first precedence.
INDEX_ARITHMETIC is a diagnostic reason, not a new hardware fault number;
the proposed architectural range class is BOUNDS. Existing security-fault
classes retain their distinctions. Device wire mapping remains to be specified.

## 7. Atomic PC, boundaries and tooling

A packet has one architectural start, W0, and one retirement. W1/W2 are
interiors, not independently executable instructions or breakpoints, whatever
their high bits resemble. Fetch all words inside a single executable extent
before issue. Truncation faults at W0; no partial execution. Interrupts occur
before or after the packet, never within it.

Fall-through, CALL return addresses and CHANGE continuations advance by2/3
words, or8/12 bytes on a byte-addressed backend. Branch origin is W0, not W1.
The simulator's logical word PC and hardware byte NIA must map explicitly;
labels and relocations count actual words, not source statements.

Admission derives instruction starts from exact admitted code/data extents.
Bind these boundaries to the immutable code identity; invalidate and revalidate
before executing any permitted code modification. Every branch, CALL, RETURN,
Thread restore, initial entry and debugger PC change must target a legal start.
Method-table words and inline constants are data unless separately designated
executable entries by the admitted format. A target in total RAM is insufficient.

Source maps associate W0, total word count, byte span and operand source spans
with one statement. Interior addresses resolve to their containing packet.
Tracing must retain accepted operand values, not resample live registers.
Disassembly must know profile and start metadata; arbitrary data must not be
heuristically decoded into packets and then trusted as boundaries.

## 8. Exact diagnostic vectors

These are specification fixtures, not user programs or deployment binaries.
Hex words are printed most-significant byte first. If serialized as big-endian
words, `52B00002 070B0000` is exactly
`52 B0 00 02 07 0B 00 00`. No claim is made about every transport's byte order.
All listed fields were calculated with a small pure Node script, not by running
an assembler, simulator or hardware workload.

### Structurally valid packets

Execution success still depends on the predicate, accepted register values,
authority and bounds. `rN` below means the accepted DRN value.

| Meaning | W0 W1 [W2] |
| --- | --- |
| LOAD CR1, CR6[row=r11+2], AL | `52B00002 070B0000` |
| LOAD CR1, CR6[row=r11-32767], AL | `53B07FFF 070B0000` |
| SAVE into CR6[row=r2+1], source CR1 | `52200001 0F308000` |
| SWITCH CR12, CR6[row=r2] | `52200000 2F630000` |
| CHANGE CR12, CR2[word offset=r3+1] | `52300001 27610000` |
| CHANGE Thread, A=14 B=15, NS ordinal=r3+1 | `52300001 27778000` |
| Indexed CALL row=r2+4, literal runtime method3 preserved | `52200004 17030060` |
| Indexed CALL literal row7 preserved, runtime method=r4-1 | `55400001 17030007` |
| Indexed CALL row=r2+4 and runtime method=r4-1 | `56200004 17030000 01400001` |
| Direct CALL CR3, runtime method=r9 | `54900000 17180000` |
| DREAD DR1, CR2[offset=r15+1048575] | `52FFFFFF 87094000` |
| DWRITE DR1, CR6[offset=r2] | `52200000 8F0B4000` |
| BFEXT DR1, DR2, position=r3+2, width8 | `52300002 97090008` |
| BFINS DR1, DR3, position=r2, width4 | `52200000 9F098004` |
| BRANCHNE displacement=DR0-2 | `53000002 B8800000` |

The legacy literal LOAD CR1,CR6[2] baseline is `070B0002`.
It is equivalent to the first packet only when DR11=0.
For the dual CALL fixture, DR2=5 and DR4=2 produce row9 and selector1;
there is no extra ordinal-to-selector increment at execution.

### Rejected packet fixtures

| Words / setup | Required diagnostic reason |
| --- | --- |
| `50B00002 070B0000` | STRUCTURE: zero role mask |
| `56200004 17030000` at end of code | FETCH: missing W2 |
| `56200004 17030000 03400001` | STRUCTURE: W2 reserved bit25 nonzero |
| `52B00002 070B0001` | STRUCTURE: selected LOAD replacement field nonzero |
| `54B00002 070B0000` | STRUCTURE: LOAD has no role1 |
| `52B00002 57000000` | STRUCTURE: nested opcode10 W1 |
| `52B00002 47000000` | STRUCTURE: retired opcode8 W1 |
| `52B00002 F7000000` | STRUCTURE: WORD/opcode30 W1 |
| `52200000 87090000` | STRUCTURE: DREAD W1 mode bit14 is zero |
| `52200000 170B0000` | STRUCTURE: CALL A=1,B=6 is not a defined mode |
| `52200004 17031060` | STRUCTURE: indexed CALL reserved I[12] nonzero |
| `52300001 27010000` | STRUCTURE: CHANGE A=0 is not a defined mode |
| `52200000 2F7F8000` | STRUCTURE: SWITCH boot-placeholder form is not wrappable |
| `52300002 97090000` | STRUCTURE: bit-field width zero |
| `53B00000 070B0000` | STRUCTURE: subtract-zero descriptor |
| `53B07FFF 070B0000`, DR11=1, AL | INDEX_ARITHMETIC: negative unsigned row |
| `52B00002 070B0000`, DR11=0xFFFFFFFF, AL | INDEX_ARITHMETIC: unsigned32 overflow |

A W0 opcode other than10 is not an IDX1 packet at all; ordinary instruction
decoding applies. A packet decoder handed `5AB00002 070B0000` must reject its
opcode11 header, not silently reinterpret the bits as an extension.
Entering W1 of a valid packet is a boundary/CONTAINMENT fault, even if W1 alone
looks like a valid LOAD. Under a false predicate, structural failures above
still fault; the two arithmetic cases do not.

## 9. Remaining integration blockers and evidence

The packet fields, lengths, role table, magnitude bound and IDX1 bit-field
order are fixed by this draft. Remaining blockers are not imaginary spare bits:

* Implement and authenticate the proposed profile/feature metadata carrier,
  negotiate it end-to-end and map diagnostic reasons to the device fault ABI.
* Implement the explicit CHANGE and bit-field compatibility decisions above.
  Legacy provenance cannot be inferred from identical instruction bytes.
* Implement explicit entry-point metadata for selector0 and legal method-table extents.
  Current simulator fetch uses `CR14.word1+1+pc`; its method0 path assigns pc=1
  while nearby comments describe the first post-header word. This specification
  defines selector0 through the profile's declared fastEntry, using PC=w-1
  for LUMP word w. Existing objects must not be silently migrated or relabeled.
* Supply atomic packet fetch, boundary metadata, checked full-width arithmetic
  and staged transaction support across assembler, simulator and RTL. Existing
  narrow datapaths and one-word continuation calculations are not conformance.
* Implement and test the explicit runtime-selector grammar above without
  changing accepted legacy numeric-ordinal syntax.

Evidence inspected: `simulator/assembler.js` opcode cases0/1/2/4/5/16–19/23;
`simulator/simulator.js` decode, indexed CALL, CHANGE and fetch paths;
`hardware/decoder.py` CALL discrimination and immediate/mask outputs;
`hardware/core.py` CHANGE wiring and bit-field extraction;
`hardware/change.py` CR12_CR13_LOAD, Thread preflight and restore paths;
`hardware/mload.py` source-plus-word-offset calculation;
`hardware/dread.py` and `hardware/dwrite.py` addressing-mode definitions.
Some historical comments assign different opcode numbers; executable decode
and assembly cases, not those comments, supplied this table.
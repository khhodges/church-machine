# IDX1 indexed-operand containment contract

**Indexing clarification (2026-10-02):** the controlling operand semantics are
in the [master ISA indexing rule](instruction-set.md#uniform-indexed-operands),
which takes precedence over this supporting contract.
Packet-specific rules below belong to the prior IDX1 design, not an approved
encoding requirement for the Amaranth upgrade. Permission checks, containment
and no-side-effect rejection remain required regardless of the eventual encoding.

**Status:** Proposed security and fault contract for the compact IDX1 profile,
not an implemented feature or simulator/RTL parity claim. Packet bits, roles,
instruction lengths, executable boundaries, and execution-envelope admission
are defined in [IDX1 encoding](isa-indexed-encoding.md) and
[IDX1 profile](isa-indexed-profile.md). Those specifications govern packaging;
this document defines containment and security-fault precedence. It does not
change supported legacy one-word instruction semantics.

## Scope and instruction boundaries

An *index* in IDX1 selects a c-list word, a CHANGE source-capability word
offset or Namespace ordinal (depending on mode), a method-table entry, a
data-object word (including an authorized device register), a bit position,
or a branch destination. Each applicable index accepts any DR0–DR15 plus
or minus a 20-bit unsigned magnitude; `DR0 + #m` is the packet literal
form and zero magnitude is the register-only form. One-word literals retain
their supported encoding. The role table here summarizes, but does not
replace, the canonical masks and W1 residual-field rules in encoding §3:

| Instructions | Indexed operand and IDX1 role |
| --- | --- |
| LOAD, SAVE, SWITCH | Role 0: C-list capability-word row |
| CHANGE with A=12/13 | Role 0: **source-capability word offset** for system-register load |
| CHANGE with A=14/15 | Role 0: **Namespace entry ordinal** for Thread context |
| DREAD, DWRITE | Role 0: data/device word offset |
| CALL via a direct target CR | Role 1: method selector |
| CALL via the active CR6 c-list | Role 0: C-list row; role 1: method selector; either or both can be replaced |
| BFEXT, BFINS | Role 0: bit position; width remains a separate literal |
| BRANCH | Role 0: signed, PC-relative physical-word displacement from W0 |

Opcodes 8/9, ELOADCALL/XLOADLAMBDA, are **retired in IDX1**. They are neither
wrappable operations nor acceptance-test subjects; this does not claim they
have already been removed from legacy implementations.

W0 is the prefix and first selected-role descriptor, W1 is the sole
predicated operation, and W2 is present **only** if both CALL roles are
selected. Role masks 01/10 consume two words, 11 consumes three. Fetch and
validate the complete packet within the admitted executable extent and
structural rules **before** predicate evaluation; interior words are never
instruction starts. Capture the W1 condition flags and evaluate the predicate
once. A false predicate advances over the entire packet without operand
arithmetic or operation effect; no externally observable operand memory/
device transaction is permitted. Implementations may internally read or
snapshot DRs, but must not allow such a read to affect architectural state or
protected external transactions. On a true predicate, capture the required
DRs/capabilities/authority as one stable accepted snapshot, not a mixture of
values from different cycles or replays. Fall-through, continuations, and
branches follow encoding §7 and profile §4; a BRANCH target must be an
admitted instruction start in the current object's code fence.

## Values, bounds, and authority

DR0 reads as architectural zero for **all** roles; writes to DR0 cannot
influence an index. In IDX1 its plus-magnitude expression intentionally
provides a literal; DR0 minus a nonzero magnitude is a negative branch
displacement or an unsigned-index underflow. Each selected DR value is
stable for the accepted operation, even if both CALL roles use the same DR.

For c-list, CHANGE, method, data, and bit-position operands, read the full
DR word as **unsigned 32-bit**. For BRANCH alone, sign extend the DR word
as **signed 32-bit two's complement**. Interpret W0/W2 S as adding or
subtracting the unsigned magnitude M (`0..1048575`); subtraction with M=0
is structurally invalid. Compute the mathematical result without truncation
(signed 34 bits suffice for one 32-bit DR plus/minus M; 64-bit intermediates
are recommended). An unsigned index must remain in `[0, 2^32-1]` before
its *actual* target-limit check; no wrap, saturation, bitmask, sign
reinterpretation, or 16-bit narrowing is allowed. BRANCH adds its signed
displacement to W0's physical word PC using checked wide arithmetic; check
the final PC and instruction start before fetching it. Word-to-byte
conversion, complete access width, and base-plus-offset address formation
also use checked wide arithmetic after authority and index validation.

Bounds are tied to the *authorized source view*, never to available
physical memory. C-list rows must be below that c-list's declared count;
data offsets must fit the source capability's grant. CHANGE A=12/13
checks a **normal source-capability word offset** against that source
grant, while A=14/15 checks a **Namespace ordinal**, its authority,
16-byte entry stride, and entry/Thread type (encoding §4). No CHANGE
index is universally a Namespace slot. Methods must be declared selectors
of the authorized callee's typed dispatch table (selector zero retains
the fast-entry convention); a present private entry is not public.
Bit positions must be in 0–31. BFEXT/BFINS keep their separate literal
width of 1–31; width zero is a **structural admission error**, never an
implicit width 32 or a runtime BOUNDS case. For a structurally legal
width require `position + width <= 32` using wide arithmetic. Non-index
arithmetic immediates, shifts, masks, and widths are outside this extension.
Existing source-level method names and numeric ordinals retain their
1-based runtime-selector mapping; a DR holds that runtime selector
directly (`0` fast entry, `1` first table entry), with no hidden increment.

No index expands a capability, Namespace, method, device, or code grant.
The following **IDX1 security-fault precedence** resolves authority versus
index cases. Structural/fetch faults are classified first even under false
predicates; symbolic diagnostic categories and their not-yet-allocated
fault-ABI mapping are described in encoding §6.

1. Authenticate the profile/entry and fetch the complete packet inside
   its authorized code extent. Validate packet structure and W1 residual
   fields before predication. Capture flags, evaluate the W1 predicate
   once; if false, skip the packet with no runtime index or authority fault.
2. On a true predicate, accept one stable operand snapshot. Check
   source/base authority **before disclosing authority-dependent metadata
   or the classification of an index against a protected range**:
   relevant CR/GT nullness, register class and isolated M permission,
   source rights, GT integrity/version/seal, target S and source B/
   delegation for SAVE, and CHANGE source/Namespace authority. Reading
   *authorized validation metadata* needed to establish a grant is
   permitted; an unauthorized principal must not learn a protected c-list
   count, Namespace presence, or method-table extent by varying a DR.
   Neither selected payload nor device data may be read here.
3. Compute selected expressions exactly, **role 0 then role 1**, and
   reject underflow/overflow before any selected c-list transaction. For
   indexed CALL, arithmetic-check **both selected roles** before reading
   the selected C-list slot. Next validate the effective row against the
   authorized c-list count. For SAVE, effective row zero is
   `IMMUTABLE_SELF_CAP` **after** authority and arithmetic validation
   but before selected-slot access, including DR-derived row zero. Its
   precedence over a *row-count* failure at row zero is intentional.
4. After an indexed CALL row passes, validate the selected GT and E
   authority before checking the method value against the callee's
   authorized typed dispatch extent. For a direct CALL, validate its
   target E authority before that method-bound check. This ordering
   conceals a protected callee's method-table size. CHANGE A=12/13
   checks its source-capability word offset; A=14/15 checks the NS ordinal
   and target type under Namespace authority. All data/bit/branch bounds,
   complete-width/alignment, and permitted selected-target checks must
   pass before their dependent payload fetch or commit.
5. Apply existing selected-target integrity, private-method, F-bit,
   device and M-port gates, then commit atomically. Authorized outform
   loading and other defined asynchronous operations retain their
   architectural rules, but a rejected index must not initiate them.

No failing operation may expose an **unauthorized** target-memory/device
transaction, or commit a rejected operation's c-list/Namespace/M-bit,
architectural DR/CR/flag, call-frame, or PC change, or register a pet name.
Instruction fetch and checked, authorized validation-metadata reads may
occur even if a later check fails. Fault delivery, a bounded diagnostic
without protected data, and their separately defined effects are permitted.
In particular, Abstract GT and MMIO handling must run **after** selector
and authority gates, not intercept a raw/wrapped address. All speculative,
cached, and bus paths must observe the containment gate; checking only at
retirement is insufficient.

### Fault classification for the new profile

This table specifies normative IDX1 security outcomes, **not** a claim that
current backends implement them or that symbolic classes already have wire
numbers. Use established fault names where their meaning applies and map
encoding §6's arithmetic/containment/authority categories to the existing
ABI during ratification; **do not invent a fault number**. A well-formed
operation that faults at runtime remains a legal program.

| Family | Computed-index/range fault | Other applicable existing faults to preserve |
| --- | --- | --- |
| LOAD, SWITCH | `BOUNDS` for invalid effective row; a valid empty row retains `NULL_CAP` | `NULL_CAP`, `PERM_L`, `SEAL`, `F_BIT`, `CODE_NOT_RESIDENT`; SWITCH M authorization |
| SAVE | `IMMUTABLE_SELF_CAP` at effective row 0 after authority; otherwise `BOUNDS` for invalid row | `NULL_CAP`, `PERM_S`, source B/delegation failure, `SEAL`, `F_BIT`, source M authorization |
| CHANGE A=12/13 | `BOUNDS` for source-capability word-offset failure | Existing privilege, null, permission, seal, and source-capability faults |
| CHANGE A=14/15 | `BOUNDS` for NS-ordinal or checked entry-address failure | Existing Namespace/source-authority, target-type, privilege, and frame-validation faults |
| CALL via CR | `BOUNDS` for arithmetic overflow or selector absent from the *authorized* dispatch table | `NULL_CAP`, `PERM_E`, `SEAL`, `PRIVATE_METHOD` for a declared private entry, stack faults |
| CALL via CR6 row | `BOUNDS` for row/method arithmetic or authorized row/dispatch bounds | Target load/execute faults as above; `PRIVATE_METHOD` for a declared private entry; no partial call |
| DREAD, DWRITE | `BOUNDS` for invalid offset or byte address | `NULL_CAP`, `PERM_R`/`PERM_W` (and CR14's authorized X read), `SEAL`, existing device/M-port gates |
| BFEXT, BFINS | `BOUNDS` for effective position outside 0–31 or position+legal-width>32 | Width zero is **STRUCTURE**, rejected at admission even under false predicate; no DR or NZCV write on runtime failure |
| BRANCH | `BOUNDS` for overflow, non-header target, or target outside the active code fence | No unauthorized target fetch |

These IDX1 rows intentionally do **not** infer outcomes from legacy code.
For example, a current legacy simulator may say `NO_CAPABILITY` for a
LOAD beyond CR6's c-list, but IDX1 specifies `BOUNDS`. The ABI mapping
must maintain any legacy behavior separately. A selector absent from the
callee's declared dispatch table is `BOUNDS`; a *declared private* selector
is `PRIVATE_METHOD`.

## Assembly, auditing, and admission

Assemblers reject malformed syntax, unrepresentable 20-bit magnitudes,
invalid DR numbers, noncanonical subtract-zero, bad W0/W2 reserved or role
fields, nonzero selected W1 operand bits, invalid W1 modes/opcodes, and
width zero or width>31 for BFEXT/BFINS. These are structural defects, not
runtime `BOUNDS`. Disassembly distinguishes a runtime method selector
expression from an older 0-based source-level method ordinal. Static audit
and server save decode complete W0/W1[/W2] packets and their admitted
boundaries, not DR numbers or role masks as literal rows. The authenticated
IDX1 envelope, code extents, entry/dispatch map, and static control-flow
*boundaries* remain mandatory admission checks (profile §§2,4–6).

A valid packet with an effective index known to be outside a c-list/data/
NS/method grant is **structurally admissible** even if it predictably faults;
the same holds for an unknown DR-derived value. Audit may warn but must
not require a deliberate fault test to expand `cc`, invent capabilities,
rewrite an index, or repair Mallory's c-list. This does not waive required
static instruction-start and executable-extent checks for BRANCH/CALL/
RETURN targets; a malformed boundary map is not merely a predictable
runtime index failure. Legacy artifact handling remains governed by its
own profile. Unknown dynamic effective values are never statically
proven safe; runtime checks are mandatory even after audit.

## Synthetic acceptance and trace obligations

Run each applicable role with DR0+M literal, DRn, DRn+1, and DRn−1
forms; for indexed CALL vary **both** selectors independently and together,
including role masks 01, 10, 11. Also retain supported one-word literal
baseline vectors. Tests use only constructed capabilities, code, tables,
and devices, not user workloads. For every failure compare fault class,
committed register/flag/PC/frame/memory/Namespace/M state, and unauthorized
target-bus/device events across implementations.

| Synthetic grant | Success boundary | Fault boundary and required result |
| --- | --- | --- |
| Four-row c-list (`cc=4`) for LOAD/SAVE/SWITCH/indexed CALL | Effective row 3; DR0+3 equals one-word literal 3 | Row 4, DR=0 minus 1, and DR=`0xffffffff` plus 1: `BOUNDS` after source authority, before selected-slot read. SAVE row 0: `IMMUTABLE_SELF_CAP` after authority, no write or M consumption |
| CHANGE A=12/13 with a four-word authorized source-capability view | Source word offset 3 | Offset 4/negative/overflow: `BOUNDS`; no target read or system-CR replacement; must not reinterpret offset as a Namespace ordinal |
| CHANGE A=14/15 with authorized NS ordinals 0–3 | NS ordinal 3 under the required source/Namespace authority | Ordinal 4/negative/overflow: `BOUNDS`; no NS entry access outside grant, Thread/context switch, or frame commit |
| Data object offsets 0–3, plus separately authorized CR14/Abstract/MMIO fixtures | Offset 3 | Offset 4, DR=`0x80000000` (unsigned), negative and overflow: `BOUNDS` with no target read, device call, pet-name registration, or home write |
| Callee with two public dispatch entries and one declared private entry | Selector 0 fast entry, 1 first public, 2 second public | Absent selector: `BOUNDS`; declared private: `PRIVATE_METHOD`; no frame/CR change. Unauthorized callee with varied method DR: same authority fault, no table-size oracle |
| Six-word executable code fence, BRANCH W0 at word 2 (W1 is word 3; other headers at 0 and 4) | DR=`0xfffffffe` means −2, targeting header 0; `+2` targets header 4 | `+1` targets interior word 3 and faults `BOUNDS`; `+4` targets word 6 and faults; very negative DR cannot wrap to a legal target |
| BFEXT/BFINS with width 8 | Position 24; DR0+24 equals one-word literal 24 | Position 25, DR=0 minus 1, DR=`0xffffffff` plus 1: `BOUNDS`, no DR/NZCV write. Width 31 at position 1 succeeds; at 2 fails. Width 0 is rejected at admission as `STRUCTURE`, including under a false predicate |

Include null, unsealed, permission-denied, F-bit, predicate-false, DR0,
selected-empty-row, and exact-boundary fixtures where relevant. For a
predicate-false but structurally valid packet, test length-aware skipping
with no external operand transaction or runtime index fault; do not infer
that internal operand latches were never read.
Check a forbidden operation both alone and after an authorized one to detect
stale selector latches. Validate source/target aliases, full 32-bit DR
extremes, dual-DR independence, PC advancement over extensions, and old
binary golden vectors. Assert that no unauthorized target address is driven
on the data/device bus and no out-of-fence target is fetched; simply seeing
the expected fault at retirement is insufficient. These synthetic tests and
visible traces establish only their observed paths, **not** absence of all
timing, cache, speculative, physical, or other side channels. A separate
microarchitectural review and explicit threat model are necessary before
claiming strong non-leakage.

## Ratification blockers

Before claiming IDX1 enforcement, implement the W0/W1[/W2] encoding and
integrity-bound envelope from the linked specifications, length-aware
fetch/boundary admission, and this authority-first security precedence
consistently with encoding §6's structural/role-order requirements. Map
the symbolic diagnostic categories to existing wire faults without
inventing codes. Reconcile CHANGE A12/13 word-offset versus simulator
NS-slot behavior, BFEXT/BFINS position/width interpretation and bounds,
simulator DR0 reads versus hardware's zero read, current Abstract/MMIO
dispatch before index validation, SAVE validation/commit ordering, and
LOAD's legacy `NO_CAPABILITY` versus proposed IDX1 `BOUNDS`.
Authorize typed method dispatch and verify both row and method gates
without leaking protected table information. None of those issues is
implicitly fixed by this document. Synthetic trace evidence is not a
proof against timing or microarchitectural leakage.
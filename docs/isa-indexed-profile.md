# IDX1 indexed instruction profile

> Retirement clarification: legacy-profile compatibility does not authorize
> executing ELOADCALL/XLOADLAMBDA. Opcodes 8/9 are rejected across profiles.
> Historical bytes remain inspectable; correcting and rebuilding affected
> source requires an explicit programmer action.

Status: **existing software profile and prior packet proposal; encoding approval
is not established by the corrected indexing requirement** (2026-10-02).

The required behavior is the indexed instruction's own calculation of
`DR[r] + immediate`, as specified in [ISA reference §1.1](isa_reference.md#11-uniform-indexed-operands--required-semantics).
Do not infer a required packet format, 20-bit magnitude or fixed instruction
word count. Packet-specific contracts below describe this separate design;
they are not instructions to extend Amaranth to match it.

Durable Save LUMP and protected simulator execution/reload are described below.
This is not a hardware release,
compiler certification, or authorization to amend an existing LUMP, Namespace
or boot image. Existing binaries retain their legacy interpretation.

### Current software implementation (Save LUMP and simulator routes)

The raw-assembly IDE now selects an IDX1 **new compile candidate** when an
indexed operand contains a DR expression. This does not relabel an existing
binary or change the meaning of missing execution metadata.

* Compile preserves capability declarations and source-derived packet/layout
  coordinates. Unsupported operations produce explicit compile diagnostics.
* **Run current compiled candidate** links those declared capabilities using
  their live Namespace sequences, rechecks the compiler output, frames the
  exact installed LUMP in the whole execution envelope, and admits that digest
  through the simulator's protected object identity. Execution remains stopped
  while the asynchronous hash/admission completes.
* Implemented packet families: LOAD, DREAD, DWRITE, BRANCH, BFEXT and BFINS.
  Any DR0–DR15 and a plus/minus 20-bit magnitude are represented at runtime.
  Source authority precedes exact index arithmetic and protected range checks.
  Direct one-word CALL uses typed IDX1 dispatch when entering an IDX1 object;
  RETURN derives the caller profile from its canonical saved Enter identity.
* Indexed CALL, SAVE, SWITCH and CHANGE are not enabled. IDX1 SAVE, SWITCH,
  CHANGE and LAMBDA instructions, constants blocks, and lazy/Abstract LOAD
  resolution remain unavailable; they are not silently downgraded.
* Installed executable code, dispatch data, header/SELF and Namespace authority
  are protected from memory aliases and bulk writes. GC's non-authority G-bit
  remains mutable. Reinstallation/replacement of an installed IDX1 object
  currently requires resetting the simulator.
  Non-abstraction inner types and execution with `cc=0` are rejected; the
  software runtime requires an exact installation-bound, E-only SELF row.
  Namespace aliases cannot execute an installed object's bytes as legacy code.
  Thread resume targets are boundary-checked before CHANGE commits either
  Thread, and fresh IDX1 roots use the envelope's declared fast entry.
* **Save LUMP is implemented through the normal review/consent, lease and
  compare-and-swap transaction.** The immutable browser snapshot retains the
  compiler source, words, capabilities and typed layout together. The server
  recompiles unsigned browser candidates before attesting their exact binary
  and whole execution envelope. Destination finalization reframes the finalized
  payload without changing compiler-owned layout. Current artifacts, immutable
  history and metadata preserve `isa_profile`, `execution_envelope` and
  `execution_digest`, bound to the compiler record. Missing or tampered
  execution metadata is rejected rather than interpreted as legacy code.
  IDX1 Save currently requires a source-bearing full or compact profile;
  API-only Save is explicitly unavailable because protected reload rechecks
  compiler source. Selecting API-only must not silently embed source instead.
* **Saved-LUMP Load into Sim is implemented.** It verifies the saved bytes,
  envelope, compiler record and source-derived layout before installation.
  Compiler-owned SELF relocation affects only the volatile installation;
  linked bytes receive the same whole-envelope protected admission as a local
  candidate. Saving alone does not install through the legacy loader or select
  a boot target. Candidates remain outside the legacy code-only registry.
* **Executable/deployment export, Prepare Boot and hardware delivery remain
  blocked for IDX1.** No FPGA IDX1 execution support is claimed. Simulator
  execution still requires an independently valid prepared/booted context;
  Save support does not bypass boot authority or repair an invalid Namespace.

`test_idx1_ide_flow.js` exercises the actual compile/candidate/C-list-link/install
functions in a disposable simulator, including `IADD DR11, DR0, #2`,
`LOAD CR1, CR6, DR11`, and `DREAD DR1, CR1, #0`. The existing root-context
`RETURN` rule is unchanged: returning from a top-level Run with no caller faults
at the canonical root sentinel; indexing does not create a caller frame.
`test_idx1_runtime.js` exercises actual simulator execution, arithmetic faults,
instruction interiors, mutation rejection, data/bit-field/branch packets and a
legacy→IDX1→legacy CALL/RETURN. `test_idx1_saved_flow.js` exercises the real
formatter, immutable snapshot, metadata-loss/tamper rejection and protected
saved loader in disposable memory. `tests/server/test_idx1_save_endpoint.py`
exercises compiler attestation, exact save/reload and immutable history using
private directories. These focused checks are not full architectural,
Thread-switch, device, or hardware conformance certification.

## 1. Scope and evidence

IDX1 retains supported legacy-shaped one-word instructions and adds opcode 10
packets. Historical opcodes 8/9 (ELOADCALL/XLOADLAMBDA) are retired **in IDX1**,
including inside packets. Residual support exists; this is not a claim that
assembler, compiler, simulator or RTL support has already been removed.

The earlier [indexed operands proposal](isa-indexed-operands-proposal.md)
supplies historical motivation. The coordinated
[encoding specification](isa-indexed-encoding.md) defines exact role masks,
canonical fields, operation modes and source grammar; the coordinated
[containment specification](isa-indexed-containment.md) defines fault precedence
and dynamic containment. This draft proposes packaging, decoder selection and
instruction boundaries; section 10 records freeze status.

Repository evidence inspected for this decision:

| Source | Observed fact and consequence |
| --- | --- |
| `simulator/lump-content-frame.js:95–101,135–193,263–323` | Full, compact and API-only all retain JSON API in the `0xAB` frame. Only source varies. API length is at most 65535 bytes. Existing inspection validates framing, not an ISA contract. |
| `ide/store.py:100–110,164–203,331–356` | Whole-binary SHA-256 covers embedded API. `genotype_hash`, however, excludes **all freespace**, including API; normalized header/code/C-list identity alone cannot bind an ISA declaration or boundary map there. API cannot contain circular token/issue identity fields. |
| `simulator/bank_lump_binding.js:131–267` | Binary validation and full-byte hash recomputation exist, but current method-entry checks are not IDX1 packet-boundary validation. |
| `simulator/app-run.js:17282–17304` | A save-path comment explicitly warns that registering code-only words drops the embedded frame. A code-word array is not a self-describing executable artifact. |
| `simulator/simulator.js`, `_execCallCore`, `_execReturnCore`, fetch path | Runtime works with memory, capabilities and PCs, not a demonstrated integrity-bound per-object ISA mode. CALL recognizes BRANCH dispatch entries and legacy raw offsets. |
| `hardware/call.py:155–156,375–384,633–653` | Hardware table dispatch treats the fetched word as an offset, unlike simulator BRANCH decoding. |
| `docs/debug-packet-protocol.md`, `TU_VERSION` and framing sections; `docs/cm-msg-protocol.md`, firmware compatibility and CALLHOME sections | Trace FSM, framing and firmware versions are not an ISA feature negotiation. No IDX1 negotiation is established by these sources. |
| [Trusted compiler and admission](TRUSTED_COMPILER_AND_UNTRUSTED_LUMP_ADMISSION.md), Gates 0–5 and persistence sections | Target architecture separates trusted compile output from unknown-upload admission. Integrity/compatibility are required, not a second approval ledger. It expressly notes migration work remains. |

### Carrier decision

The existing API frame is a viable metadata location for all three **current
output tiers**, and the full binary hash covers its exact bytes. That does not
establish an end-to-end mandatory integrity-bound execution carrier: genotype
hashing excludes it, code-only routes exist, and an old JSON reader can ignore a
new member while accepting the same old LUMP magic. No spare LUMP header field
or old-reader mandatory-extension mechanism was demonstrated.

Propose a **new outer execution envelope** for IDX1, preserving an ordinary
embedded LUMP byte-for-byte inside it. This adds framing at import/export,
admission and delivery boundaries, not a replacement artifact database.
Do not put the authoritative profile only in source, a sidecar, Namespace
generation, transport version or optional API member. Existing Full/compact/API
payloads remain available; their API frame and content rules are unchanged.
An API mirror of the profile, if displayed, is non-authoritative and must agree
with the envelope. Source is not required for decoding or admission.

## 2. Prospective exact envelope

This is a concrete proposed format, **not an approved magic allocation or an
existing implemented format**:

* Eight magic bytes: `43 4d 49 44 58 31 0d 0a` (ASCII `CMIDX1\r\n`).
* All integer framing fields are unsigned, big-endian. No native-endian fields.
* Offset 8: `envelopeVersion:u32`, exactly 1.
* Offset 12: `metadataByteLength:u32`, nonzero, at most 1048576.
* Offset 16: `payloadByteLength:u32`, exactly the inner LUMP allocation in bytes.
* Offset 20: `reserved:u32`, exactly zero.
* Offset 24: metadata bytes, exactly the declared length.
* Next: zero padding to a four-byte boundary, then the complete inner LUMP.
* EOF immediately follows payload. Truncation, trailing bytes, overflow,
  nonzero padding or unsupported version rejects the artifact.

Metadata is strict UTF-8 JSON, no BOM, duplicate keys, fractional numeric values
or negative zero. The schema below is closed: unknown fields reject version 1.
Numbers used as coordinates are integers in `0..4294967295`; all additions and
size multiplications are checked without wrapping. Metadata has these fields:

| Field | Exact type and requirement |
| --- | --- |
| `schema` | String, exactly `cm.idx1.execution/1` |
| `isaProfile` | String, exactly `IDX1` |
| `requiredFeatures` | Sorted, duplicate-free string array, exactly `["idx1.boundaries.v1","idx1.compact20.v1","idx1.dispatch.v1"]` for this version |
| `payloadSha256` | 64 lowercase hexadecimal characters, SHA-256 of all inner LUMP bytes |
| `layout` | Object with exactly `codeWords`, `extents`, `instructionStarts`, `dispatch`, `fastEntry` |
| `layout.codeWords` | Integer exactly equal to inner header `cw` |
| `layout.extents` | Ordered array of `{startWord,endWord,kind}`; kind is `code` or `data`; half-open, nonempty, disjoint, and together exactly partition `[1,1+cw)` |
| `layout.instructionStarts` | Strictly increasing array of LUMP-relative word offsets; precisely all decoded instruction starts in code extents |
| `layout.dispatch` | Ordered array of `{selector,word,kind}`; selector is positive and equals `word`; kinds are `branch`, `offset`, `private`; no repeated selector |
| `layout.fastEntry` | LUMP-relative word offset naming an instruction start in a code extent; selector zero resolves this explicit entry |

No optional source map is needed for execution. Existing compiler listings may
be attached by established tooling, but cannot override these facts. Any future
schema change requires explicit version support, not an ignored key.

The authoritative **execution identity** is SHA-256 over the entire envelope,
starting with magic and including all framing, exact metadata bytes, padding and
payload. The trusted compiler's integrity-protected output record or applicable
admission evidence must bind that digest, compiler/verifier identity and version,
and successful validation of this schema. A payload hash alone is insufficient;
a self-supplied digest is corruption detection, not provenance or authority.
The digest is external to the hashed envelope, avoiding a circular field.
Build evidence binds the exact independent execution metadata bytes as well as
the payload, regardless of whether metadata was generated from source, imported
or reconstructed by a verifier. Source presence, source hashes, API mirrors and
genotype identity never substitute for this cryptographic binding.
Different metadata serializations are different execution identities even if
their JSON meanings agree. Inner LUMP identity and execution identity are
distinct and must not be substituted for one another.

Existing storage may retain the envelope alongside the immutable inner object
using its existing artifact/evidence mechanism. Do not invent a new approval
database. If that mechanism cannot protect the entire envelope, IDX1 admission
is **unsupported** until upgraded.

## 3. Instruction representation

| Word | Bits |
| --- | --- |
| W0 | `[31:27]=10`; `[26:25]=roleMask`; `[24]=subtract`; `[23:20]=DR`; `[19:0]=magnitude` |
| W1 | Operation word, including its ordinary condition and unaffected fields |
| W2, iff roleMask=3 | `[31:25]=0`; `[24]=subtract`; `[23:20]=DR`; `[19:0]=magnitude` |

Mask 1 selects role 0; mask 2 selects role 1; mask 3 selects both.
W0 describes the lowest selected role, and W2 describes role 1. Mask zero
rejects. Single-role packets are two words, dual-role packets three words.
W0 has **no predicate field**: dispatch opcode 10 before extracting a condition;
the predicate is solely W1's. W1 cannot itself be a prefix, retired opcode, or
unsupported operation. W2 reserved bits must be zero.

Magnitude is `0..1048575`. Any DR0–DR15 may be read with architectural semantics.
DR0 plus magnitude expresses a literal; magnitude zero expresses register-only.
Subtract with zero magnitude is noncanonical and rejected. Assembler output
uses existing supported one-word literal encodings when possible, otherwise a
packet; it never truncates, samples a live register, or silently emits arithmetic
instructions for an out-of-range expression.

Role 0 is LOAD/SAVE/SWITCH row, CHANGE's defined index, DREAD/DWRITE offset,
BRANCH displacement or BFEXT/BFINS position. CALL has role 0 for an indexed
capability row and role 1 for method selector; direct-capability CALL permits
only role 1. Unselected roles keep their ordinary literal encoding. Selected
operand-value bits in W1 must be zero while required mode bits remain intact.
The exhaustive allowed role masks, hexadecimal W1 replacement masks and residual
mode constraints are specified in encoding section 3; its CHANGE unit rules
apply separately to system-register and Thread-context modes. They are not
unspecified fields to infer from legacy layouts. All modes retain their existing
permission, register-class, SELF, privilege and M-bit requirements unchanged.
RETURN masks, bit widths and ordinary register selectors are not indexed roles.

Read non-branch DR values as uint32, branch DR values as int32. Evaluate
`DR +/- magnitude` in exact signed wide arithmetic (at least 34 bits);
ordinary indices must remain in uint32 and their authorized range.
BRANCH adds its signed displacement to the **packet start**, not W1 or next PC.
No arithmetic, scaling, base addition or complete-width check may wrap.
Bit position plus width must fit the architecturally agreed field width.

## 4. Coordinate system and executable boundaries

Let `L` be the physical address of the inner LUMP header in **words**, and `w`
the LUMP-relative word offset. Header is `w=0`; first body word is `w=1`;
body is `[1,1+cw)`. Simulator code-view PC is `p=w-1`.
Physical simulator address is `L+w`; byte-addressed hardware NIA is
`4*(L+w)` (or `B+4*w` where `B` is the header's byte address).
Do not add the envelope header length to runtime PCs.

These formulas follow simulator fetch/CALL code and hardware `call.py`; the
simulator's selector-zero code currently assigns `this.pc=1` despite comments
describing word 1. IDX1 always uses `p=w-1`, including
`p=fastEntry-1`; it inherits no ambiguous legacy fast-entry PC convention.
Typically branch-dispatch output declares word 1. Output whose first slot is
raw-offset/private data must declare another valid instruction start.

Compiler sizing and label relocation count actual words. A packet occupies
two/three words but one source operation, one retirement and one step.
Source lookup normalizes `p` to `w=p+1` (hardware NIA to `(NIA-B)/4` with checked
alignment), then uses the packet-start mapping. Extension-word addresses may
be displayed as interiors of that packet, never as distinct instructions.
When source is absent, show symbolic disassembly and exact word coordinates;
do not substitute unrelated source or claim a source line.

Admission independently decodes each code extent from its first word, advances
by decoded length, and requires exact equality to `instructionStarts`. A packet
cannot straddle an extent, enter data, or consume words outside `cw`. Data,
header, API/source/freespace and C-list words cannot be executed. WORD constants
must be classified as data, not swept into code because they resemble opcodes.
W1 and W2 never appear in the start set.

Every initial entry, branch, CALL destination, RETURN continuation, fault resume,
thread restore and debugger PC write must name an admitted instruction start
in the selected code object. Falling through into data or past code faults before
fetch/issue of that next instruction. Interior breakpoints are rejected.

## 5. Method dispatch is typed, not guessed

The dispatch array explicitly classifies every callable table slot; API method
selectors must agree with it, but the public API alone is not a complete map
of private methods or internal code.

* `branch`: the table word is executable code, in the start set, and exactly
  a supported one-word unconditional BRANCH. Its destination is computed
  from **that table word's** coordinate and, when used, must be an instruction start.
  CALL may resolve that destination directly; it must not treat the BRANCH
  word as a raw address. Multiword table entries are not permitted in v1.
* `offset`: the table word is data, not an instruction start. Its nonzero value
  is a **LUMP-relative word offset**, and, when used, must name an instruction start.
  Simulator PC becomes `value-1`, hardware NIA `B+4*value`.
* `private`: the table word is data and zero. CALL to it rejects.
* Selector 0 bypasses the table and enters declared `fastEntry`. A nonzero selector absent
  from the declared dispatch array rejects; it cannot index arbitrary code.

No opcode-based fallback between these kinds exists in IDX1. In particular,
raw offset data resembling a BRANCH is still data. Executable branch entries
may be ordinary branch destinations; raw/private entries may not. New compiler
output should use branch entries; explicitly described offset entries remain
representable for interoperation. Legacy objects retain their own decoder and
dispatch rules rather than being relabeled IDX1.

## 6. Admission and trusted runtime state

Editing, design parsing and Save are not executable admission. Structurally
valid intentional-fault instructions remain representable and saveable, including
literal branch or method targets that would fail if executed. Report predictable
invalid targets as warnings, not a requirement that every literal target be
valid to Save. Malformed descriptors or metadata may be retained as inert design
input with explicit diagnostics; they cannot pass executable admission.

Unknown uploads remain inert. Validate envelope framing, complete integrity,
inner LUMP framing/type/authority, schema/features, extents, packet structure,
dispatch classification and the declared fast entry before making executable.
Validation of dispatch structure does not certify every encoded destination:
an invalid branch/offset destination is a diagnostic and runtime fault if used,
not permission to reject a structurally valid intentional-fault instruction.
Actual branch/method access is checked dynamically under the containment rules.
Trusted compiler output uses its protected output evidence; do not introduce
another canonical-source or approval-ledger gate. Dynamic index safety remains
a runtime responsibility, not a requirement to know DR values at compile time.

Admission binds validated profile, features, extents/start set and dispatch facts
to the exact admitted object through its existing protected object binding.
These facts are not a new executable identity authority, program-writable API
pointer, global user-selectable decoder toggle or parallel context cache.

Preserve the canonical Thread CALL frame and its saved normalized caller Enter
E-GT plus packed continuation/FLAGS/SZ/STO. Add no descriptor identities,
generations or profile fields to that frame. CALL resolves the callee E-GT and
validated object binding before committing the existing frame, then atomically
selects the callee's decoder mode with its PC. Continuation is after the whole
calling packet. RETURN uses the saved caller E-GT as its sole return authority,
reconstructs CR6/CR14 using existing validation, and derives profile and boundary
facts from that validated caller object binding before resuming the saved PC.
It does not restore profile from a host-side identity map or mutable CR0.
Thread switches, interrupt/fault resume, scheduling and debugger restores obey
the same derivation rule; the Thread's canonical frame remains the only suspended
execution-context authority. Suspension saves the next unexecuted NIA supplied
by the execution boundary, never a reconstructed UI/history continuation.
Never inherit IDX1 from the caller into a legacy callee, or vice versa.
Stale, absent or unknown descriptors reject before target execution.

Authority references: `.agents/memory/thread-object-runtime-authority.md` and
`.agents/memory/call-egt-identity-flow.md`. No Thread ABI extension, caller
register snapshots or duplicated executable identity cache is proposed here.

Structural packet validation precedes predicate evaluation. A valid false
predicate advances by complete packet length without index evaluation or operand
transactions. Accepted instructions latch DRs, capabilities, flags and relevant
authorization state once; internal multi-cycle reads must not mix contexts.
Interrupts/retirement expose only packet boundaries. Authority-dependent metadata
reads must themselves be authorized; complete all checks before protected
payload access, MMIO strobe, writes, capability replacement or frame commitment.
Fault reporting may occur but must not disclose protected operands.

## 7. Legacy and deployment compatibility

**Missing IDX1 metadata means explicitly LEGACY, never auto-detected IDX1.**
A naked valid legacy LUMP is eligible only for the supported legacy path.
Malformed metadata/envelope is an error, not "metadata missing." Unknown profile,
required feature, schema or envelope version rejects, with no downgrade.
Opcode 10 in legacy code is not a cue to switch modes.

The new magic's first word is `0x434d4944`, whose high five bits are not the
LUMP header magic `0x1f`. A legacy parser that checks that magic can reject the
envelope immediately. This is **potential rejection, not a guarantee** for
every historical raw-word/debug loader; headerless loaders can bypass framing.

Therefore IDX1 export, code extraction, simulator Enter, uploads, Save/re-embed,
boot preparation, lazy fetch, Namespace materialization, debugger injection and
hardware delivery require a common compatibility gate. They must preserve the
whole execution artifact/evidence or reject unsupported IDX1. An old tool must
not receive extracted inner words as an executable legacy artifact.
Hex/listing export may be inert inspection output, never a deployment substitute.
Recompiling source or changing output tier creates a new artifact and execution
digest; stripping source cannot strip profile/boundaries. Genotype equality is
never sufficient to reuse an IDX1 descriptor, trust decision or deployment cache.

If a route cannot prove preservation and target compatibility, disable IDX1
through that route. Merely documenting that old JSON readers ignore new keys
does not make them safe. The envelope cannot prevent deliberate manual
extraction; upgraded execution boundaries must also reject naked legacy streams
containing unsupported/retired executable encodings before entry.

## 8. Loader/hardware handshake contract

Before transferring executable state, the loader must obtain a trusted response
from the active runtime identifying: implementation/build identity, supported
envelope versions, profiles, required-feature identifiers, limits on metadata,
code size and boundary storage, and a fresh session identity.
For IDX1 all three declared features must be supported **in enforcement**,
not merely recognized by the host parser.

Installation request binds session, execution digest, destination/object
generation and descriptor digest. A successful acknowledgement binds those same
values and attests that exact code and descriptor were installed and made
read-only. Enter requires that acknowledgement and matching live generation.
Reset, bitstream change or reconnect invalidates session acknowledgements.
No response, unknown feature/profile, insufficient map capacity, hash mismatch
or absent boundary enforcement fails closed. There is no "try legacy" retry.

These are prospective semantic handshake fields, **not allocated existing
wire commands or MMIO addresses**. Transport authentication must follow the
deployment trust regime; an unauthenticated feature string is not an attestation.
Existing firmware, TraceUnit or packet versions cannot stand in for this
exchange. Wire assignment and trusted device-side enforcement remain blockers.

## 9. Immutability and invalidation

Protect code, dispatch data and validated descriptor/map from writes while
executable, including capability aliases, DMA, debug, restore and loader paths.
SELF/header facts used for the binding must also remain valid. A modification
requires quiescing users, revoking executable bindings and cached decodes,
invalidating descriptors and continuations, then creating/verifying a new
execution identity before re-entry. No interval may expose changed words with
old start bits. Lazy loading and relocation require evidence tying the exact
installed derivative to the verified portable envelope; do not pretend a seal
over the original bytes covers changed bytes.

## 10. Freeze blockers and acceptance requirements

No application/hardware changes, builds, tests, user workload execution or
artifact edits are part of this specification.

Before implementation can claim conformance:

1. Review and freeze the exact masks, grammar, modes and vectors already defined
   in the coordinated encoding draft; they are not pending specification here.
2. Implement its selector rules and this draft's explicit `fastEntry` coordinates;
   reconcile simulator BRANCH versus RTL raw-offset dispatch without changing
   legacy objects or inheriting their ambiguous PC conventions.
3. Implement the encoding draft's IDX1 bit-field semantics consistently in
   simulator/RTL; preserve explicit legacy treatment where old models disagree.
4. Follow the coordinated containment draft's fault precedence and finalize
   mapping to existing architectural fault codes, without inventing wire numbers.
5. Implement envelope preservation/integrity across every execution route,
   protected per-object profile state, boundary enforcement, mutation gates and
   device negotiation. Audit actual enforcement, not just metadata generation.
6. Later isolated synthetic verification must cover mixed one/two/three-word
   streams; false predicates and malformed packets; every interior-entry route;
   branch/raw/private dispatch; source-free API output; unknown/missing features;
   cross-profile CALL/RETURN/thread restore; old-tool stripping; full-envelope
   tampering; stale generations; checked arithmetic; and absence of unauthorized
   memory/MMIO transactions on failure.

Until these are complete, exporting this prospective envelope is a design
artifact only, not permission to execute IDX1 on current software or hardware.

**Historical draft freeze signature (not current encoding approval):** exact container/schema/magic,
handshake and coordinated specification freeze pending review; implementation,
cryptographic trust-path verification and conformance evidence unavailable.
No signature over a build or claim of conformance is supplied by this document.
# Phase 1 Mint and pkverify — code draft

Status: **review-only algorithm draft, not executable CLOOMC**.
Written before choosing growth headroom, at the user's request.

The subsequent requested **CLOOMC source drafts** are in
[source-drafts/](source-drafts/README.md). They use actual instruction syntax,
with undefined labels deliberately blocking compilation of unresolved contracts.
They are not operational services or measured Tiny LUMPs.

This draft makes control flow visible without inventing register assignments,
method numbers, credential formats or a Namespace commit mechanism. Uppercase
`UNRESOLVED_*` calls below are missing contracts, not accepting stubs. They have
no implementation and must block compilation/admission until resolved in the Q&A.
The proposed helper names and ordering are review proposals, not approved ABI.
Nothing here installs a LUMP, grants nstab authority or changes saved memory.

**Scope correction:** No GC in Phase 1. The user withdrew the PP250
garbage-to-NULL comment. Hardware G-bit inversion is conditional on a system
GC-enable setting; its location and control are Phase 2 open issues. Do not
add GC or automatic stale/garbage-GT nulling to these drafts. The agreed
TPERM NULL/EXACT behavior remains separate.

**Allocation requirement:** Phase 1 uses used/free memory-block tracking per
LUMP size class. Namespace-slot availability and generation tracking are
separate. Pool representation/ownership, initial sizing and authorized safe
release/reuse remain unresolved; this does not introduce GC or permit RESIDENT
reclamation. Include pool bookkeeping in the half-memory budget; the earlier
Tiny service estimates do not separately cost it.

**Approved reclamation requirement:** Zero the entire reclaimed block, including
unused capacity, before another object can use it. Clearing during Destroy
versus allocation, the mechanism and interruption handling remain software TBD.
Incomplete clearing must not permit reuse. This does not waive Destroy
exclusions or alter slot-version rules; no executable clearing helper is
introduced by this draft.

**Approved pool-release version rule:** Software increments the corresponding
Namespace-entry version before returning its block to the free pool.
`next_version = current_version + 1` must be in **1–511 inclusive**, with no
wrap to zero. Ordinary issued versions are 0–510; 510→511 destroys and
permanently retires the slot. Never issue or reallocate ordinary version 511.
Check the untruncated increment; masking 512 to zero is forbidden. Namespace
updates remain inside the same-scope single-slot LAMBDA. Release authority,
in-use safeguards, update ordering and interruption handling still need definition.

**Approved reallocation rule:** Mint uses the freed Namespace slot's retained
release version without another increment. Preserve this value across slot
clearing; it belongs to the slot, not the memory block. Example: 7 → release to
8 → reallocate using 8. A retained 511 is permanently retired, not allocatable.
Retention representation remains open. Boot-pair random versions also exclude
511: choose each independently from 0–510.

**Approved initial version:** The first allocation into a genuinely never-used
Mint slot uses **0**. Existing/freed slots retain their history, even when empty.
Proof of never-used status still needs a bookkeeping mechanism. Zero version
is not NULL type and does not authorize resets or wraparound.

## 1. ide.Mint

The shared entry below represents both approved operations. Whether the public
interface has one method or separate Create/Replace methods remains undecided.
`request`, `credential`, `result` and locals are symbolic values, not CR/DR
assignments. A result must not expose verifier private state or nstab.

**Approved Replace exclusions:** In addition to RESIDENT objects, reject the
active Thread and objects supplying currently executing code or the active
C-list, even with valid operation-authorized credentials. Hard-fault before
changing the target Namespace entry (including its version) or target memory.
Active-use detection and direct replacement's slot/version policy remain
software TBD; this requirement does not supply an executable detection helper.

**Approved authority boundary:** Mint uses a **LAMBDA in the same scope**.
Only that LAMBDA's code references `NSRW-GT`, on a **single Namespace slot at a
time**. The surrounding Mint code and pkverify do not reference it. This is not
a separate service LUMP or permission to pass the table capability to callers.
Exact LAMBDA syntax, capture/register handling and calling convention remain
unresolved; same scope alone is not evidence of hardware-enforced isolation.

The symbolic wrapper below expresses this boundary without selecting those
mechanisms. READ and COMMIT are draft internal actions, not new public methods.

```text
# Within Mint's scope; sole code reference to NSRW-GT.
slot_access = LAMBDA(single_destination_slot, action, inputs):
    UNRESOLVED_REQUIRE_EXACTLY_ONE_VALIDATED_SLOT(single_destination_slot)
    return UNRESOLVED_SLOT_ACCESS_AND_COMMIT_RULES(
        NSRW-GT, single_destination_slot, action, inputs)
    # Never return NSRW-GT or operate on a second slot in this invocation.
```

Every table access requiring NSRW-GT, including initial reads and commit-time
rechecks, goes through this LAMBDA. Single-slot operation does not establish
atomic four-word writes, external-writer exclusion or reset/fault safety.

**Approved update boundary:** Finish verification and preparation before the
first Namespace write. From that write through confirmed completion, the
single-slot LAMBDA must not CALL, CHANGE, SWITCH or otherwise yield. Exclude
other writers and prevent readers from using partial entries. Publish the
resulting GT only after all required writes are confirmed. Faults hard-fault;
no rollback is promised. This is not a watchdog/reset/fault exemption.
The concrete exclusion, write confirmation and interrupted-write containment
mechanisms remain unresolved and must be verified before operational use.

**Approved fault rule:** Any fault in Mint, its same-scope LAMBDA or pkverify
is a **hard fault**. Failed verification, authorization, validation, destination
checks and commit checks do not return a recoverable rejection. `HARD_FAULT`
below is non-returning symbolic notation, not a selected instruction encoding or
fault-code assignment. Every unresolved check must obey this rule when defined.
No retry, rollback, repair or continuation is introduced. A hard fault does not
undo earlier writes or prove atomicity; write visibility still needs definition.

**Standard software hard-fault reporting — requirement:** Provide a common,
non-returning hard-fault path with structured, programmatically interpretable
diagnostic data for the IDE, rather than unrelated ad hoc fault paths per method.
Reporting must not expose proof material or private authority, and failure to
deliver diagnostics must not prevent the hard fault.

**Agreed starting design:** `HARDFAULT reason` is a compiler pseudo-instruction,
not a new hardware opcode. At each site the compiler emits a non-returning
hard-fault sequence and an IDE-readable fault-map entry, tied to the **exact
compiled artifact**:

```text
instruction offset → reason, method, source line, explanation
```

For example, intended source syntax (not yet supported by the compiler):

```text
bad_passkey:
    HARDFAULT PASSKEY_MISMATCH
```

The IDE resolves the captured fault location against the loaded artifact's
matching map. Without the exact map, show the raw fault location rather than
guessing. Start with **static diagnostics only**; dynamic values and register
dumps are not part of this agreement. Keep explanatory strings in the IDE map,
not necessarily in Tiny LUMPs. There is no runtime message construction,
reporting CALL, network dependency or diagnostic scratch-register requirement
in this basic design. Compiler-generated checks may use the same construct.

**Lowering approach — approved:** Emit one designated non-executable word
that triggers the existing `INVALID_OP` hard-fault path. The exact-artifact
fault map identifies intentional HARDFAULT sites and supplies their reasons;
do not label every INVALID_OP as an intentional software fault. No new
executable opcode, scratch register or reporting CALL is introduced. The
designated word must remain non-executable in future ISA revisions.

Genesis selected `0xF7000000` following isolated verification. Full target
integration and pre-recovery capture/transport remain verification gates.
`HALT` is not a substitute. Map serialization, capture/transport details and
implementation remain open. No rollback or continuation is implied.

The [isolated candidate investigation](HARDFAULT-CANDIDATE-VERIFICATION.md)
records **`0xF7000000`**, with simulator/RTL state and location evidence and
explicit IDE/target-integration gaps. Selection does not enable compiler
emission or claim physical acceptance.

```text
Mint(request, credential):
    result = NON_SUCCESS_WITHOUT_CAPABILITY

    # Freeze requested inputs without granting authority or writing the table.
    frozen = UNRESOLVED_CAPTURE_REQUEST(request)
    if frozen.operation not in {CREATE, REPLACE}:
        HARD_FAULT(UNSUPPORTED_OPERATION)

    # Authentication does not itself authorize creation or replacement.
    verified = pkverify(credential, frozen)
    if not verified.accepted:
        HARD_FAULT(VERIFICATION_FAILED)

    authorized = UNRESOLVED_AUTHORIZE_OPERATION(verified, frozen)
    if not authorized:
        HARD_FAULT(NOT_AUTHORIZED)

    # Bind networked T / virtualGT to this exact destination; no T-as-hash rule.
    destination = UNRESOLVED_RESOLVE_CM_NAMESPACE_AND_SLOT(frozen)
    current = slot_access(destination, READ, frozen)

    if frozen.operation == CREATE and current.occupied:
        HARD_FAULT(DESTINATION_OCCUPIED)
    if frozen.operation == REPLACE:
        if not current.occupied:
            HARD_FAULT(DESTINATION_EMPTY)
        if current.RESIDENT:
            HARD_FAULT(RESIDENT_REPLACEMENT_FORBIDDEN)
        UNRESOLVED_REQUIRE_REPLACEMENT_SAFETY(current, frozen)

    # Missing validation is a blocker, never an implicit successful check.
    UNRESOLVED_VALIDATE_EXPECTED_DESTINATION(current, frozen)
    UNRESOLVED_VALIDATE_OBJECT_TYPE_AND_COMPLETE_LUMP(frozen)
    UNRESOLVED_VALIDATE_IDENTITY_RIGHTS_AND_BOUNDS(frozen, authorized)
    UNRESOLVED_VALIDATE_ALLOCATION_AND_NONOVERLAP(frozen, destination)
    UNRESOLVED_REQUIRE_WITHIN_PHASE1_HALF_MEMORY_BUDGET(frozen)

    # Software selects generation; hardware only checks equality.
    # First allocation into a proven never-used slot uses 0.
    # Pool release increments without wrap; 510->511 retires the slot.
    # Reallocation uses retained 1..510 without another increment.
    # Direct replacement's slot/version policy: software issue, TBD by user.
    # Same-slot/version-plus-one replacement was proposed, NOT approved.
    generation = UNRESOLVED_SELECT_SOFTWARE_GENERATION(current, frozen)
    UNRESOLVED_REQUIRE_GENERATION_IN_RANGE(generation, 0, 510)
    candidate = UNRESOLVED_PREPARE_OBJECT_AND_FOUR_WORD_ENTRY(
        frozen, destination, generation)
    candidate.W2 = integrity32(candidate.W0, candidate.W1)
    candidate.W3 = UNRESOLVED_BIND_NETWORK_T_OR_LOCAL_GT(frozen, candidate)

    # This is an unresolved boundary, NOT a claim that four DWRITEs are atomic.
    committed = slot_access(destination, COMMIT, {
        current, candidate,
        mandatory_rechecks = {
            authorization,
            expected_destination,
            allocation,
            generation,
            reject_REPLACE_if_destination_is_RESIDENT
        }})

    # Fault/reset or a lost return is not an ordinary "nothing changed" denial.
    UNRESOLVED_REQUIRE_CONFIRMED_COMMIT(committed)
    return UNRESOLVED_PUBLISH_AUTHORIZED_GT_AND_SUCCESS(committed)
```

The RESIDENT rule applies to Mint and pkverify themselves if RESIDENT. A caller
cannot override it with stronger authorization or available growth space.
The commit boundary must preserve that rule against destination changes after
the initial read. This draft supplies no automatic retry or rollback strategy.

## 2. Passkey-GT creation/sharing and pkverify

**Approved:** Mint creates a **passkey-GT** and shares it as permitted by the
design structure, to be defined as a **list of approved GTs**. This is the
selected authority direction, not an IDE-only or unrestricted-CM caller rule.
**Phase 1 policy responsibility belongs to Genesis.** Genesis defines and
approves the GT list and permitted sharing structure; Mint implements that
policy, not its own selection of approved recipients.
The actual list, representation and enforcement mechanics remain TBD.
Do not invent approved entries or infer that possessing Mint's E capability
alone permits receiving or further sharing the passkey-GT.

**Proof requirement — approved:** pkverify requires the passkey-GT **and a
separate 128-bit proof**. Mint creates that proof **when it forges the PassKey**.
Missing or invalid credentials/proof hard-fault; matching GT bits alone cannot
succeed. Proof generation mechanism, protected storage, transfer and verification
ABI remain unresolved.

The following symbolic outline records Mint's additional responsibility.
It does not select a public method name, register ABI, first-issuance mechanism
or token/proof format. All failed checks hard-fault.

**Initial PassKey issuance — approved:** Mint creates the initial
GT/separate-128-bit-proof pairs through a separate Genesis-authorized setup
procedure, for explicitly approved recipients and permissions. No
unauthenticated first-caller shortcut is permitted. Ordinary Create, Replace
and Destroy still require valid, operation/target-authorized PassKeys. Setup
mechanics, authorization representation and protected delivery remain software
TBD; the outline below does not implement the bootstrap procedure.

**Onward sharing — approved:** Require explicit Genesis authorization before a
holder shares its GT/proof pair onward. Possession alone grants no delegation
rights. Unauthorized attempts must hard-fault. **SAVE GT detects Abstract
PassKeys**; the GT-side detection point is therefore identified. Genesis-authorized
sharing representation, recipient identification and separate proof
protection/transfer remain TBD. SAVE's GT check is not a claim that arbitrary
proof-byte copying is detected or that simulator/RTL/physical FPGA conformance
has been verified.

```text
# Mint responsibility; exact callable interface TBD.
Mint_create_and_share_passkey(request):
    policy = UNRESOLVED_GET_GENESIS_APPROVED_GT_LIST()
    UNRESOLVED_REQUIRE_ISSUANCE_AND_SHARING_PERMITTED(request, policy)
    # Forge the PassKey and create its separate 128-bit proof at that time.
    passkey_gt, proof128 = UNRESOLVED_FORGE_PASSKEY_WITH_128_BIT_PROOF(request, policy)
    UNRESOLVED_PROTECT_CREATED_PROOF(passkey_gt, proof128)
    UNRESOLVED_SHARE_ONLY_AS_DESIGN_PERMITS(passkey_gt, request, policy)
    # Proof transfer is TBD; this does not expose proof128 in the public result.
    return UNRESOLVED_SUCCESS_WITHOUT_PRIVATE_STATE()
```

Any Namespace access requiring NSRW-GT remains confined to Mint's same-scope,
single-slot LAMBDA. This decision does not settle the proof-generation mechanism,
credential storage, revocation, replay, onward-sharing enforcement or bootstrap
mechanics.
It does not equate the passkey-GT with NSRW-GT or grant the recipient table RW.

```text
pkverify(credential, frozen_request):
    result = NOT_VERIFIED

    # Mint creates the separate 128-bit proof when forging the PassKey.
    # Passkey-GT sharing follows the Genesis-approved GT list.
    # Issuance mechanics, private storage and proof transport remain undecided.
    trusted = UNRESOLVED_GET_PRIVATE_VERIFICATION_STATE(credential)
    # Equality is not validity: NULL==NULL or invalid==invalid must not pass.
    UNRESOLVED_REQUIRE_INITIALIZED_ACTIVE_MINT_ISSUANCE(trusted)
    UNRESOLVED_VALIDATE_BOTH_NON_NULL_PASSKEYS_AND_LIVE_BINDINGS(credential, trusted)
    UNRESOLVED_REQUIRE_COMPLETE_PROOF_PRESENCE_ON_BOTH_SIDES(credential, trusted)
    UNRESOLVED_KEEP_VALIDATED_CREDENTIAL_AND_TRUSTED_STATE_STABLE()
    UNRESOLVED_CHECK_CREDENTIAL_BINDING_AND_REVOCATION(trusted, credential)
    UNRESOLVED_REQUIRE_PASSKEY_GT_AND_128_BIT_PROOF(credential)
    UNRESOLVED_VERIFY_PASSKEY_GT_AND_128_BIT_PROOF(trusted, credential, frozen_request)
    UNRESOLVED_ENFORCE_AGREED_REPLAY_RULES(trusted, credential, frozen_request)

    # Equality of GT bits alone is not a substitute for required proof.
    # This result is verification evidence, not blanket operation authorization.
    result = UNRESOLVED_FORM_NONSECRET_VERIFICATION_RESULT(trusted)
    UNRESOLVED_CLEAN_PRIVATE_SCRATCH_BEFORE_SUCCESS_RETURN()
    return result
```

Failed checks hard-fault; pkverify returns only after successful verification.
Fault attribution and private-state protection still need explicit contracts;
the linear notation does not imply that fault/reset reaches software cleanup.
No cryptographic primitive, proof register or credential storage layout is
selected here.

**Mandatory validity before equality:** `TPERM ... EXACT ...` compares bits,
not valid PassKey authority. Reject NULL on either side using architectural
NULL-type semantics, not merely a zero-word test. Equal malformed, wrong-type,
stale or revoked credentials cannot pass. Require initialized trusted Mint
issuance state independent of caller-supplied expected values, complete proof
presence, and the intended object/authorization binding. Missing state must
never default to a zero GT or zero proof. Do not equate a proof's numeric value
with presence; no special all-zero-proof rule has been selected.

**Agreed TPERM design direction:** A dedicated `TPERM CRn, NULL` tests the
architectural NULL type without faulting or changing the capability (Z=1 for
NULL, Z=0 otherwise). The paired EXACT change hard-faults if either operand is
NULL before comparing bits. **Approved NULL-test flags:** Z=is-NULL,
N=not-NULL, C=0, V=0 (NULL: NZCV=0100; non-NULL: NZCV=1000).
**Approved conditional execution:** When TPERM's condition is false, it performs
no operand checks, raises no TPERM fault, and preserves flags and capabilities.
This applies to both NULL and EXACT; a skipped EXACT cannot fault on NULL.
Independent fetch faults and watchdog expiry are not suppressed.
**Approved EXACT fault rule:** An executed EXACT with either operand NULL
hard-faults before changing flags or operands. The captured fault location
identifies EXACT itself, even if subsequent architectural fault handling runs.
**Approved encoding:** NULL uses TPERM preset **15 (`0x0F`)**, with the
TPERM opcode unchanged. **Plain NULL only is approved:** the B-modified
instruction encoding 31 (`0x1F`) remains reserved, rejected by assembly and
hard-faulting when executed; condition-skipped instructions still skip.
The GT operand's own B bit is irrelevant to its NULL type and is ignored by
the NULL test. That does not mean ignoring the instruction's B modifier.
These design changes are not implemented here; matching assembler/simulator/RTL
support and evidence, including pre-fault state and location capture, remain
outstanding. Current reserved-preset rejection must not be mistaken for support.
Neither test replaces trusted issuance, validity or proof checks.

**Approved F/G and B boundaries:** Use an authorized Namespace Word-1 read and
BFEXT to inspect F[31]/G[30], not new TPERM presets. In Mint, the read is confined
to the same-scope single-slot LAMBDA; no GC is introduced. If B=true must be set
on a GT, use a privileged function, not a new set-B instruction. Its authority,
ABI and implementation still require definition. The read-only TESTB proposal
is not approved by this decision, and the clear-B modifier is unchanged.

Required acceptance cases include NULL/NULL (including nonzero NULL encodings),
NULL/valid, valid/NULL, equal invalid tokens, uninitialized trusted records,
missing/truncated proofs, caller-substituted reference state, stale/revoked
credentials and changed state between validation and use. All must hard-fault
without publishing authority or modifying the Namespace. Include a valid issued
GT/proof control. These are required tests, not completed runtime evidence.

## 3. Approved integrity calculation

This part is fully specified; all arithmetic is unsigned 32-bit.

```text
rol32(value, shift):
    return ((value << shift) | (value >> (32 - shift))) & 0xFFFFFFFF

integrity32(W0, W1):
    maskedW1 = W1 & 0x3FFFFFFF    # Ignore F and G, and no other bits.
    return rol32(W0, 7) XOR rol32(maskedW1, 13) XOR 0xDEADBEEF
```

Independent examples:

| W0 | W1 | integrity32 |
|---|---|---|
| 0x00000000 | 0x00000000 | 0xDEADBEEF |
| 0x00000000 | 0xC0000000 | 0xDEADBEEF |
| 0x00000001 | 0x00000001 | 0xDEAD9E6F |

## 4. Tiny LUMP size estimates — agreed planning basis

The user agreed to record the following rough estimates. They are **not compiled
measurements, approved memory reservations or approval of the proposed 100%
growth allowance**. One word is four bytes; KiB means 1,024 bytes.

Assumptions: Tiny carries no embedded source and only minimal required metadata.
pkverify performs a small credential/proof check, not a full software public-key
signature algorithm. This is a sizing assumption, not selection of its unresolved
verification contract. Method/helper names remain provisional, not approved ABI.

### ide.Mint

Create and Replace share validation and publication code. Shared routines are
counted once, not once per entry point.

| Method / shared routine | Estimated words | Bytes |
|---|---:|---:|
| Create — empty-slot checks and request setup | 24 | 96 |
| Replace — authorization path, expected-state and RESIDENT exclusion | 40 | 160 |
| Shared authorization and verifier call | 64 | 256 |
| Object, identity, type and permission validation | 56 | 224 |
| Allocation, bounds and overlap checks | 32 | 128 |
| Entry construction and integrity calculation | 16 | 64 |
| Commit, exclusion and destination recheck | 48 | 192 |
| Success result, hard-fault branches and cleanup paths | 24 | 96 |
| **Code subtotal** | **304** | **1,216** |
| Header, dispatch, C-List, minimal metadata and local data allowance | 80 | 320 |
| **Estimated payload** | **384** | **1,536** |
| **Estimated power-of-two LUMP allocation** | **512** | **2,048 — 2 KiB** |

### pkverify

| Method / shared routine | Estimated words | Bytes |
|---|---:|---:|
| Verify entry and credential lookup | 24 | 96 |
| Proof comparison and object/request binding | 48 | 192 |
| Credential validity/revocation checks | 32 | 128 |
| Result and private-scratch cleanup | 24 | 96 |
| **Code subtotal** | **128** | **512** |
| Header, dispatch, C-List, minimal metadata and local data allowance | 64 | 256 |
| **Estimated payload** | **192** | **768** |
| **Estimated power-of-two LUMP allocation** | **256** | **1,024 — 1 KiB** |

### Combined budget

| Item | Words | Bytes |
|---|---:|---:|
| Mint + pkverify estimated payload | 576 | 2,304 |
| **Estimated allocated Tiny LUMPs** | **768** | **3,072 — 3 KiB** |
| Existing 256-slot Namespace table | 1,024 | 4,096 — 4 KiB |
| **Services plus table** | **1,792** | **7,168 — 7 KiB** |

nstab RW accesses the existing table: it needs neither a third executable LUMP
nor another table copy. Power-of-two rounding above is not an additional
deliberate growth reservation.

Use **3 KiB as the working service estimate**, with a rough **3–6 KiB combined
service-LUMP range** while mechanisms are settled. This is not a guaranteed upper
bound. Private credential storage, request buffers, Thread stacks and any separate
networking service are additional. Full software cryptography or substantial
replay/recovery machinery could exceed the range.

All of these costs, together with the other Phase 1 objects, must fit within
half the FPGA memory. No board-fit claim follows from these estimates.

The subsequent passkey-GT creation/sharing decision has not been separately
costed in this table. Retain the agreed figures as the earlier planning baseline,
not proof that the additional issuance/list-enforcement code fits those sizes.

## 5. From this draft to measurable code

**Approved acceptance requirement, with Genesis override:** Require simulator,
RTL-test and physical FPGA evidence tied to the exact release build for
TPERM NULL/EXACT (NULL/NULL and condition skips included), HARDFAULT with correct
IDE fault location/reason, and exclusive single-slot updates with publication
only after confirmed writes. Genesis may override this evidence requirement;
identify that acceptance as an override, not as a passed or observed test.
This approval exercises no override and authorizes no build/upload/flash.

Resolve the `UNRESOLVED_*` contracts one at a time, then translate into CLOOMC
with an explicit C-List and preserved/clobbered register ABI. In particular,
nstab's slot assignment alone does not confer authority: the approved same-scope
LAMBDA is the sole code reference to NSRW-GT. Its provisioning and register
handling still need definition. No scratch CR is assigned here; CR13 must remain
NULL and untouched.

Measure compiled complete LUMPs only after those mechanisms exist. This draft's
line count is not a code-size estimate. All Phase 1 allocations must fit within
half the FPGA memory, including the 4 KiB, 256-slot Namespace table.
The proposed 100% service headroom remains **unapproved**; choose it after the
code draft and sizing evidence, not as a prerequisite to drafting.

See [the service contract draft](MINT-FIRST-DRAFT.md) and
[the resolution log](REVIEW-2026-10-14.md). This is a new review output, not a
member added retroactively to the original 45-source audit.

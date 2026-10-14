# Phase 1 Mint and pkverify — code draft

Status: **review-only algorithm draft, not executable CLOOMC**.
Written before choosing growth headroom, at the user's request.

This draft makes control flow visible without inventing register assignments,
method numbers, credential formats or a Namespace commit mechanism. Uppercase
`UNRESOLVED_*` calls below are missing contracts, not accepting stubs. They have
no implementation and must block compilation/admission until resolved in the Q&A.
The proposed helper names and ordering are review proposals, not approved ABI.
Nothing here installs a LUMP, grants nstab authority or changes saved memory.

## 1. ide.Mint

The shared entry below represents both approved operations. Whether the public
interface has one method or separate Create/Replace methods remains undecided.
`request`, `credential`, `result` and locals are symbolic values, not CR/DR
assignments. A result must not expose verifier private state or nstab.

```text
Mint(request, credential):
    result = NON_SUCCESS_WITHOUT_CAPABILITY

    # Freeze requested inputs without granting authority or writing the table.
    frozen = UNRESOLVED_CAPTURE_REQUEST(request)
    if frozen.operation not in {CREATE, REPLACE}:
        return UNRESOLVED_PUBLIC_REJECTION(UNSUPPORTED_OPERATION)

    # Authentication does not itself authorize creation or replacement.
    verified = pkverify(credential, frozen)
    if not verified.accepted:
        return UNRESOLVED_PUBLIC_REJECTION(VERIFICATION_FAILED)

    authorized = UNRESOLVED_AUTHORIZE_OPERATION(verified, frozen)
    if not authorized:
        return UNRESOLVED_PUBLIC_REJECTION(NOT_AUTHORIZED)

    # Bind networked T / virtualGT to this exact destination; no T-as-hash rule.
    destination = UNRESOLVED_RESOLVE_CM_NAMESPACE_AND_SLOT(frozen)
    current = UNRESOLVED_READ_TRUSTED_DESTINATION_STATE(destination)

    if frozen.operation == CREATE and current.occupied:
        return UNRESOLVED_PUBLIC_REJECTION(DESTINATION_OCCUPIED)
    if frozen.operation == REPLACE:
        if not current.occupied:
            return UNRESOLVED_PUBLIC_REJECTION(DESTINATION_EMPTY)
        if current.RESIDENT:
            return UNRESOLVED_PUBLIC_REJECTION(RESIDENT_REPLACEMENT_FORBIDDEN)
        UNRESOLVED_REQUIRE_REPLACEMENT_SAFETY(current, frozen)

    # Missing validation is a blocker, never an implicit successful check.
    UNRESOLVED_VALIDATE_EXPECTED_DESTINATION(current, frozen)
    UNRESOLVED_VALIDATE_OBJECT_TYPE_AND_COMPLETE_LUMP(frozen)
    UNRESOLVED_VALIDATE_IDENTITY_RIGHTS_AND_BOUNDS(frozen, authorized)
    UNRESOLVED_VALIDATE_ALLOCATION_AND_NONOVERLAP(frozen, destination)
    UNRESOLVED_REQUIRE_WITHIN_PHASE1_HALF_MEMORY_BUDGET(frozen)

    # Software selects generation; hardware only checks equality.
    # Do not infer wrap, increment or no-wrap policy here.
    generation = UNRESOLVED_SELECT_SOFTWARE_GENERATION(current, frozen)
    UNRESOLVED_REQUIRE_GENERATION_IN_RANGE(generation, 0, 511)
    candidate = UNRESOLVED_PREPARE_OBJECT_AND_FOUR_WORD_ENTRY(
        frozen, destination, generation)
    candidate.W2 = integrity32(candidate.W0, candidate.W1)
    candidate.W3 = UNRESOLVED_BIND_NETWORK_T_OR_LOCAL_GT(frozen, candidate)

    # This is an unresolved boundary, NOT a claim that four DWRITEs are atomic.
    committed = UNRESOLVED_COMMIT_WITH_EXCLUSION_AND_INTERRUPTION_RULES(
        destination, current, candidate,
        mandatory_rechecks = {
            authorization,
            expected_destination,
            allocation,
            generation,
            reject_REPLACE_if_destination_is_RESIDENT
        })

    # Fault/reset or a lost return is not an ordinary "nothing changed" denial.
    UNRESOLVED_REQUIRE_CONFIRMED_COMMIT(committed)
    return UNRESOLVED_PUBLISH_AUTHORIZED_GT_AND_SUCCESS(committed)
```

The RESIDENT rule applies to Mint and pkverify themselves if RESIDENT. A caller
cannot override it with stronger authorization or available growth space.
The commit boundary must preserve that rule against destination changes after
the initial read. This draft supplies no automatic retry or rollback strategy.

## 2. pkverify

```text
pkverify(credential, frozen_request):
    result = NOT_VERIFIED

    # Credential issuance, private storage and proof transport remain undecided.
    trusted = UNRESOLVED_GET_PRIVATE_VERIFICATION_STATE(credential)
    UNRESOLVED_CHECK_CREDENTIAL_BINDING_AND_REVOCATION(trusted, credential)
    UNRESOLVED_VERIFY_REQUIRED_PROOF(trusted, credential, frozen_request)
    UNRESOLVED_ENFORCE_AGREED_REPLAY_RULES(trusted, credential, frozen_request)

    # Equality of GT bits alone is not a substitute for required proof.
    # This result is verification evidence, not blanket operation authorization.
    result = UNRESOLVED_FORM_NONSECRET_VERIFICATION_RESULT(trusted)
    UNRESOLVED_CLEAN_PRIVATE_SCRATCH_ON_ALL_DEFINED_EXIT_PATHS()
    return result
```

Denial, hard-fault, cleanup and public error behavior need explicit contracts;
the linear notation does not imply that fault/reset always reaches cleanup.
No cryptographic primitive, proof register or credential storage layout is
selected here.

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

## 4. From this draft to measurable code

Resolve the `UNRESOLVED_*` contracts one at a time, then translate into CLOOMC
with an explicit C-List and preserved/clobbered register ABI. In particular,
nstab's slot assignment does not decide who holds its RW capability. No scratch
CR is assigned here; CR13 must remain NULL and untouched.

Measure compiled complete LUMPs only after those mechanisms exist. This draft's
line count is not a code-size estimate. All Phase 1 allocations must fit within
half the FPGA memory, including the 4 KiB, 256-slot Namespace table.
The proposed 100% service headroom remains **unapproved**; choose it after the
code draft and sizing evidence, not as a prerequisite to drafting.

See [the service contract draft](MINT-FIRST-DRAFT.md) and
[the resolution log](REVIEW-2026-10-14.md). This is a new review output, not a
member added retroactively to the original 45-source audit.

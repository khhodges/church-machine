# Mint concrete signature review

Layout/conventions are approved. On 2026-10-31 the user selected
zero-initialized DATA first for CREATE. That CREATE scope and the described
two-scalar signature are settled; implementation and service acceptance are
still pending. DESTROY's concrete typed signature remains a candidate.

## Findings from current editable Mint source

The current source uses CR2 for the PassKey, CR7 plus a DR2 slot number for
DESTROY, and DR1=1 for completion. These are old conventions, not authority to
override the approved CR1 PassKey, CR2 target-only, zero-success ABI.

CREATE currently implements only zero-initialized DATA RW allocation. DR2
contains the power-of-two word size OR case code 4; DR3 must equal 3 (DATA RW).
It requires CR4 NULL rather than consuming an initializer object. Therefore an
initializer-taking signature would assert behavior not implemented here.

MakeOutform and MakeInform contain explicit unsupported hard-fault gates.
Declaring their types cannot establish working conversions.

## Approved CREATE slice

```
method CREATE(allocation: U32, permissions: U32) -> Inform[RW]
```

CREATE preserves its existing packed allocation/permission scalar meanings.
CR2 is unused and ignored in this zero-initialization-only slice, not required
to be NULL. PassKey remains mandatory in CR1. Returning Inform[RW] describes
the DATA RW slice, not generic allocation of other object types.

Exact method tuple under the approved compact layout:

```json
"CREATE":[0,[["allocation",1],["permissions",1]],[2,"RW"]]
```

This is one method entry, not a complete Mint API or evidence of a working
executable. The public selector remains 0, wire selector 1. PassKey is declared
once at abstraction level and arrives in CR1; allocation is DR2 and permissions
is DR3. On successful completion DR1=0 and CR1 holds the Inform RW result.
On a normal error return DR1 is nonzero and CR1 is NULL.

Unused inputs, including CR2, CR4 and DR4, are ignored. Existing NULL/zero
preconditions on unused inputs must not be copied into the new entry path.
They may be overwritten as scratch subject to architectural preservation rules.
The input PassKey must be verified or safely retained before CR1 is cleared
or reused. Do not transplant the old entry's unconditional CR1 clear.

Acceptance must check:

- Exact signature/tuple round-trip and embedded method-table consistency.
- PassKey accepted/rejected through the real verification path.
- Completion status and capability result agree; no old success=1 convention.
- Allocated DATA storage is zeroed before the result is issued.
- Different values in unused inputs do not change the operation's outcome.
- Invalid allocation/permission requests and resource exhaustion cannot report
  success or return authority. Preserve explicit hard-fault paths unless a
  normal-return replacement has been separately reviewed.
- No initializer copying, other object allocation modes, or conversion
  functionality is claimed by these tests.

## DESTROY candidate, separate from the CREATE scope decision

```
method DESTROY(target: Inform[RW]) -> Void
```

DESTROY's only ordinary input is the object GT in CR2. No caller-supplied slot
number. Any internal slot lookup must derive from and validate that GT, with
existing ownership/liveness checks maintained. This requires a real source
port, not just metadata edits.

These signatures do not expand supported object forms or memory grants.
Initializer support needs a separate definition of accepted capability form,
rights, payload geometry, copy/initialization behavior and failure semantics.
Conversion signatures and accepted forms also need review before publication.

## Acceptance implications

The passing PkVerify fixture tests the old calling convention. It is useful
baseline evidence, but does not prove the new CR1 argument survives entry,
that the target survives verification, or that status/cleanup match the new ABI.
The compiler/body/fixture changes must be validated together in isolated
software checks. No saved artifacts, hardware, or RTL were changed in this review.

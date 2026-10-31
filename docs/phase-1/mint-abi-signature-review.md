# Mint concrete signature review

Layout/conventions are approved. Concrete signatures below are candidates,
not implemented or accepted service behavior.

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

## Recommended first slice, pending approval

```
method CREATE(allocation: U32, permissions: U32) -> Inform[RW]
method DESTROY(target: Inform[RW]) -> Void
```

CREATE preserves its existing packed allocation/permission scalar meanings.
CR2 is unused and ignored in this zero-initialization-only slice, not required
to be NULL. PassKey remains mandatory in CR1. Returning Inform[RW] describes
the DATA RW slice, not generic allocation of other object types.

DESTROY's only ordinary input is the object GT in CR2. No caller-supplied slot
number. Any internal slot lookup must derive from and validate that GT, with
existing ownership/liveness checks maintained. This requires a real source
port, not just metadata edits.

These candidates do not expand supported object forms or memory grants.
Initializer support needs a separate definition of accepted capability form,
rights, payload geometry, copy/initialization behavior and failure semantics.
Conversion signatures and accepted forms also need review before publication.

## Acceptance implications

The passing PkVerify fixture tests the old calling convention. It is useful
baseline evidence, but does not prove the new CR1 argument survives entry,
that the target survives verification, or that status/cleanup match the new ABI.
The compiler/body/fixture changes must be validated together in isolated
software checks. No saved artifacts, hardware, or RTL were changed in this review.

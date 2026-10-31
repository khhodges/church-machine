# Compact Mint ABI — review proposal

Status: conventions approved by the user on 2026-10-31; not implemented.
The separate layout/signature proposal still needs review.
Existing compact APIs encode
explicit register names and Inform/Outform/Abstract type strings. This proposal
changes the contract; it is not a description of current output.

## Established constraints

- One universal convention; no Standard1 selector or legacy fallback.
- PassKey Required is declared once per abstraction and applies to every
  exported method, including conversions.
- CR1 supplies the PassKey and carries a capability result on return.
- CR2 supplies the initializer or target OBJECT GT, never a Namespace slot.
- DR1 is status: zero success, nonzero failure. Scalar arguments start at DR2.
- Unused inputs are ignored, not required to be zero.
- Mint is called through the caller's CR6 C-list. Public method zero encodes
  wire selector one. Keep the existing method-table prefix.
- Historical artifacts remain immutable; new builds require recompilation.
- One-time PassKey semantics are not defined by this declaration.

## Approved source declaration

Structured CLOOMC++: `passkey required;` inside the abstraction, once.
Native assembly equivalent: `@passkey required`, once at abstraction scope.
Duplicate, conflicting, or method-scoped declarations are compile errors.
The IDE renders either spelling as **PassKey Required**.

The compiler must reject omission for this upgrade's protected ABI, rather than
silently selecting a different calling convention. This declaration documents
the requirement; it is not evidence that the executable verifies the PassKey.
Mint's real verification path must remain part of acceptance.

## Approved ABI type codes

These are metadata tags, NOT GT bit encodings or permission grants.

| Code | Meaning |
|---|---|
| 0 | No result (return position only) |
| 1 | Unsigned 32-bit scalar |
| 2 | Inform capability |
| 3 | Outform capability |
| 4 | Abstract capability |
| 5 | Object capability, with the accepted forms explicitly declared |

PassKey is implicit CR1 input, not a repeated method parameter or a new GT type.
Capability rights remain explicit; a type tag grants no authority. Unknown
codes and invalid combinations fail compilation/admission.
Do not infer what forms a method accepts merely from code 5. Keep an explicit
accepted-form set, checked against the method contract.

For Mint: CREATE takes its initializer in CR2; DESTROY, MakeOutform and
MakeInform take their one target capability in CR2. MakeOutform returns an
Outform; MakeInform returns an Inform; DESTROY has no capability result.
CREATE's accepted initializer forms and result form must match the chosen
implementation, not a generic fixture or invented default.

## Approved returned status numbers

| DR1 | Meaning |
|---|---|
| 0 | Success |
| 1 | PassKey verification failed |
| 2 | Invalid scalar argument |
| 3 | Invalid target or initializer |
| 4 | Resource unavailable |
| 5 | Unsupported operation |

These numbers are the approved software return convention, not hardware fault
numbers. They do not authorize replacing existing HARDFAULT paths with returns
or implementing conversion semantics. Unknown nonzero status is failure.
Compiler errors remain compile errors, not runtime status results.

## Approved output safety rule

On a normal error return, CR1 is NULL. On successful no-capability-result
methods, CR1 is also NULL. Successful capability-returning methods replace the
input PassKey with the result. Caller code must check DR1 before consuming it.
Do not zero unspecified inputs as a precondition. Register preservation and
RETURN masks must be checked against actual CALL/RETURN behavior; ABI metadata
alone neither clears registers nor validates an implementation.

## Implementation and acceptance boundary

After review, specify the exact serialized record layout, canonical ordering,
accepted type combinations, and compiler syntax for method signatures.
Do not implement a guessed binary layout from this proposal alone.
Then update encoder, decoder, compiler and admission readers together, with
exact-byte fixtures and negative tests. The focused existing baseline is
necessary but is not new-ABI acceptance.

No BIT changes, RTL runs, live provisioning, hardware work, conversion
implementation, or one-time PassKey behavior is authorized by this proposal.

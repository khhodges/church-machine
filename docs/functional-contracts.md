# Authoring public functional contracts

Functional contracts describe a method for callers without requiring them to
read its implementation. They are embedded in the canonical LUMP API, including
API-only exports. They do not generate instructions, change argument encoding,
grant authority, or prove that the implementation satisfies the description.

## Source syntax

Add explicit semicolon-comment directives to CLOOMC or supported native assembly:

```text
; @contract Inspect
; {
;   "purpose": "Read a stored value without modifying it.",
;   "inputs": {
;     "offset": {
;       "meaning": "Position of the value to read.",
;       "unit": "32-bit words.",
;       "allowed": "A valid offset within the object's extent.",
;       "encoding": "Supply the word offset directly."
;     }
;   },
;   "result": "Returns the value in DR2; DR1=0 indicates success.",
;   "effects": "No storage is modified.",
;   "failures": "Invalid access faults; there is no successful result.",
;   "authorization": "The implementation's required capability and proof must be supplied.",
;   "example": "For the first word, supply offset=0."
; }
; @endcontract
```

This is a syntax example, not a supplied Inspect implementation or authority grant.
The method must actually exist and declare an input named `offset`.

Required method fields: `purpose`, `inputs`, `result`, `effects`, `failures`,
`authorization`, and `example`. Each input requires `meaning`, `unit`, `allowed`,
and `encoding`. Use explicit text such as “not applicable” where appropriate;
do not omit a field or invent a default. `inputs` is `{}` for a no-input method.
Descriptions are plain text, not HTML.

The compiler checks:

- Once one contract is present, every public method must have exactly one.
- Method and input names must match the declared interface exactly.
- Required text must be nonempty, with at most 4,096 characters per field.
- Unknown fields, duplicate JSON keys, malformed JSON, orphaned terminators,
  and unterminated blocks are rejected.
- The total API payload remains subject to the existing frame-size limit.

The compiler does not infer contracts from ordinary comments or method bodies.
Historical and unannotated source still compiles, but the API view explicitly
reports that it has no embedded functional contract.

## Stored representation and display

The canonical API has an optional `contracts` object keyed by public method name.
Its complete contents are integrity-covered with the rest of the embedded API.
Readers validate and retain it; mechanical register views preserve it.
The Public API view shows the functional descriptions before the ABI JSON.
No source, sidecar, or catalog fallback supplies missing contracts.

This is a descriptive contract, not an executable precondition language.
Code review and execution tests remain necessary to verify its claims.

## CALL help in the editor

Pause while typing a CALL statement, or hover over its line, to inspect a saved
method contract. Choose the exact saved LUMP in the popup; its filename and
SHA-256 are shown with the contract. When the editor already has an exact saved
receipt for the named target, that receipt is used, including historical revisions.
The popup never substitutes the newest revision.

Named dot calls identify the method directly. For register or C-list calls the
programmer must select the target artifact: help does not infer register authority
or resolve a petname to an abstraction. Numeric selectors are matched only when
explicitly declared by the saved API. Missing methods, APIs, and contracts are
reported explicitly. The popup does not edit source, select an execution target,
change grants, or change the saved Public API view.

## Mint Phase 1

`mint_v4_functional_contracts (draft)` is a separate annotated copy of the
reviewed Phase 1 candidate. It explains allocation units/encoding, read/write-only
permissions, zero initialization, release/reuse, faults, unsupported conversions,
and deferred PassKey verification until the Phase 2 bitstream.

Saved Mint v4 remains unchanged. Adding contracts changes artifact identity and
storage size even though instruction words, selectors, and the calling ABI stay
the same. Review and save a new revision explicitly to distribute the contracts.

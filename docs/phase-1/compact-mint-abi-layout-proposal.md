# Compact ABI layout and signatures — approved

Status: layout, signature grammar and scalar-result placement approved by the
user on 2026-10-31. Not implemented. Mint's concrete method signatures still
require review against the selected executable implementation.

## Storage

Keep the existing embedded API frame, UTF-8 JSON payload, and optional source
framing. Do not create a second API section or change instruction/GT encodings.
New API root fields, in canonical order:

1. `name`: canonical abstraction name.
2. `passkey`: integer 1, mandatory. No other value or absence is accepted.
3. `methods`: name-keyed object, as today, with new tuple values below.
4. `imports`: existing compact import contract, omitted when empty.
5. `symbolic_binding`: existing portable binding contract, when required.

No convention selector, legacy fallback or per-method PassKey repetition.
Old APIs remain available for historical inspection, but cannot be admitted
as this new ABI. Inspection must not silently upgrade or execute old records.

## Method tuples

Each named method maps to `[selector, inputs, result]`.

- Selector: integer public index 0–126; encoded CALL selector is index + 1.
- Inputs: ordered array of descriptors. Preserve authored order.
- Result: type descriptor, or integer 0 for no result.
- Every field is mandatory, including an empty inputs array and result 0.
- Selectors must be unique and match real public method-table entries.
  Names are sorted lexicographically for serialization; never derive selectors
  from sorted names. Private methods are not exported.

Input descriptors:

- Scalar: `["name",1]`.
- Exact capability type: `["name",type,rights]` where type is 2, 3 or 4.
- Object union: `["name",5,rights,[acceptedTypes]]`; acceptedTypes is a
  nonempty, unique, ascending subset of [2,3,4].

Result descriptors:

- No result: `0`.
- Scalar: `1`.
- Exact capability: `[type,rights]`.
- Object union: `[5,rights,[acceptedTypes]]`.

Rights are canonical strings under existing permission-family rules, including
the explicit empty string. No default grants and no permission-family mixing.
An Object union does not override any runtime type restrictions.

At most one capability input is supported in this initial Mint-targeted
contract: it occupies CR2. More capability inputs are compile errors, not
silently assigned registers. Scalar inputs, in their relative authored order,
occupy DR2 through DR15 (maximum 14). PassKey occupies CR1 implicitly.

Proposed scalar result location: DR2, because DR1 is always status. A scalar
result is not a capability result, so CR1 must be NULL on successful return.
Capability results occupy CR1. On any nonzero DR1, callers must ignore results.
This defines no promise to zero DR2 on failure.

## Signature syntax

Structured source:

```
abstraction test.Example {
    passkey required;
    method Inspect(target: Inform[R], offset: U32) -> U32 {
        // Implementation must satisfy the declared contract.
    }
}
```

This is illustrative syntax, not a working method or an approved Mint grant.
Serialized method entry: `"Inspect":[0,[["target",2,"R"],["offset",1]],1]`.

Type spellings: `Void`, `U32`, `Inform[rights]`, `Outform[rights]`,
`Abstract[rights]`, and `Object[Inform|Outform|Abstract;rights]`.
The Object list names only the accepted forms; omissions are meaningful.
Use `[]` for explicitly empty rights on an exact capability type.
Void is allowed only as a return type. Parameter names are unique identifiers.

Native assembly keeps the existing explicit method declaration/body grammar.
Add one signature directive per public method, before that method:

```
@passkey required
@signature Inspect(target: Inform[R], offset: U32) -> U32
```

Signatures declare, but never create, methods. Missing, duplicate, mismatched,
or orphaned signatures fail compilation. No annotations inferred from comments.
Structured methods use their typed declaration as the single signature source;
do not permit a competing @signature for the same structured method.

## Exact serialization and rejection

Emit compact JSON without whitespace or a trailing newline, encoded as UTF-8.
Use JSON string escaping; source identifiers remain under existing identifier
constraints. Root key order is specified above; method keys are sorted by
ordinal character order; descriptor arrays preserve their prescribed order.
Keep existing canonicalization of imports and symbolic_binding.

Reject duplicate JSON object keys before normal object parsing loses them.
Reject unknown root fields, tuple tails, tags, malformed rights/form sets,
fractional selectors, duplicates, and register-count overflow. Require
canonical reserialization to match the embedded payload bytes. Existing frame
padding is outside that payload. Validate method-table bounds and actual
entries independently of this structural validation.

## Next implementation gate

The layout review is complete. Before changing codec, compiler, admission or
browser readers, settle Mint's exact typed signatures against the selected implementation,
particularly CREATE's initializer/result types and scalar argument list.
Do not infer them from legacy fixtures or broaden grants to make a test pass.
Implement all readers/writers together and test exact bytes, negative inputs,
source retention, and real return behavior. Metadata is not enforcement.

No conversion implementation, one-time PassKey semantics, RTL replay, live
installation or BIT changes are authorized by this draft.

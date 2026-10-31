# Mint CREATE: readable caller syntax

Status: syntax and explicit encoding rules approved by the user, design only,
on 2026-10-31. Implementation requires separate authorization.
This is a design only. No compiler, ABI, saved v4, binding, RTL, BIT, or
historical-artifact change is authorized or performed by this document.

Implementation authorization was separately granted on 2026-10-31. The compiler
now supports the opt-in form below in structured native method bodies. The
original design approval above remains design-only; the later authorization
covers compiler lowering and isolated tests, not saved artifacts, live bindings,
RTL or BIT changes. Run `npm run test:mint-readable-calls` for focused acceptance.
The compiler-owned version 1 record is fixed, not a caller-editable JSON input;
its strict validator rejects duplicate keys and any deviation from that record.
The existing selected-binary API snapshot supplies either the canonical tuple
or its lossless typed inspection projection; contract prose is never consulted.

## Programmer-facing form

```text
CALL ide.Mint.CREATE(words: 8, rights: RW);
```

Propose this form in structured CLOOMC native instruction bodies. The target
must resolve to the caller's declared C-list import for the selected Mint.
It is a statement, not an expression returning a host-language value.
`words` means 32-bit words; 8 words means 32 bytes. `RW` explicitly requests
read/write DATA. Zero initialization is the only creation mode in this slice.
There is no initializer, object-kind argument, byte-size shortcut or default
rights. The actual callee remains CREATE, not a new Mint method.

Initial grammar is deliberately bounded:

- Case-sensitive `CALL`, `CREATE`, `words`, `rights`, and `RW`.
- Exactly the two named arguments shown, in that order, followed by `;`.
- Size is a decimal integer literal, not an expression, register or variable.
- No positional/named mixing, duplicate arguments, implicit rounding or casts.
- Other sizes/rights/forms fail compilation; never silently emit raw WORD data.

This restriction makes every new argument check a compile-time check. Dynamic
sizes require a separate proposal defining validation and failure semantics;
this proposal does not invent synthetic return statuses or new hard faults.

## Explicit encoding rule record

The following JSON is the proposed closed, versioned compiler rule record.
It is not an addition to the embedded API schema and is not currently consumed.
There is no expression evaluator, executable documentation or inferred rule.

```json
{
  "schema": "mint-create-call",
  "version": 1,
  "syntax": "named-literal-statement",
  "method": "CREATE",
  "expectedTuple": [0, [["allocation", 1], ["permissions", 1]], [2, "RW"]],
  "inputs": {
    "words": {
      "kind": "decimal-u32-literal",
      "minimum": 8,
      "maximum": 2147483648,
      "powerOfTwo": true,
      "unit": "word32"
    },
    "rights": {
      "kind": "enum",
      "values": {"RW": 3}
    }
  },
  "outputs": {
    "allocation": {"input": "words", "operation": "u32-or", "constant": 4},
    "permissions": {"input": "rights", "operation": "enum-value"}
  }
}
```

The maximum is an **encoding bound**, not a promise that Mint can allocate
that size. It is the largest power of two representable as U32. Descriptor
limits, available pool space and Namespace slots remain service checks.

Proposed rule semantics:

1. Parse the decimal literal exactly before any JavaScript bitwise coercion.
   Reject negative, fractional, oversized and non-power-of-two values.
   Require `words >= 8`; thus its low three bits are zero.
2. Map only the exact token `RW` to unsigned integer 3.
3. Compute `allocation = unsigned32(words OR 4)` without truncating input.
   Set `permissions = 3`. Never interpret rights strings as capability grants.
4. Require the exact method tuple above and abstraction-level `passkey: 1`
   from the selected canonical imported API. Resolve its declared C-list row
   through existing import/binding checks; never guess a row from a display name.
5. Materialize allocation in DR2 and permissions in DR3 using supported
   instruction encodings. Issue ordinary CALL via CR6 at that row, public
   selector 0 / wire selector 1. Never use retired ELOADCALL or load the target
   through CR0. Preserve CR1 while preparing arguments.
6. Missing/mismatched APIs, unbound imports, unsupported rule versions,
   unknown rule fields/operations, malformed records and duplicate JSON keys
   are errors, not fallback requests. No arbitrary expressions in rule records.

The record belongs to an explicitly enabled compiler adapter, not
`contracts.CREATE.inputs.allocation.encoding`. Future implementation must
validate it against a closed schema and test exact lowering. A matching tuple
alone does not prove that an arbitrary method implements Mint semantics:
the programmer must explicitly select the Mint adapter for the exact imported
artifact. No automatic activation by name, documentation text or catalog lookup.
Proposed activation is a caller-source declaration:

```text
call_adapter ide.Mint.CREATE = mint_create_words_v1;
```

Here `ide.Mint` must be the same declared import as the CALL target. This
declaration is compiler configuration, not a public method, ABI field, proof,
binding or authority grant. Missing activation makes the new syntax an error.
The adapter ID selects exactly the record above; it cannot resolve executable
behavior from a sidecar or free-text contract.

## ABI and runtime behavior remain unchanged

The approved ABI stays
`CREATE(allocation: U32, permissions: U32) -> Inform[RW]`.
CR1 is still the PassKey input and capability-result register. Phase 1 Mint
ignores the PassKey; this syntax must not claim authentication. CR2 is unused
in this slice. On a normal return, callers check DR1: zero means success with
the Inform RW capability in CR1; nonzero means failure with NULL CR1.
Existing service hard faults remain hard faults, without a rollback guarantee.
No new status, privilege, preservation promise or allocator behavior is added.

Existing explicit low-level argument setup remains available and unchanged.
Saved artifacts are never upgraded or rewritten to add this syntax.
Caller source must be explicitly edited and recompiled if implementation is
later approved. Functional contracts stay descriptive and integrity-covered
under their existing rules, with no change to their schema.

## Required isolated implementation acceptance, after separate approval

| Source words / rights | Required result |
|---|---|
| 8 / RW | DR2 = 12, DR3 = 3 |
| 16 / RW | DR2 = 20, DR3 = 3 |
| 1024 / RW | DR2 = 1028, DR3 = 3 |
| 2147483648 / RW | DR2 = 2147483652 unsigned; no allocation-success claim |
| 0, 1, 4, 12, -8, 8.5, 4294967296 | Compile error |
| variable or expression size | Compile error in this initial slice |
| R, W, X, LS, numeric 3, or omitted rights | Compile error |

Also require grammar/adapter/import mismatch rejection, exact emitted-word
comparison against equivalent manual setup and ordinary CALL, CR1 preservation,
selector/row correctness, unchanged low-level compilation, and proof that edits
to contract prose cannot change generated instructions. Test large constants
against real instruction immediate limits rather than assuming a single move.
These are compiler acceptance tests, not Mint lifecycle or hardware acceptance.

## Source review and decision boundary

- `docs/functional-contracts.md`: documentation explicitly cannot generate code.
- `docs/phase-1/compact-mint-abi-proposal.md`: approved conventions; its earlier
  initializer discussion is narrowed by the concrete signature review.
- `docs/phase-1/compact-mint-abi-layout-proposal.md`: typed scalar placement,
  compact tuple structure and strict schema.
- `docs/phase-1/mint-abi-signature-review.md`: settled zero-initialized DATA RW
  slice, unchanged packed scalars and exact CREATE tuple.
- `scripts/create_mint_contract_draft.js`: describes packing in plain text;
  it is not a source of compiler rules.
- `simulator/drafts/mint_v4_integrated.cloomc`: checks tag 4, mask 3 and
  power-of-two size after clearing low bits; Phase 1 ignores PassKey.
- `simulator/cloomc_compiler.js`: typed signatures are metadata; the older
  capability-call expression path explicitly rejects retired ELOADCALL.
  This proposal therefore needs a new ordinary-CALL lowering path, not
  re-enabling that expression path.

Approval recorded: both the explicit adapter/call syntax and this closed
encoding record, including literal-only scope. The user selected “Approve
design only.” Design approval does not itself
authorize implementation, publication, live bindings, RTL or hardware work.

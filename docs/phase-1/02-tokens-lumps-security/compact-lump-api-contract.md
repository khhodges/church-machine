# Single canonical LUMP API — step-one contract

Status: supported code compilation, publication and inspection use this format.
Destination linking / bitstream cutover remains pending; decoding a definition
does not prove its references are bound. Existing binaries are untouched.

## One definition

The same JSON is embedded, displayed and consumed by foreign IDEs and the linking
loader. There is no second public projection or supplementary linker definition.
Code, header and C-list are the other parts of the same Build & Test LUMP.
The loader may consult the destination Namespace and its actual target objects;
source, a Full master, sidecars and catalogs cannot fill missing declarations.

This contract is for code LUMPs with a compiler-owned SELF at C-list row zero.
It does not redefine Namespace or Thread binary layouts.

## Approved WCH example

```json
{
  "name": "WukongCallHome",
  "methods": {"Run": {"selector": 0, "returns": "DR1"}},
  "imports": {"RW": {"1": "kjhh1.LED0", "2": "kjhh1.UART_TX"}}
}
```

The compact UTF-8 representation is 130 bytes, rounded to 132 for word alignment.
With 75 code words, three C-list words and two framing words, used space is
452 bytes. A 128-word/512-byte allocation leaves 60 bytes free.

## Field rules

- `name`: the abstraction name, defined once.
- `methods`: object keyed by public method name. An empty object explicitly
  declares no public methods; a missing object is an error, not an inference.
- `selector`: zero-based method selector, not a branch offset. Selectors remain
  unchanged when private methods are omitted and may have gaps. The selector
  must address the code extent. Actual dispatch-word validation remains a binary
  validation obligation; JSON validation alone does not prove executable code.
- `inputs`, when present: parameter-name → register specification.
  A data parameter uses `"count":"DR1"`. A capability parameter uses
  `"reader":{"register":"CR1","type":"Inform","rights":"R"}`.
  Omitted inputs mean no declared arguments. Empty input maps are noncanonical.
- `returns`: a single data register, or a name-keyed parameter map for multiple
  results / capability results. Omitted returns mean no declared result, never
  an implicit DR1 fallback.
- `imports`: permission-set → C-list-row → target. Permission letters are unique
  and ordered `RWX` or `LSE`; mixed families are invalid. The group applies its
  rights independently to every listed row. Equivalent rights/grants fields
  are not duplicated.
  An empty permission-set key (`""`) explicitly requests zero permission bits;
  this preserves the existing Thread declarations in CapabilityTest and must
  never be replaced with a default grant.
- Rows use canonical decimal keys, starting at 1. Every non-SELF row must have
  exactly one declaration. Row zero is implicit SELF, not another named import.
- A short string target is a qualified destination **leaf** symbol, as in WCH.
  It is not permission to resolve an arbitrary issued LUMP without identity
  locks, invent a missing leaf, or consult the compiling IDE's private settings.
- An issued-LUMP target instead has exactly `name` (qualified name#issue), `T`,
  `binary_hash`, `identity_hash`, and `type`. The two hashes retain the existing
  distinct identity and exact-byte checks; they are not redundant copies of
  the same fact. Valid types are Inform, Outform, Abstract.
- Each target is defined once. Additional rows referring to the same target
  use its defining row number as a JSON integer. References carry the referring
  row's own declared rights, not inherited permission. Missing and cyclic
  references are errors. These small integers are row references, never GTs.
- Unknown fields, duplicate JSON keys (including escaped equivalent keys),
  duplicate target definitions, repeated selectors, duplicate rows and malformed
  bounds fail explicitly.

Names in different scopes (method, parameter, target) identify different things;
coincidentally equal strings do not justify merging their authority or meaning.
The binary supplies code/C-list sizes, allocation and framing. None is repeated
in JSON. Source language, method body offsets, source, destination slots,
destination generations and materialized GTs are not API fields.

## Framing and deterministic representation

Retain the existing four-byte `0xAB` content-frame header immediately following
code: marker byte, flags byte, two-byte UTF-8 JSON length. API-only flags are zero.
For the WCH example it is `0xAB000082`. The separate LUMP header remains four
bytes. There is no source-length word in API-only form.

The standalone serializer sorts object keys and emits JSON without whitespace;
word padding is outside the JSON byte length. Formatting/order do not change
the definition. Duplicate keys are always rejected, not normalized away.
The new object-valued `methods` contract is distinguishable from legacy
array-valued APIs; this validator rejects the legacy form. Adoption must not
introduce a runtime fallback to old declarations.

## Binding obligations and scope gates

Successful structural validation is **not** admission, binding or execution
approval. The loader must still verify target identity/bytes, type, requested
rights, destination ownership/authorization, bounds, generation and availability,
then write GTs only into the approved destination copy. It must reject a short
leaf name resolving to a target that requires an issued-LUMP lock. No grants may
be inferred from the group names or copied from a different Namespace.

Special runtime-created/private-storage capability rows do not yet have an
approved compact representation in this step. The validator rejects null or
partial target records; future producers must fail explicitly on unsupported
bindings rather than discard existing declarations. Extend and test the single
contract before enabling those LUMPs in the later cutover.

Old artifacts need **source recovery only**: load the exact unchanged source
from that revision's Full master into the editor. Never substitute latest source
or reconstruct comments from Compact. A missing original source is an explicit
error. Preserve history; recompilation creates new revisions with normal approval.

## Verification

Run `node simulator/test_lump_api_contract.js` and
`node simulator/test_lump_api_codec.js`. The contract is shared by the compiler
and browser. Server inspection invokes the same decoder without consulting
source, catalogs or IDE leaf definitions.

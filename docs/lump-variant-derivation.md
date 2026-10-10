# Three-variant Save: derivation, not independent editing

The canonical editing input is the exact full source accepted by the compiler.
The compiler record binds its source hash and primary artifact. Save generates
the API-only, compact-source and full-source representations server-side from
that accepted result; it does not accept three independently editable binaries.

The variants share one content-addressed bundle identity. Each binary retains
its own hash. A common revision identity is not a claim that the binaries are
byte-identical. The primary approved binary remains the build/test authority;
source companions do not independently acquire deployment approval.

Full source for editor reload is selected through the exact revision's bundle.
Do not resolve it by abstraction name, by latest revision, or solely by primary
binary hash: comment-only changes can produce identical API-only artifacts.
Companion publication participates in the primary's rollback transaction.

## Limits of the guarantee

- Packaging checks identical executable words, C-List words and API content.
  It does not independently prove that compiler-generated API semantics are
  correct. The DR0 return-register defect was a compiler metadata default;
  derivation alone would have reproduced that bug consistently in all variants.
- Compact source cannot reproduce removed comments and therefore cannot have
  the same exact-source hash as the canonical full source.
- Compact-source rebuild equivalence remains unverified. Before treating it as
  a reproducible build input, compile it under the same compiler and dependency
  identities and compare executable words, C-List and normalized API. Fail
  explicitly on mismatch; do not claim the full-source seal was reproduced.
- IDX1 still requires source-bearing executable admission. Its API-only
  admission restriction must not be bypassed merely to match a storage default.

## Verification so far

Private tests cover compile → reviewed plan → confirmed save, three retained
profiles, hash/source rejection, exact source lookup and rollback on an injected
bundle-publication failure. Browser verification covers the Save dialog and
cancellation, not a live catalog publication.

The broader legacy save-endpoint suite is not green (64 failures, 9 passes in
the current workspace), including permission-definition and outdated save-path
expectations. It is not evidence that all save paths have passed regression.

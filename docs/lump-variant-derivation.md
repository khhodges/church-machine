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
- New variant saves require two uncached rebuilds (full and canonical compact)
  with the compiler fingerprint and frozen resolved dependency inputs carried
  in the signed compile record. A compiler change, missing context, compile
  failure, or executable/C-List/API difference rejects the save. Older records
  must be recompiled; historical bundles are not rewritten.
- API comparison ignores JSON object-key ordering only. Method order, selectors,
  visibility, parameters, return conventions and dependency identities remain
  significant. Assembly abstraction declarations are retained even though
  their syntax resembles a comment. Language-specific comments are removed
  without stripping quoted comment markers or CLOOMC statement semicolons.
- Bundle schema 2 binds rebuild evidence into the exact bundle identity:
  distinct full/compact source hashes, both rebuild binary hashes, compiler
  and frozen-input hashes, and a semantic digest. Rebuild binaries use the same
  API-only packaging for comparison; they are not the approved primary or its
  source-bearing companions. No compact text reproduces the full-source seal.
- Unsupported source/session combinations fail explicitly (for example,
  standalone symbolic input without its required compile session). Equality
  between rebuilds is not independent proof of compiler correctness.
- IDX1 API-only reload requires the exact revision's retained full-source bundle
  and signed compiler source hash. The server recompiles that source and checks
  saved code and typed layout; the browser also validates the exact execution
  envelope and source hash before protected admission. Missing or mismatched
  companions cannot fall back to a sidecar or latest editor source.

## Verification so far

Private tests cover compile → reviewed plan → confirmed save, three retained
profiles, hash/source rejection, exact source lookup and rollback on an injected
bundle-publication failure. Browser verification covers the Save dialog and
cancellation, not a live catalog publication.

The broader legacy save-endpoint suite is not green (64 failures, 9 passes in
the current workspace), including permission-definition and outdated save-path
expectations. It is not evidence that all save paths have passed regression.

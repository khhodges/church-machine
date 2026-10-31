# Isolated Mint stub LUMP

## Review correction: this is not the existing CREATE prototype

The stub deliberately returns unsupported and has no PkVerify import. It must
not stand in for the real implementation when judging the compiler upgrade.
`node scripts/build_mint_prototype_review.js` now packages the actual unchanged
Mint, PkVerify, and MintCleaner sources and their compiled LUMPs in
`generated-artifacts/mint-prototype-review/`. Their original API and exact
source are embedded. `review.json` records hashes, dependencies and ABI gaps.

This is an unlinked review package, not a port or a runnable installed service.
PkVerify currently receives the proof in CR2 and trusted reference in CR3,
and returns 1 for approval; Mint's old CREATE similarly uses success=1.
The approved new ABI uses CR1 proof and zero success. Copying the old body
under a new signature would clear the incoming PassKey and misreport status.
The existing authorization fixture reaches an intentionally exhausted allocator;
passing it is not successful RW allocation/zeroization/result issuance.

Remaining integration work is explicitly recorded in the review report.
Neither old-ABI prototypes nor new-ABI stubs establish new-ABI CREATE acceptance.

Build: `node scripts/build_mint_stub_lump.js`

Test: `node simulator/test_mint_stub_lump.js`

Output: `generated-artifacts/mint-stub/ide.Mint.stub.lump`, with a standalone
ABI JSON, embedded full source, and a SHA-256 build report.

Public selectors remain CREATE=0, DESTROY=1, MakeOutform=2, MakeInform=3.
All four bodies discard CR1, return DR1=5 (unsupported), and use the
architectural CALL-frame return with no retained result capability.
They cannot allocate, destroy or convert objects and do not validate PassKeys.
The abstraction-wide ABI flag declares the requirement for future operation;
unconditional denial does not constitute successful authorization.

This scaffold uses the first DATA RW slice's concrete types, including
Inform RW / Outform RW conversion signatures. It does not assert support for
E/L/LS conversions or broader object types. No operation is implemented.

The compiler parses the typed method signatures and abstraction-level
`passkey required;` declaration in mint_stub.cloomc, generating compactAbi.
The separate JSON file is a golden test fixture, not build authority. Native
instruction bodies are supported; higher-level typed expressions, imports,
private methods and assembly @signature directives remain outside this slice.
They must not be mistaken for implemented general ABI support.
Ordinary legacy API generation rejects typed results rather than dropping
their ABI. The isolated builder embeds the compiler-generated API.
This is NOT new-ABI support in the IDE's general admission pipeline.
The artifact is structurally packed
and tested locally; it is not signed, admitted, installed or published.
Do not overwrite the current Mint or promote this scaffold as an operational
service. Its filename deliberately distinguishes it from canonical saved
revisions. General-purpose ABI migration remains separate work.

Tests extract the ABI and exact source from the produced binary and exercise
all four compiled dispatches with the real simulator CALL/RETURN path.
The simulator fixture localizes code and SELF in disposable RAM; it is not
physical hardware acceptance or an exact-image admission test.

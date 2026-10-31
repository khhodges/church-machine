# Isolated Mint stub LUMP

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

The existing native-method compiler compiles the bodies. A separate explicit
ABI manifest is embedded by the isolated builder using the approved tuple
layout. This is NOT implementation of typed-source parsing or new-ABI support
in the IDE's general admission pipeline. The artifact is structurally packed
and tested locally; it is not signed, admitted, installed or published.
Do not overwrite the current Mint or promote this scaffold as an operational
service. Its filename deliberately distinguishes it from canonical saved
revisions. General-purpose ABI migration remains separate work.

Tests extract the ABI and exact source from the produced binary and exercise
all four compiled dispatches with the real simulator CALL/RETURN path.
The simulator fixture localizes code and SELF in disposable RAM; it is not
physical hardware acceptance or an exact-image admission test.

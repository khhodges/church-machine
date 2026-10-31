# Mint v4 integrated candidate

Open **mint_v4_integrated (draft)** in the IDE's Open File picker.

This is a compilable source candidate, **not saved Mint revision 4**.
The exact source and provenance are retained separately from immutable LUMPs.

## Included

**Phase 1 exception:** The PassKey declaration and CR1 ABI remain unchanged,
but Mint ignores the input until the Phase 2 bitstream. No proof/reference
loads or PkVerify calls execute in this candidate. Tests enter with NULL CR1
and separately confirm that an unrelated input value is ignored, not verified.
The verifier and reference import rows remain declared but unused.
The PassKey-enabled source is preserved separately as `mint_v4_phase2.cloomc`;
it is not approved for Phase 1 execution. Callable-capability authority and
the existing operational checks remain, without additional PassKey approval.

- The newer paired Cleaner-managed CREATE/DESTROY implementation, as approved
  for lifecycle consistency instead of mixing v3's older allocator with newer DESTROY.
- Proposed MakeOutform and MakeInform stubs: NULL CR1, status 5, normal return.
- Approved typed method signatures and the abstraction-wide PassKey declaration.
- The additional MintCleaner and MintApproval imports required by newer DESTROY.

CREATE and DESTROY are not denial stubs. Their entry/return code uses the
approved ABI; DESTROY derives the target slot through exact native comparison
with live Namespace identities. The original implementation files remain unchanged.
The companion `pkverify_v4.cloomc` declares `ide.MintV4Verifier` and uses CR1 proof, Mint-supplied trusted CR3 reference,
native EXACT, and zero-success status. Do not bind Mint v4 to the older verifier.
The distinct verifier identity prevents a name-only binding from selecting the
older CR2-proof verifier. The original PkVerify artifact is not renamed or changed.
MintCleaner retains its internal contract, interpreted only inside Mint.

## Verification and remaining acceptance

- Typed imports, method-table correspondence, API encoding/decoding, invalid
  descriptors and the ordinary compiler/builder path have focused checks.
- An isolated server test exercises normal compile, finalization, reviewed save
  and exact-source reopening without assigning a Namespace slot.
- Seven isolated ChurchCore checks pass for Phase 1: CREATE/DESTROY/reuse,
  exhaustion, stale-target rejection, both conversion stubs (status 5 and
  NULL CR1), ignored PassKey input, and the unchanged Abstract-load fault boundary.
- These are compiled-instruction tests in privately provisioned memory, not
  physical-board or installed-image acceptance. Wrong-proof authentication
  testing is deferred because Phase 1 deliberately performs no authentication.
- The Phase 2 candidate remains blocked by the Abstract C-list LOAD fault.
- No release or physical acceptance is claimed by compiler/save checks.

The typed-import rejection was replaced with structural validation using the
existing import contract and shared decoder, not a permissive bypass.
No v3 bytes, Namespace selection, owned browser
draft, saved revision, boot image or hardware was changed by assembling this draft.

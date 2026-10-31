# Mint v4 integrated candidate

Open **mint_v4_integrated (draft)** in the IDE's Open File picker.

This is a compilable source candidate, **not saved Mint revision 4**.
The exact source and provenance are retained separately from immutable LUMPs.

## Included

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
- The isolated ChurchCore simulation was run with explicit simulation-only
  approval. Both conversion stubs passed: DR1=5 and NULL CR1.
- CREATE/DESTROY/reuse, wrong-proof, exhaustion, and stale-target acceptance
  remain blocked. Each stops at the caller's Abstract PassKey C-list LOAD,
  before Mint entry, with INVALID_OP (0x0B). The current mLoad Abstract branch
  explicitly rejects that operation; no runtime or RTL bypass was introduced.
- A separate boundary test confirms that pre-entry fault. Its passing result
  is evidence of the blocker, not evidence that Mint rejects invalid requests.
- Final core test result: three passed (two stubs and the boundary check),
  four failed (the lifecycle acceptance cases). The candidate is not runtime-qualified.
- No release or physical acceptance is claimed by compiler/save checks.

The typed-import rejection was replaced with structural validation using the
existing import contract and shared decoder, not a permissive bypass.
No v3 bytes, Namespace selection, owned browser
draft, saved revision, boot image or hardware was changed by assembling this draft.

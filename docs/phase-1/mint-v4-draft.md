# Mint v4 integrated source-review draft

Open **mint_v4_integrated (draft)** in the IDE's Open File picker.

This is a source draft, **not saved Mint revision 4** and not a runnable ABI port.
The exact source and provenance are retained separately from immutable LUMPs.

## Included

- CREATE from saved Mint v3, `ide.Mint.1.3229a560.lump`, resolved through its
  exact full-source sibling.
- The newer editable DESTROY implementation, as explicitly selected for this draft.
- Proposed MakeOutform and MakeInform stubs: NULL CR1, status 5, normal return.
- Approved typed method signatures and the abstraction-wide PassKey declaration.
- The additional MintCleaner and MintApproval imports required by newer DESTROY.

The CREATE and DESTROY bodies are preserved, not replaced with denial stubs.
Their signatures describe the target ABI; **their bodies still use the older ABI**.
The current compiler rejects typed imports, so this draft cannot accidentally
be treated as a completed ABI migration.

## Remaining integration work

1. Preserve and verify the incoming CR1 PassKey before any result-register clear.
   Port PkVerify and its call sites together; use Mint's trusted approval reference.
2. DESTROY must take its target in CR2 and derive the Namespace slot from that
   verified capability, not trust an ordinary caller slot argument.
3. Translate successful CREATE/DESTROY completion to DR1=0. Keep existing
   failure checks; unused inputs must not be treated as authority preconditions.
4. Reconcile v3 CREATE's older allocation scheme with the Cleaner-managed
   ownership, zeroization and release checks used by newer DESTROY.
5. Implement typed-import compilation without dropping the compact ABI, then
   verify exact-source/API round-trip and real allocation/destruction.

No compiler guard was loosened. No v3 bytes, Namespace selection, owned browser
draft, saved revision, boot image or hardware was changed by assembling this draft.

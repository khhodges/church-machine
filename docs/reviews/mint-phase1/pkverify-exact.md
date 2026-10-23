# Mint Passkey authorization — isolated simulator evidence

## Contract

Genesis runs `Passkey.NewProof` and provisions the resulting B=0 Abstract GT
into approved callers' C-lists and Mint's `ide.MintApproval` row (row 7).
This is trusted provisioning, not a public lookup or a grant made by PkVerify.
Mint receives the caller's token in CR2, replaces CR3 with its own reference,
and calls its own PkVerify capability. PkVerify returns DR1=1 only when native
`TPERM CR2, EXACT, CR3` matches. Either NULL operand returns zero.

No readable proof object, proof payload, added ISA instruction or external
authorization service is involved. The reference must be the actual issued
B=0 Abstract token; a misprovisioned reference is not approval evidence.
Mint's outward RETURN masks still remove the proof/reference. Verification
preserves CR4/CR7/CR8 because later operation checks must inspect the original
inputs, not NULLs accidentally introduced by the verification call.

CREATE authorizes before allocator access. DESTROY authorizes before target,
Namespace, private-state or Cleaner access. MakeOutform/MakeInform remain
explicitly unimplemented hard faults and cannot perform protected operations.
Authorization alone never reports successful completion of a Mint operation.

## Repeatable checks

```sh
node simulator/test_mint_phase1_api_draft.js
node simulator/test_constants_passkey.js
node simulator/test_mint_create_publication.js
```

The first command includes the PkVerify CALL/RETURN checks and
`test_mint_pkverify_call.js`. The latter compiles the **complete** Passkey,
PkVerify and Mint sources, executes Passkey issuance twice, provisions those
issued values into isolated RAM, and runs complete compiled callers.
No service body is extracted or replaced, no instruction is intercepted, and
no simulator permission or Namespace addressing rule is changed.

Covered cases: matching issued token, independently issued wrong token,
single-bit mismatch, NULL caller, absent reference binding, and a caller
supplying two equal but unauthorized tokens. Protected state and proof
catalogue remain unchanged. A separate case confirms DESTROY still sees its
target after verification. Direct PkVerify tests also cover a NULL reference
and preservation of operation inputs.

Authorized CREATE reaches its real allocator and naturally rejects an
intentionally exhausted free-slot list. Authorized DESTROY reaches its normal
target checks. These are authorization demonstrations, **not successful
allocation/lifecycle demonstrations**. The legacy JavaScript simulator's
word-addressed Namespace is not the byte-addressed native CREATE model.

## Hardware boundary

No live bindings, saved LUMPs, boot images, FPGA implementation or board were
changed. Existing RTL lifecycle fixtures still use the old credential/proof
convention and do not provision the new reference.

A diagnostic replay temporarily provisioned the approved Abstract token in the
RTL fixture's caller and Mint reference. Running
`python -m pytest tests/hardware/test_mint_destroy_core.py tests/hardware/test_mint_create_core.py -q`
gave 17 failures and 4 passes; the lifecycle caller faulted at its proof LOAD
(fault 11, byte PC 8200), before PkVerify. Those temporary fixture changes were
removed. This is not hardware acceptance, and no runtime bypass or new encoding
was added to make it pass. RTL Abstract-proof loading and updated lifecycle
provisioning require a separately approved follow-up.

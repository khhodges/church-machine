# Phase 1 CLOOMC source drafts

Review-only translation of [the design/code draft](../MINT-CODE-DRAFT.md).
Requested source drafting does not approve unresolved contracts.

| File | Role |
|---|---|
| `ide.Mint.cloomc` | Proposed Create, Replace and ForgePassKey method structure |
| `ns-slot-lambda.cloomc` | Mint's same-scope, single-slot LAMBDA body fragment; not another LUMP |
| `pkverify.cloomc` | Proposed Verify method with real GT/four-word comparison instructions |

All files intentionally fail compilation on undefined `TODO_*` branch labels.
Compiler checks also reject the design shorthand `pkverify` and `nstab` as
canonical dot-names (and `pkverify` as an abstraction identity). Those names
are retained from the design rather than silently assigning new identities;
canonical names must be settled before compilation.
These are visible missing contracts, not macros or successful stubs. No binary
may be emitted or admitted from partial compiler output. Never remove blockers
merely to make a build pass. Each must be replaced by the explicitly settled
mechanism, with real hard-fault paths on failed checks.

## Proposed, not approved

- Public method names, scratch registers, dispatch and preserved state.
- How the internal X-code binding is created for `LAMBDA CR10`, and how its
  code shares Mint's scope without becoming a new public method/service.
- Trusted-state/proof transfer and early-out comparison timing. The four-word
  equality example is not a complete secure verifier or a constant-time claim.
- Hard-fault entry: no new fault instruction or encoding is invented.
  Use a standard non-returning path with structured IDE diagnostics; fields,
  ABI and transport remain TBD. No secrets in the record, and no dependency on
  IDE availability for the hard fault itself.

The current assembler accepts `LAMBDA CRn`; the current ISA document places
its detailed description in the history document. These drafts follow the
user's explicit same-scope LAMBDA decision, not an independently verified
Phase 1 hardware implementation. Source reconciliation remains necessary.

The structured Mint capability declaration deliberately does not provision
nstab: provisioning its shared-scope authority remains a blocker. Only the
LAMBDA fragment contains a code reference to nstab/NSRW-GT.

## Still required before execution

Genesis's GT list and policy; request/result ABI; proof generation, storage,
transfer and cleanup; revocation/replay; software generation policy; replacement
safety; slot read/write protocol; hard-fault attribution; LAMBDA binding/return;
loading and complete artifact measurement. Any fault is a hard fault, not
rollback of already accepted writes.

The 2 KiB Mint + 1 KiB pkverify guesses remain estimates. Partial source word
counts do not measure the finished Tiny LUMPs. No catalog, Namespace, boot image,
simulator, RTL or FPGA state was changed by adding these drafts.

## Draft checks

The structured compiler was run against Mint and pkverify, and against the
LAMBDA body in a temporary in-memory syntax wrapper. Diagnostics were confined
to the intentionally undefined TODO labels and the canonical-name blockers
above; the concrete instruction syntax was accepted. No output binary was
saved. This checks draft syntax/blocking, not runtime behavior or security.

# Native Mint LAMBDA: entry/return reconciliation

## Current implementation qualification

The ordinary simulator now uses the existing LAMBDA register operand's
validated X-capability location as its entry address. It checks that address
against the current executable body before accepting a continuation. CR6/CR14
are not replaced. Native tests enter a separate body and return with all CRs
and M bits preserved.

The existing `.pet body CR9` alias permits `LAMBDA body` with exactly the same
instruction word as `LAMBDA CR9`. CLOOMC method compilation now carries this
explicit alias through to the assembler. It does **not** create an X capability
or populate a Namespace slot: real entry provisioning is still required.

Mint's editable CREATE source also compares CR2 with an all-ones reference
constructed through its own state LUMP's RW/L views. Matching CR2 skips proof
checks, but not Data input checks. Native tests cover the escape with NULL CR3,
rejection of other proof-less credentials, and absence of memory authority in
the all-ones word. The state LUMP has one c-list row at its final word,
located using the header size; writing the reference must not overwrite its
header or assume a fixed artifact size.

This is **not complete CREATE acceptance**. The source still rejects compilation
at unresolved allocation, entry provisioning, accounting and completion gates.
No saved LUMP, New layout selection, frozen image or FPGA was changed. Historical
observations below are superseded where they describe ordinary LAMBDA
fall-through or require authority erasure on a same-context Mint return.

**Superseding programmer clarification, 2026-10-19:** RETURN from LAMBDA
preserves every current CR; capability clearing applies only to CALL packets.
The [master ISA correction](../../instruction-set.md#return-call-versus-lambda)
resolves that return-ABI question. The simulator and inline probes now preserve
all CRs/M bits and do not reconstruct CR6. The earlier clearing observations
below describe the rejected implementation, not legal erasure. Entry binding
and Mint's separate early-cleanup mechanism remain unresolved.

**Status: interface blocker submitted for review, not an ISA amendment.**
No ordinary simulator instruction, protected-profile implementation, artifact,
Namespace installation or hardware is changed by this investigation.
Data CREATE remains separate, all-zero allocation with CR4 NULL; no payload
copy or authority over existing storage is introduced.

## Authority and conflicts

| Source | What it establishes | What it does not establish |
|---|---|---|
| `docs/instruction-set.md`, Document authority, TPERM NULL and EXACT, Services and evidence | Master authority; only Mint's same-scope single-slot LAMBDA references NSRW-GT; Mint's approved contract governs proof/publication | No current rule mapping an own-object X GT to a private source-label offset |
| `docs/instruction-set-history.md`, LAMBDA | Historical intent: apply X code in caller scope, not a CALL/C-list switch | Historical intent does not choose a new operand encoding or link interface |
| `docs/lambda-instruction.md` | Older function-application design: branch to code, machine-status PC+4, PC-only fast return, tag 1 for Lambda, no nesting; now links the all-CR preservation correction | Not the implemented word-index PC/SZ protocol; historical cleanup observations do not override the master rule |
| `docs/isa_reference.md`, A.13 and LAMBDA | Historical baseline: SZ=0, PC+1, CR6/CR14 unchanged, NIA “derived from CRn's lump”, CR6 re-entry exception | “Derived” does not define the private label selector; differs from the older note on tags/nesting |
| `simulator/simulator.js`, `_execLambda` | Real mLoad X check, Thread geometry check, one-word continuation/cache, protected STO update | Ends with `pc++`; no branch, label lookup or entry offset selection |
| Same file, `_readProtectedCallFrame` / `_execReturnCore` | Validates protected STO/frame relation and executable return bounds; cached SZ=0 word may supply NIA; restores flags/prior SZ/STO while preserving all CRs on Lambda RETURN | CALL alone applies masks, M reset and CR6 reconstruction; cached frame and diagnostic CR snapshots are not the protected Mint profile's sealed continuation guarantee |
| `simulator/mint/protected-runtime.js`, `_execLambda` / `_execReturn` | Scoped M2 extension: checked read/commit link entry, same-artifact bounds, frame flush and captured context validation; now faults `MINT_CLEANUP_UNBOUND` instead of clearing CR10 and returning | No successful protected Lambda/service return until a separate early-erasure mechanism is approved; no ordinary CLOOMC entry binding is established |

The approved isolated M2 implementation is not authorization to extend ordinary
CLOOMC. It selects `readEntry` or `commitEntry` from protected invocation stage,
calls the base LAMBDA, then sets `pc = entry`. It is real behavior **within that
profile**, not native entry evidence for the editable `mint.cloomc`.

## Exact missing binding

The editable source invokes `LAMBDA CR9` from `create_data_set_slot` and wants
`create_data_slot_lambda` within the **same executable and CR6 scope**.
CR9 can identify Mint's executable with X permission, but that identity alone
cannot distinguish CREATE's public entry, this private label, or another
internal label. The current assembler emits no label operand for LAMBDA, and
the native execution path consumes no trusted entry record.

There is therefore **no established ordinary binding for this private label**
in the reconciled sources. Merely assigning Mint's own X GT is insufficient.
Neither setting a test PC, editing a descriptor's base into the middle of code,
using an immediate/DR offset not specified for this instruction, exposing a
new public method, nor borrowing protected M2 stage dispatch is a legal fix.
No such workaround is implemented here.

Before native integration, an architectural decision must specify:

1. **Entry authority:** how the exact executable identity and private entry are
   bound, who creates/adopts that binding, and what ordinary LAMBDA consumes.
   If a trusted link is selected, define its format, provenance, stale-link
   rejection, lookup and missing-link hard fault. No new numeric encoding is
   selected by this report.
2. **Address and scope:** the executable-body address unit/base and bounds;
   preserve CR6, CR14 and Thread/Namespace identity; reject a link to another
   artifact or outside the current executable fence before changing the frame.
3. **Continuation authority:** select protected SZ=0 storage/cache rules,
   accepted caller NIA/FLAGS/prior SZ/STO validation and nested/re-entry rules.
   Do not replace these with the older PC-only description by implication.
4. **Return ABI (now resolved):** keep-mask clearing and CALL-boundary M behavior
   do not apply. LAMBDA RETURN preserves all CRs and M bits, including CR8/9/10
   and the current CR6/CR14. Mint still needs a separate legal early-erasure
   mechanism; no Lambda mask can satisfy scoped CR10 cleanup or exclusion.

These are decisions required for a legal binding, not already-approved new
requirements for all LAMBDA uses. The narrow recommendation is to keep native
CREATE disconnected until this contract is reviewed; retain the isolated
protected profile as separately qualified evidence.

## Reproducible native evidence

Run:

```sh
node simulator/test_mint_data_native_path.js
node simulator/test_mint_phase1_api_draft.js
```

The native test uses `Simulator` and the actual assembler/instructions/mLoad.
Namespace descriptors, memory and initial registers are disposable test
provisioning only. No runtime method is replaced; PC is initialized before
execution, never redirected to a body to claim entry.

- With valid X authority, `LAMBDA CR9` advances to the continuation rather than
  the marker body. The marker is unexecuted. This asserts the **known blocker**,
  not architectural conformance; replace this expectation after an approved fix.
- A separate `LAMBDA; RETURNAL` **inline** probe exercises the real SZ=0 unwind.
  It checks saved NIA, frame/indicator consistency, caller code/scope and
  CR5/CR12–15 descriptors, flags, prior STO/SZ, physical fetch address, cache
  removal, and unchanged Namespace authority (normal mLoad G-bit marking is
  allowed). CR6 descriptor metadata is preserved, not rederived. Both mask zero
  and mask 4095 preserve all CRs, including CR8/9/10 and M bits.
  Returning to the inline RETURN is intentional diagnostic
  evidence and is **not a successful private-body invocation**.
- Existing source-fragment probes retain exact all-word zeroing and four-word
  slot write/read-back evidence. TPERM CLEAR still does not erase authority.
  These component results do not validate allocation, proof, G4 exclusion,
  publication, accounting, or a complete CREATE service.

## Review disposition

Pending explicit review: resolve the identified missing ordinary entry binding
and remaining continuation storage details. The programmer has separately
resolved the CR-preservation rule as noted above; accepting the original
blocker alone did not authorize that correction. Successful native private entry **and** return with
protected context intact remain unproven.

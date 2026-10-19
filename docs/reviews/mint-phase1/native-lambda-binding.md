# Native Mint LAMBDA: entry/return reconciliation

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
| `docs/lambda-instruction.md` | Older function-application design: branch to code, machine-status PC+4, PC-only fast return, tag 1 for Lambda, no nesting | Not the implemented word-index PC/SZ protocol; not authority to discard current RETURN validation/mask behavior |
| `docs/isa_reference.md`, A.13 and LAMBDA | Historical baseline: SZ=0, PC+1, CR6/CR14 unchanged, NIA “derived from CRn's lump”, CR6 re-entry exception | “Derived” does not define the private label selector; differs from the older note on tags/nesting |
| `simulator/simulator.js`, `_execLambda` | Real mLoad X check, Thread geometry check, one-word continuation/cache, protected STO update | Ends with `pc++`; no branch, label lookup or entry offset selection |
| Same file, `_readProtectedCallFrame` / `_execReturnCore` | Validates protected STO/frame relation and executable return bounds; cached SZ=0 word may supply NIA; applies mask, M reset/CR6 rearm, flags/prior SZ/STO restoration | Not a pure PC-only return; cached frame and diagnostic CR snapshots are not the protected Mint profile's sealed continuation guarantee |
| `simulator/mint/protected-runtime.js`, `_execLambda` / `_execReturn` | Scoped M2 extension: exact own-object execute GT, checked read/commit link entry, same-artifact bounds, immediate frame flush to private Thread RAM, captured scope/code/thread/frame checks, CR10 clearing, then ordinary RETURN | Does not make that link producer, host entry selection or protected erasure an ordinary CLOOMC instruction |

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
4. **Return ABI:** decide whether the existing keep-mask/M behavior applies.
   Today bare `RETURNAL` in the private body clears CR8/CR9/CR10 as well as other
   scratch capabilities. A caller must not assume CR8 survives for accounting.
   A keep-mask is not a substitute for scoped CR10 cleanup or exclusion.

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
  allowed; CR6 descriptor metadata is rederived). Mask zero scrubs CR8/9/10; mask 4095
  retains them. Returning to the inline RETURN is intentional diagnostic
  evidence and is **not a successful private-body invocation**.
- Existing source-fragment probes retain exact all-word zeroing and four-word
  slot write/read-back evidence. TPERM CLEAR still does not erase authority.
  These component results do not validate allocation, proof, G4 exclusion,
  publication, accounting, or a complete CREATE service.

## Review disposition

Pending explicit review: accept the identified missing ordinary entry binding
and continuation/return contract as the remaining interface blocker, or provide
an authoritative rule resolving it. No runtime or ISA change is authorized by
accepting the blocker. Successful native private entry **and** return with
protected context intact remain unproven.

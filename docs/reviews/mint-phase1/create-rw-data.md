# CREATE: first RW Data implementation slice

Scope: editable ordinary CLOOMC assembly in `simulator/cloomc/mint.cloomc`,
not a runnable service, installed LUMP, private-opcode implementation, or
hardware change. Requested by the programmer after the four-case input review.

**Superseding ISA correction (2026-10-19):** LAMBDA RETURN preserves all CRs.
The programmer clarified that capability clearing applies only to CALL packets.
The earlier Lambda-mask cleanup claim was wrong: native execution matched an
incorrect simulator implementation, not the intended ISA. That mechanism has
been withdrawn and Mint's missing early-cleanup gates are explicit again.

**Superseding confidentiality decision:** The programmer chose separate storage
returned clean (all zero), not a copy or new authority for existing storage.
Data CREATE no longer accepts a source payload or needs source-extent metadata.
The working draft requires CR4 NULL to avoid accepting unnecessary source
authority. It zeros every allocated word before publication. This removes
payload exposure during creation; post-return confidentiality also requires
controlling retained allocator authority and is not proven by this fragment.

## Working inputs

| Input | Meaning |
|---|---|
| CR2 / CR3 | Passkey GT / readable four-word proof reference |
| CR4 | NULL; no Data initialization source |
| DR2 | Power-of-two word size OR case 4, using the low three bits |
| DR3 | 3: DATA permission mask W+R; not TPERM's RW preset index 2 |

The proof bounds probe uses scratch DR4, preserving DR2/DR3.
The scalar guards reject other cases, other permissions, zero decoded size,
and non-power-of-two size. Decoded size is retained in DR6. The still-proposed
64-word minimum is not silently made mandatory.

## Written instructions versus missing bindings

| Stage | Current source |
|---|---|
| Input shapes and packed-size decoding | Native instructions |
| Passkey proof, authority and sufficient allowance | Explicit unresolved service branch |
| Private allocation, slot/generation reservation | Explicit unresolved service branch; proposed internal CR8 destination |
| Zero entire allocation | Native indexed DWRITE loop; no payload reads |
| Namespace slot update | Four native writes/read-back checks verified separately; LAMBDA entry/return binding and exclusion remain unresolved |
| Publication, GC bookkeeping, accounting and issuance | Explicit unresolved service branch after Lambda return |
| Cleanup and final issued identity checks | Explicit unresolved branches, with native completion/NULL/RW checks |

The zeroing fragment expects allocator-issued private destination authority
in CR8 and decoded allocation size in DR6. These are internal continuation
contracts to bind, not additional caller parameters or implemented services.
Caller-provided CR8 grants no allocation authority. There are no copy-word or
source-length variables.
The publication stage must debit decoded DR6 once and issue Inform DATA RW B=1.
There is no fabricated completion assignment or promised rollback.

All unresolved fault/service branches remain undefined TODO labels: the whole
draft deliberately fails compilation rather than executing an incomplete path.
No implicit fault implementation or new HARDFAULT emission has been added.

## Slot-setting Lambda

The programmer directed that CREATE set the slot using LAMBDA. After zeroing,
the draft invokes `LAMBDA CR9` for an internal X-code body, not an E-GT service
or another public method.

| Internal variable | Working register |
|---|---|
| Trusted X GT to the private slot body | CR9 |
| Reserved slot index, then its four-word offset | DR7 |
| Four frozen descriptor words | DR8–DR11 |
| Namespace RW view, acquired only inside the body | CR10 |
| Read-back comparison scratch | DR4 |

These internal values must be bound from the validated reservation, not
accepted as caller authority. DR8–DR11 carry Namespace metadata, not payload.
The body writes exactly the selected four words, reads each back and checks
equality. It then stops at `TODO_CREATE_CLEAR_NS_AUTHORITY`: the bare Lambda
RETURN must preserve CR10 and cannot satisfy this gate. Its saved continuation
also stops at `TODO_CREATE_CLEAR_DESTINATION_AND_LAMBDA_AUTHORITY` before
the CR8/CR9/CR10 NULL postconditions and exclusion-release operation.
No result is issued first. No alternative erasure opcode, host mutation,
TPERM reinterpretation, or fabricated helper authority has been added.

Explicit blockers still cover trusted X/NSRW binding, descriptor preparation,
slot bounds and empty-slot generation checks, and writer/observer exclusion.
LAMBDA does not itself provide atomicity, and four writes/read-backs do not
prove an exclusion mechanism. Partial writes on faults are not rolled back.

## Verification

The [native LAMBDA reconciliation](native-lambda-binding.md) distinguishes the
missing ordinary private-entry binding from the separately scoped protected
Mint implementation. Native fall-through and inline RETURN are diagnostic
evidence, not successful private-body execution.

`node simulator/test_mint_phase1_api_draft.js` checks ordinary compiler syntax,
requires all remaining compile errors to be unresolved TODO labels, and walks
the actual scalar/zeroing source fragments with test-owned storage. It covers
packed cases, permissions, power-of-two boundaries, absence of payload reads,
zeroing every allocated word from dirty storage, and leaving words outside
the allocation untouched. Passkey proof reads remain necessary.
The slot fragment is separately exercised with test-owned metadata to check
exact-slot writes and all four read-back mismatch branches. It stops at the
unresolved Namespace-erasure gate without interpreting RETURN or simulating erasure.
Ordinary compilation checks LAMBDA/RETURN
syntax; these tests do not establish real X-capability binding or continuation.

### Native simulator trial

`node simulator/test_mint_data_native_path.js` executes the extracted zeroing
and slot-update instruction fragments with the ordinary simulator. It uses
test-provisioned descriptors and capabilities, without replacing mLoad,
instruction implementations, permissions, or continuation behavior.

- Native zeroing passes at 8, 64 and 256 words, leaving adjacent words untouched.
- Native descriptor writes/read-backs modify exactly the selected in-range
  slot and stop at the unresolved Namespace-erasure gate.
- TPERM CLEAR leaves the capability unchanged. Earlier fragment tests wrongly
  modeled it as erasure; those claims and the CREATE source have been corrected.
  The other three unfinished methods now also stop at explicit unresolved
  result-erasure gates rather than using TPERM CLEAR as cleanup.
- Ordinary LAMBDA saves continuation state but falls through instead of
  entering the intended private label. The separate protected Mint profile
  supplies additional entry/return handling; that does not establish ordinary
  CLOOMC support. The native probe records this blocker, not successful dispatch.

No complete CREATE happy path has run. Trusted Lambda entry and a legal
early-cleanup mechanism must be supplied before connecting these fragments;
Passkey, allocation, exclusion and accounting remain unfinished too.

This is fragment verification, not proof of Passkey validation, real allocation,
successful service execution, or committed accounting.

### Authority-removal investigation

The existing **CALL-frame** RETURN keep mask is a real erasure mechanism,
unlike TPERM CLEAR. The [master frame-specific rule](../../instruction-set.md#return-call-versus-lambda)
limits this security boundary to CALL packets. It zeros CR0–CR4 and CR7–CR11
for zero mask bits. Set bits keep the
**current callee** descriptor; they do not restore an earlier caller value.
CR5 is preserved, CR6 is reconstructed as caller context, and M-state is reset
with CR6.M rearmed. The mask does not erase proof bytes or data registers.

`node simulator/test_mint_authority_removal.js` extracts each method's actual
exit instruction and runs it in a disposable compiled CALL/RETURN fixture with
a real protected Thread. The fixture provisions private objects, then uses
fetched LOAD instructions to populate every mask-controlled register, including
R proof/result, RW destination/Namespace, and X Lambda capabilities. No register
or frame mutation supplies the cleanup. It checks all four descriptor words,
M-state, zeroed Thread capability homes, and caller context:

- CREATE, MakeOutform and MakeInform use `RETURNAL #2`: only CR1 survives.
- DESTROY uses `RETURNAL #0`: CR1 is also erased.
- DR1 remains unchanged, demonstrating that RETURN is not scalar cleanup.
- Nonzero pre-call capabilities are not restored into cleared registers.

The same test also executes real LAMBDA-created SZ=0 frames with masks 0,
2, 2207, 4093 and 4095. **Every mask is ignored. All current CR descriptors,
M bits and saved capability homes remain unchanged.** Both cached and
stack-spilled frames resume at their saved continuation in the existing context.
A real nested CALL supplies the spill; it is **test-only stack-path evidence**,
not permission to CALL during Mint's excluded update interval. The tests observe
the protected frame kind, not the diagnostic `lambdaActive` flag, and distinguish
CALL's CR14 reconstruction from LAMBDA's preservation of the current context.

Because ordinary LAMBDA still falls through, the fixture uses explicit assembly
branches and a scalar marker to reach RETURN once and then stop at the resumed
continuation. It does not patch the simulator, redirect PC from the host, or
claim that the X capability dispatched to Mint's private body. Executed LOADs
change CR3 and CR6 inside the fixture body; their new values survive RETURN,
proving preservation of current values rather than snapshot restoration or
CR6 reconstruction. Extracted Mint post-return NULL checks reject the retained
private destination for every mask; none reaches the release boundary.

| Cleanup point | Existing legal mechanism | Remaining binding |
|---|---|---|
| Result CR1 at method entry | Unresolved; Lambda RETURN cannot clear it | Legal erasure mechanism required |
| Proof and scratch before result checks | Unresolved; Lambda RETURN cannot clear them | Legal erasure mechanism and scalar cleanup required |
| Destination CR8, Lambda CR9, Namespace CR10 | Unresolved; all survive Lambda RETURN | Legal erasure mechanism and exclusion service required |
| Public CALL method exit | `RETURNAL #2`, or `#0` for DESTROY | Existing instructions; service bodies remain unfinished |

These are frame-specific instruction checks, **not operational Mint services**.
DESTROY's NULL result check occurs before its public RETURN, so its early
cleanup gate is retained. The source still binds only SELF E; no cleanup
helper was fabricated. Calling an early RETURN directly in the public method
would pop the wrong frame rather than perform an internal cleanup.

The programmer confirmed that LAMBDA returns to its saved stack address in the
existing context **without clearing any CRs**. No replacement continuation
mechanism is needed, and a Lambda mask is not an erasure mechanism.
The ordinary simulator packs `pc + 1` into its SZ=0 frame, currently retaining
that word in `lambdaCachedFrame` until a flush; RETURN reads the matching
cached word or stack word and resumes from its decoded NIA without replacing
CR14. The observed entry failure is instead `_execLambda` ending with `pc++`,
not transferring to the intended private body. This is separate from preserving
the saved frame and CR14 code context. Entry resolution
is tracked separately; no new continuation authority is being requested here.
The slot return preserves all capabilities. Final CALL return clears all but
the issued result (or all controlled CRs for DESTROY), but occurs too late to
satisfy Mint's required pre-release/issuance cleanup. Those gates stay unresolved.

LOAD is a checked c-list lookup, not a CR copy or literal NULL assignment;
empty unnamed rows fault and named empty rows can resolve/suspend.
TPERM attenuation can remove permission bits but retains identity/type; a
permissionless Thread GT can still authorize CHANGE. Neither is a substitute
for architectural NULL. No opcode, TPERM semantics, installed artifact or
hardware was changed. The simulator was corrected to preserve CRs on SZ=0
RETURN and apply cleanup only to SZ=1 CALL packets. Pre-return cleanup remains
fail-closed; LAMBDA entry work is separate from the missing erasure mechanism.
Removing a register reference does not revoke other
aliases, wipe the proof's backing storage, or remove proof bytes from DRs.

The isolated protected Mint adapter is also fail-closed: its former host-side
CR10 clearing before Lambda RETURN is removed. A validated protected Lambda
return now faults `MINT_CLEANUP_UNBOUND` before resuming, issuing a result or
publishing a Namespace slot. Fault quarantine hygiene is not a successful
RETURN or a legal service cleanup mechanism. The focused
`tests/mint_phase1/protected_lambda_cleanup.test.js` exercises this boundary
through the real private-core facade; earlier successful protected-service
evidence is superseded pending an approved early-erasure mechanism.

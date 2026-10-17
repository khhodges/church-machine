# Minimal Mint machine interfaces — proposal for review

**Status: PROPOSED. Permission was given to design these interfaces, not to
implement or activate them.** This document selects recommended semantics for
review; it does not amend the Master ISA or supersede approved Mint policy.

## Goal and limits

Make a real compiled caller → Mint → PkVerify → private Lambda → returned
capability path possible in the approved Phase 1 simulator. Keep the 17 named
entries, Resident intent, 256-slot table and 32-bit GT format unchanged.
nstab is the existing table's RW view, not a callable helper service.

The first positive Create test must use the credential's approved recipient:
ide.Mint, Owner 0. An arbitrary Alice/test-caller grant must not be fabricated.
Alice/Mallory receive only explicitly authorized capabilities and requests.
The first credential's Replace/Destroy target sets remain empty.

Three proposed changes are necessary. They are not implemented today:

| ID | Proposed change | Architectural consequence |
|---|---|---|
| M1 | Protected Mint admission/context interface | New privileged machine support; not a JavaScript-only source of authority |
| M2 | Linked same-artifact Lambda entry and protected continuation | Resolves the open entry/return contract; changes inconsistent current execution behavior |
| M3 | Private result C-list with narrowly bounded RW alias | New explicit capability-manufacturing grant to trusted Mint |

All three require approval. Instruction encodings are deliberately not assigned
in this review: an implementation must allocate/check encodings against the
actual assembler/decoder before emitting executable bytes. No published
instruction is silently repurposed, and existing image profiles remain distinct.

## M1 — protected admission and caller/live-use evidence

### Authority

Privileged operations are admitted only for provisioned exact Mint or PkVerify
artifact identities, roles and Namespace configuration. A name, numeric slot,
Owner field, host callStack or browser flag grants no authority.
The trusted initializer installs this role binding; ordinary code cannot edit
it. Changing selected code invalidates the binding until explicit provisioning.

### Operations

These are semantic interface names, not new source instructions or available APIs.

| Operation | Inputs | Machine-owned result and checks |
|---|---|---|
| BEGIN | Mint entry selector and the proposed typed CR inputs from implementation-plan.md: credential CR2, proof CR3, request CR4, target CR7, payload CR8 | Acquire one configuration-wide admission interval; validate and capture the outer caller's protected E authority; bind current Thread, exact Mint identity, Namespace, operation and immutable inputs |
| VERIFY_CONTEXT | Only the provisioned PkVerify entry reached from the active Mint invocation | Supply authenticated original recipient/configuration to the verifier from the active context, never from its immediate caller or a supplied integer |
| CHECK_LIVE_USE | Frozen target in the active context, used only for an otherwise authorized Replace/Destroy | Validate all live/suspended protected return contexts and active objects; record clearance tied to that exact target and interval |
| FINISH | The active Mint invocation, after confirmed publication and prepared result | Release admission and discard private snapshots/context before ordinary wrapper RETURN; no credential or context survives as a reusable grant |

There is one machine-owned context, tied to the admitted Thread and invocation.
No forgeable integer handle, extra public GT type or general Thread-read
capability is returned. Nested Mint admissions fault; PkVerify consumes the
existing invocation context without replacing the original caller.

Caller capture happens before nested CALL. BEGIN's descriptor/proof/payload
snapshots are coherent: competing mutation is excluded during capture, and only
the private snapshots are subsequently checked or consumed. A matching hash
alone is not a snapshot or caller authentication.

The verifier still performs actual credential/proof/operation checks against
its provisioned registry R view, including all four proof words and fixed-work
XOR/OR comparison. M1 does not replace PkVerify with an unconditional machine
success flag. Public copies of evidence cannot authorize a request.

CHECK_LIVE_USE is non-destructive and covers suspended contexts, not just the
current CR14 or last frame. Corrupt, missing or unbounded evidence faults; it
never means “unused.” It grants no raw frame offsets or arbitrary Thread access.
Ordinary outstanding GTs do not by themselves mean an object is in use.

### Admission interval and failure

All five Mint methods share BEGIN/FINISH exclusion. In a simulator, every
instruction path and asynchronous memory/image/Namespace mutator must honor it;
protecting only a JavaScript function call is insufficient. Trusted same-Thread
Mint/PkVerify execution is allowed; unrelated activation or mutation is not.
Hardware actors are a separate implementation obligation, not qualified here.

Any validation, overlap, replay, stale configuration or permission failure
hard-faults. There is no normal rejection return, queue, retry or rollback.
At fault/reset, discard invocation authority and prohibit resuming the call.
If publication was interrupted, affected state remains non-executable until
trusted reinitialization; clearing a volatile lock cannot certify that state.
Do not finish unaccepted writes or convert a partially written entry into success.

## M2 — private same-artifact Lambda entry and return

Mint CR9 holds an X GT for its own executable object. A trusted link record binds
that exact artifact to one checked dispatcher entry offset within its executable
body. The record does not manufacture a new Namespace descriptor or change the
GT's location, rights or bounds. The effective address is derived using the
actual executable-body base, not a guessed LUMP-header offset.

LAMBDA validates the X GT normally, proves the exact active Mint identity and
matching link record, checks the entry lies within executable bounds, preserves
CR6/C-list scope, and transfers to that entry. It must not merely advance inline
as the current JS implementation does. No caller-controlled label offset is
accepted and no separate service identity is introduced.

At instruction acceptance, capture the next caller instruction address and
original execution authority before changing the PC. Use a protected continuation
record containing that return address, caller identity/bounds, prior stack
position and a Lambda discriminator. The machine must revalidate it on RETURN;
a debug shadow or cached PC alone is not authoritative. No new packing of this
record is approved by this proposal.

Lambda performs one frozen-slot READ/recheck/COMMIT operation per invocation.
Only its audited code references CR10's nstab RW view; clear CR10 before RETURN.
It remains a leaf: no nested CALL, CHANGE, SWITCH or yield during the update.
Ordinary CALL/RETURN behavior and CR13 remain unchanged. Any change to existing
Lambda re-entry semantics requires separate reconciliation rather than being
silently bundled into this Mint proposal.

READ and COMMIT are separate non-nested invocations when verifier work is needed
between them. M1 exclusion and a final recheck keep their shared context valid.
Actual four-word storage readback is required after writes, not an echoed payload.

## M3 — private GT result delivery using ordinary LOAD

Provision a one-result C-list object privately to Mint, plus a separate,
word-bounded RW view of its result row. Keep the C-list framing intact.
The L view and RW view must each satisfy ordinary descriptor/type/bounds checks;
never issue a mixed-domain RW+L token.

After confirmed Namespace publication, the trusted Lambda writes the newly
validated GT word through the private RW view. On return, Mint reloads its
private L view and uses ordinary LOAD to materialize the result in CR1.
Clear the result cell and temporary private capabilities after loading; return
with the existing CR1-preserving mask. The caller receives only the intended
object GT, never either private result view or NSRW.

CR1 and the private result cell are cleared before admission. An invalid result
or missing ordinary LOAD authority hard-faults. No DR-to-CR conversion, direct
host register assignment or general set-B bypass is substituted.

This RW/L alias is a real capability-manufacturing privilege. Restrict it to
the approved Mint code/configuration and audit all writes. Any extra private
Namespace descriptors needed for these views must be explicitly counted in
capacity and GT coverage; do not hide them under the claim of 17 initial entries
or overwrite an approved entry. Exact private placement is a provisioning output,
not permission to relabel public slots.

## First complete acceptance scenario

1. Prepare an isolated approved-layout image and explicit trusted provisioning
   for the exact Mint/PkVerify code, the first credential and private views.
2. Enter Create as its genuinely authorized recipient through compiled execution.
3. BEGIN captures the caller and inputs; real PkVerify checks the frozen request.
4. Allocate a supported RW object in an eligible slot without changing the
   original 17 assignments; initialize it and commit through the private Lambda.
5. LOAD the issued result into CR1, FINISH, and RETURN. The caller writes and
   reads back through that GT; verify actual memory and descriptor state.
6. Repeat and check allocation, generation, bounds and forward progress.
7. In separate negative runs, prove unauthorized/replayed requests, exhaustion,
   overlapping admission and interrupted updates produce the specified faults
   without granting authority. Do not report these expected faults as normal-run
   failures, and never suppress unexpected faults.

A synthetic helper invocation or prefilled result register is not acceptance.
Report exact input/code/image identities and every extra dynamic/private slot.

## What approval would and would not mean

Approval would permit implementation of these semantics in isolated simulator,
compiler/linker and provisioning paths, with explicit tests for the privileged
boundary. It would not certify existing code, install replacements into the
saved Namespace, activate a live image, publish new ISA encodings without
consistency checks, or authorize hardware builds/programming.

G4 publication exclusion and G5/G6 durable credential custody/provisioning remain
real dependencies. A private test credential is test evidence, not production
custody. This proposal does not close all Mint gates or promise a functioning
service before those dependencies are implemented and verified.

References: [effective contract](service-contract.md),
[existing proposed public ABI](implementation-plan.md),
[source-grounded limitations](context-feasibility.md),
[update exclusion](namespace-update.md).

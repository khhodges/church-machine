---
name: SecurityMonitor GT construction
description: Current Create(GTvars) clarification and subordinate historical port proposals
---

## Current authority

SecurityMonitor offers `Create(GTvars)`: it packs a data word and, using its
M-bit ownership, reads that word back as a GT.

**Why:** The user explicitly supplied this construction mechanism after the
agent incorrectly treated the unfinished MintM appendix as a blocker. M rules
are already defined in the ISA; asking the user to locate a superseding section
was not useful.

**How to apply:** Implement native packing and M-authorized readback inside
SecurityMonitor. Do not require a separate GTMint device, invent an opcode or
substitute an always-readable L alias or host GT-construction callback. Keep
monitor authority private. This resolves the construction path, not queue
surrender, lifecycle authorization, general type policy or FPGA deployment.

## Historical port proposals

The following records preserve prior discussions, not additional prerequisites
for the clarified SecurityMonitor construction path.

The user agreed to proceed with a dedicated hardware port accepting DATA writes
and capability LOADs, privately held by Mint, to simplify GT result materialization.

**Why:** A small hardware result register could replace the private result
C-list/writable-alias mechanism; DATA-to-capability access is itself manufacturing
authority, not ordinary diagnostic access.

**How to apply:** Preserve ordinary memory's DATA/capability separation and
SecurityRegulator's separate WDT custody. Do not treat this as approval of
general mixed-domain tokens or physical operations.
Resolve remaining interface details one at a time.

The user approved `0xFFFFFF14` as the GTMint hardware address in the Phase 2
specification.

**Why:** This settles the port location without assigning bus translation,
access-permission encoding or provisioning.

**How to apply:** Use this address in subsequent design work; do not interpret
it as approval of hardware changes or restarting outdated Mint testing.

The user approved one transient result: successful validated LOAD consumes it;
successful CHANGE/SWITCH/completed internal LLR handoff (including self-transfers),
fault or reset clears it. LOAD without a pending result hard-faults.

**Why:** Another Thread must not inherit pending manufacturing output; clearing
only after LOAD does not prevent cross-context consumption.

**How to apply:** Do not save the pending result in Thread storage or replay an
interrupted write/load pair. Mint must complete the pair without a context
handoff. Exact fault code and remaining operation/ordering details are not
settled by this approval.

The user directed: “We should not spend time on testing the outdated Mint and
push that to phase 2.”

**Why:** Qualifying the superseded Mint path would spend effort on a design being
replaced rather than the intended GT-construction mechanism.

**How to apply:** This broad deferral has a subsequent explicit exception:
the user selected the existing CREATE/DESTROY lifecycle, excluding Passcodes,
as the shortest bounded testable route. Permit that local demonstration without
treating it as broad legacy qualification, private-view containment, live
installation approval or acceptance of the new GTMint port.
Keep passcode exclusion explicit in disposable fixtures; do not weaken a
production verifier to match historical always-approve test assumptions.

Diagnostic MMIO is decomposed into several Diagnostic Abstractions with
separately scoped GTs; the user identifies GTMint as the first example.

**Why:** The user explicitly rejects the assumption that full-range diagnostics
needs one dangerous GT covering the entire hardware range.

**How to apply:** Treat full-range coverage as collective coverage, not a
blanket grant. Preserve Mint's private construction authority and separate
SecurityRegulator WDT custody; do not invent the remaining abstraction inventory
or provisioning from this architectural clarification.

The user approved **GT.M as a dedicated seventeenth M bit belonging to GTMint**,
separate from the sixteen CR-associated M bits. W on the private port capability
permits DWRITE; dedicated GT.M authorizes LOAD. Successful validated LOAD
consumes this GT.M and the pending result, not an existing CR-associated M.

**Why:** Existing GT encoding separates DATA and capability permission domains.
The user explicitly corrected “CR.M” to “GT.M”, directed consumption, and
confirmed that this is a seventeenth hardware-state bit. This supersedes the
earlier source-CR.M reuse proposal; it does not alter the 32-bit GT format.

**How to apply:** Keep this DATA-to-capability path specific to GTMint, with
normal validation and transient-result rules. Do not imply that existing LOAD
hardware already implements it. Use GT.M in subsequent design discussion;
consume it on successful LOAD rather than treating it as a reusable grant.
The control mapping (including any use of bit 16 at the M-control port) and
dedicated-bit initialization/handoff/fault/reset behavior remain undecided.

The user clarified that the low-level GT-construction code belongs to the
security monitor that controls M; show an explicit GT.M = true step before LOAD.

**Why:** Omitting the authorized M-setting step made the sequence incomplete
and obscured who can renew the consumed authority.

**How to apply:** Include authorized M setting in conceptual examples without
inventing a SET M opcode, automatic DWRITE elevation or raw M-control grants to
ordinary callers. Preserve SecurityRegulator custody and keep the exact service
ABI separate from this clarification.

Genesis explicitly approved updating Mint to match the accumulated Phase 2
decisions, including dedicated GT.M and Namespace-qualified caller identity.

**Why:** The approved architecture must govern Mint rather than leaving the
outdated result-alias/credential implementation as the design authority.

**How to apply:** Use the revised Phase 2 Mint contract for new work, retain
historical executable evidence, and distinguish approval from missing machine
interfaces. Do not strip live authorization checks or invent runnable opcodes
to simulate an unimplemented GTMint/Pass Bit path.

General Pass Bit and indirect-CALL authorization work has subsequently been
deferred; Genesis directed unchecked Passcodes for Phase 2.

**Why:** The general mechanism must not block delivery or be rushed.

**How to apply:** Keep dedicated GTMint GT.M work distinct from that deferral.
Do not require a general Pass Bit design before continuing the GTMint contract,
and do not represent unchecked Passcodes as authentication.

On 2026-11-11 the user clarified: “M is hardware only used in Boot,
CR6 CALL/Return, and single instructions authorized by a resident GT.”

**Why:** A proposed monitor-invocation lifetime incorrectly framed M as a
software-held service permission; the user requested an instruction-level
restatement instead. Blanket GT.M/pending-result clearing at every CALL/RETURN
was proposed, not approved, and withdrawn.

**How to apply:** The user then explicitly corrected that the ISA already
defines everything concerning M. Do not reopen M authorization or lifetime as
a queue-design decision. Consult the master ISA's approved A.1/A.2 rules and
audit conformance; missing implementation is not missing architectural approval.
Earlier GTMint proposals do not override the master ISA. Keep pending-result
custody separate from instruction authorization; do not invent a software lease.

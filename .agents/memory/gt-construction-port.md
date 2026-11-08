---
name: Mint-private GT-construction port
description: Approved Phase 2 direction and the boundary between minting authority and diagnostic access
---

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

**How to apply:** Defer Mint qualification to Phase 2 against the revised design.
Do not proactively run, repair or expand outdated Mint-specific qualification,
or make it a prerequisite for current work. Retain historical code/tests/evidence;
this is not permission to delete tests or claim acceptance.

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

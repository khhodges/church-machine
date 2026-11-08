# Mint-private GT-construction port

## Approved direction

The user agreed to proceed with a dedicated hardware-address port that accepts
a 32-bit DATA word and permits that result to be LOADed as a capability.
This is a narrowly scoped GT-construction facility privately held by Mint,
not general data-to-capability conversion through diagnostic MMIO.

The user identifies this **GTMint port as the first example of decomposed
Diagnostic Abstractions**: several separately scoped GTs, rather than one
dangerous diagnostic GT covering the whole hardware range. This describes
the decomposition, not a grant of manufacturing authority to general diagnostic
callers. Mint's private custody and the transient-result rules remain unchanged.

Conceptual sequence, not assigned assembler syntax:

```text
Security monitor executes the trusted GT-construction sequence
  -> authorized DWRITE to the construction port
  -> explicitly set GTMint's dedicated GT.M = true
  -> authorized LOAD through the construction port
  -> validated capability in the destination CR
     and consumption of GTMint's GT.M and the pending result
```

The user clarified that this low-level code belongs to the security monitor
that controls M. “Set GT.M” above denotes an authorized control operation whose
exact mapping remains undecided, not a new SET M opcode or an ordinary caller's
ability to elevate itself. Preserve SecurityRegulator's M-control custody; this does
not grant raw M-control to ordinary Mint callers. The exact service boundary
and calling ABI are not assigned by this example.

This replaces the need for a writable memory alias to a private result C-list
for result materialization. It does not by itself allocate a Namespace slot,
initialize an object descriptor, increment a version, authorize a request or
publish a new object. Hardware does not invent or change GT versions.

The approved GTMint hardware address is **`0xFFFFFF14`**, a specification-only
assignment. Bus-address translation and exact implementation remain
unresolved. The approved permission contract uses W plus GTMint's dedicated
GT.M, as specified below. No Namespace slot, instruction encoding, mixed-permission token
format or software method ABI is assigned here. No existing Mint path has
been removed or replaced. Core integration and physical operations have not
been performed.

## Authority boundary

The port capability together with GTMint's dedicated GT.M authority permits DATA
to become a capability and constitutes the manufacturing grant.
Ordinary descriptor/version/type/bounds validation
does not establish that the writer was entitled to manufacture an otherwise
valid GT.

- Mint privately holds the construction authority. Possession and validated
  permissions establish access, not an abstraction name or Thread-name check.
- Callers receive only the intended result capability, not the port authority.
- General full-range diagnostics must not acquire construction authority merely
  because they can address the range. Test access remains capability controlled.
- This is distinct from WDT control at `0xFFFFFF18`, which remains exclusively
  held by SecurityRegulator.
- Ordinary memory retains the DATA/capability separation. Any device-specific
  W-data/L-capability exception must be explicit and confined to this port.

The existing [Phase 1 result-materialization contract](../reviews/mint-phase1/minimal-machine-interfaces.md)
uses separate private RW and L views and prohibits a mixed-domain RW+L token.
The new port is a Phase 2 replacement direction, not a retroactive claim that
the previous contract already supports it. The approved replacement uses W and
GTMint's dedicated GT.M, not a mixed-domain W+L token.
Existing admission/publication obligations are not waived by this proposal;
the port alone cannot prove publication-bound result delivery.

## Approved W and GT.M access contract

- Mint holds a W capability scoped to GTMint at `0xFFFFFF14`; W permits the
  DATA write to the port.
- **GT.M is a dedicated seventeenth M bit belonging to GTMint's hardware
  register**, separate from the sixteen CR-associated M bits. It authorizes
  capability LOAD through this port; neither source nor destination CR.M is
  substituted for it.
- This supersedes the earlier proposal to reuse the source CR-associated M.
  A dedicated hardware-state bit is introduced, not a new permission bit in the
  32-bit GT encoding or a new GT format. Do not attempt
  to encode W and L together in the existing mutually exclusive permission domains.
- This is a GTMint-specific DATA-to-capability path, not a general writable
  DATA/capability alias for ordinary memory. Normal applicable validation and
  the approved pending-result lifetime remain required.

**Successful validated LOAD consumes both GTMint's dedicated GT.M (clears M)
and the pending result.** GT.M is therefore single-use for this materialization;
it is not automatically re-granted by a later DATA write. Consumption occurs
with successful LOAD completion, not merely when a LOAD is requested.
Provisioning and exact LOAD integration still
need specification; this approval does not claim that current LOAD hardware
already supports the port.

The control mapping of this seventeenth M bit remains unresolved. In particular,
approval does not assign bit 16 of the M-control word at `0xFFFFFF1C`.
Its initialization and handoff/fault/reset behavior must be specified separately;
the existing pending-result clearing rules do not by themselves define every
transition of this newly distinguished authority bit.

## Approved pending-result lifetime

A global writable register can be overwritten or read by a different Thread
between DWRITE and LOAD. Clearing after LOAD alone is insufficient.

**Approved:** use one transient result,
consume it only on a successful validated LOAD, and invalidate it on a
successful CHANGE/SWITCH/completed internal LLR handoff, fault or reset.
Do not preserve it in Thread storage or automatically replay an interrupted
write/load pair. LOAD with no pending result hard-faults rather than returning
a stale GT; the exact fault disposition remains to be selected.

This keeps the write/load pair within one uninterrupted execution context.
It includes successful self-transfers. A pending result cannot survive a
Namespace transition or be inherited by a newly active Thread.

The cost is explicit: Mint cannot suspend between writing and loading the
result and expect the value to survive. This is not a fault-recovery strategy.
A fault during LOAD clears the pending result under the fault rule.
Failed/skipped transfers without a fault, CALL/RETURN boundaries, duplicate
writes, NULL results, and same-edge transition/access ordering require precise
rules before integration. No partially validated LOAD may publish a CR value.

## Remaining interface and verification work

**Testing scope — user direction:** Defer Mint testing to Phase 2. Do not spend
current effort qualifying the outdated Mint implementation or its result-alias
path. Future Mint qualification should exercise the revised design below once
the outstanding contract and implementation are ready. Retain old tests and
evidence as reference, not as proof of the new port or a current prerequisite.

With pending-result lifetime settled, review remaining issues one at a time:

- Address units, width/alignment, bus translation and exact decode for the
  approved address `0xFFFFFF14`.
- Provisioning and integration of the approved W/GT.M
  contract without a general mixed-domain permission bypass or unintended aliases.
- Dedicated GT.M control mapping, initialization and handoff/fault/reset lifetime.
- LOAD validation and unavailable-target behavior, including interaction with
  Phase 2 LLR. An interrupted materialization must not silently resume with a
  different or stale result.
- Per-operation rejection and atomicity, and the boundary between software Mint
  obligations and hardware-enforced publication binding.
- Observer/debug containment and local simulator/RTL tests for authorized use,
  unauthorized access, interleaving, fault/reset and single-result consumption.

No physical evidence or working implementation is claimed by this document.

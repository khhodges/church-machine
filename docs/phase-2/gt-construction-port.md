# Mint-private GT-construction port

## Approved direction

The user agreed to proceed with a dedicated hardware-address port that accepts
a 32-bit DATA word and permits that result to be LOADed as a capability.
This is a narrowly scoped GT-construction facility privately held by Mint,
not general data-to-capability conversion through diagnostic MMIO.

Conceptual sequence, not assigned assembler syntax:

```text
Mint constructs GT bits
  -> authorized DWRITE to the construction port
  -> authorized LOAD through the construction port
  -> validated capability in the destination CR
```

This replaces the need for a writable memory alias to a private result C-list
for result materialization. It does not by itself allocate a Namespace slot,
initialize an object descriptor, increment a version, authorize a request or
publish a new object. Hardware does not invent or change GT versions.

No port address, Namespace slot, instruction encoding, mixed-permission token
format or software method ABI is assigned here. No existing Mint path has
been removed or replaced. Core integration and physical operations have not
been performed.

## Authority boundary

The capability permitting DATA writes that can subsequently become capabilities
is the manufacturing grant. Ordinary descriptor/version/type/bounds validation
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
the previous contract already supports it. Separate access views versus an
explicit device-only permission combination remains an interface decision.
Existing admission/publication obligations are not waived by this proposal;
the port alone cannot prove publication-bound result delivery.

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

With pending-result lifetime settled, review remaining issues one at a time:

- Exact port address and address units, width/alignment and decode.
- W/L access representation and provisioning without a general mixed-domain
  permission bypass or unintended aliases.
- LOAD validation and unavailable-target behavior, including interaction with
  Phase 2 LLR. An interrupted materialization must not silently resume with a
  different or stale result.
- Per-operation rejection and atomicity, and the boundary between software Mint
  obligations and hardware-enforced publication binding.
- Observer/debug containment and local simulator/RTL tests for authorized use,
  unauthorized access, interleaving, fault/reset and single-result consumption.

No physical evidence or working implementation is claimed by this document.

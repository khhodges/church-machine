# Phase 2 objectives

These documents record agreed objectives, not completed implementation or
authorization to install an image or program hardware.

- **First priority: [Unified lazy-load lifecycle](../lazy-lifecycle-unified.md)** —
  authoritative Phase 2 FPGA/microcode and software-interface agreements.
- **[All Phase 2 tests](test-checklist.md)** — consolidated acceptance inventory,
  first-proof selection, unresolved-contract gates and later objectives.
- **[Thread status LED local RTL result](thread-status-led-rtl-results.md)** —
  CHANGE counter and Hard Fault blink tested with real core events and candidate
  wrapper pins; protected monitor software access and general Thread-fault
  recovery acceptance remain separate.
- **[Hardware-address map and diagnostic MMIO](hardware-address-map-and-diagnostic-mmio.md)** —
  full declared range, approved WDT address `0xFFFFFF18`, current decoder differences,
  and decomposed, Church capability-controlled Diagnostic Abstractions with
  separately scoped GTs; GTMint is the first example.
- **[Mint-private GT-construction port](gt-construction-port.md)** —
  approved address `0xFFFFFF14`, W plus dedicated seventeenth-bit GT.M access, and transient-result
  lifetime; successful LOAD consumes GT.M and the result; integration remains open.
- **[Genesis-approved Mint abstraction](mint-abstraction.md)** —
  current consolidated Phase 2 contract, replacement boundaries and outstanding
  inputs for the executable update.

## Current agreed FPGA boundary

**[Pass Bit and caller identity discussion](pass-bit-and-caller-identity.md):**
avoid general Passcode slot/C-list proliferation without prohibiting private
program use; recorded caller E-GT identity must include the Namespace ID.
**Current Genesis decision: Passcodes remain unchecked for Phase 2.** Defer
general Pass Bit and indirect-CALL authorization redesign; neither gates
Phase 2 delivery. Unchecked Passcodes do not authenticate a caller.
The approved dedicated GTMint GT.M and ordinary capability checks remain separate.

**Mint testing scope:** The user subsequently selected the existing lifecycle
as the shortest testable route, excluding Passcodes. This is a bounded exception
to the earlier deferral, not broad legacy qualification.
[Local RTL results](mint-existing-lifecycle-results.md) establish CREATE/DESTROY,
read/write, clean reuse and stale-GT rejection. They do not establish private-view
containment, live installation or the new GTMint hardware.

- Boot.Thread at Namespace slot 2 is SYSTEM; CR12 holds active Thread identity;
  CR13 remains reserved. Full GTs preserve version; slots are Namespace-scoped.
- A valid unavailable USER CALL enters SYSTEM internally, saving the original
  uncommitted CALL in normal protected Thread storage. No new entry instruction.
- After SYSTEM restoration: DR1–DR4 Namespace metadata, DR5 target slot,
  DR6 unchanged outgoing USER Thread GT, Z=1; preserve restored N/C/V and USER flags.
  DR1–DR5 alone form the 20-byte IDE target payload.
  DR0 remains hardwired to zero; the earlier DR0–DR5 handoff is superseded.
- Ordinary CHANGE handles USER yield and SYSTEM exit. Yield resumes after CHANGE;
  LLR restoration resumes the original CALL. Saved SYSTEM Z=0 marks ordinary entry.
- SYSTEM software owns pending/ready state and cooperative round robin; no FPGA
  blocked bit, duplicate in-progress request or premature waiting-USER selection.
- DELIVER is transport receive/status, not an interrupt, Thread switch or
  register/flag injection. No USER eligible: SYSTEM stays active.
- SYSTEM LLR HardFaults with ABSENT_OUTFORM (0x11), without loading-trap behavior.
  Other invalid authority/context retains applicable fault reasons.
- Retain the existing watchdog and Debug/Trace exemptions, with no SYSTEM exemption.
  SYSTEM uses self-CHANGE before the deadline when no USER is eligible.
  Successful internal LLR entry renews only after save, restore and injection
  complete; no early renewal/pause, and expiry wins at equality.
- SecurityRegulator privately holds the watchdog-control capability. SYSTEM
  may CALL explicitly authorized methods without receiving raw control authority.
  Hardware retains automatic transition renewal and expiry enforcement;
  no general software kick or SYSTEM exemption is added.
- Authorized software increments Thread version on USER reset, without wrap;
  hardware compares only. SecurityRegulator must supply the increment method;
  its exact ABI remains open.

Architecture approval is not an implemented or qualified bitstream. Transport
capacity/full-buffer behavior, framing/session setup, software provisioning and
later retirement contracts remain explicit gates in the checklist.

## Later Phase 2 objectives

- **[Compact, expandable Block inventories](compact-block-inventory.md)** —
  named-GT ownership, compact C-list evaluation, independent placement and a
  two-Block transaction/expansion demonstration; no new Phase 1 gate.
- **[Named SD-card storage abstraction](sd-storage-abstraction.md)** —
  capability-controlled block storage beneath object and Thread backing-store
  services.
- **[Phase 1 and Phase 2 test plan](../phase-1/W7-phase-1-and-2-test-plan.md)** —
  existing scope and evidence requirements, including the networking campaign.

Historical lifecycle flows and old CR13 exports are retained as history only;
they do not override the unified specification. Phase 1 ISA and archived
evidence remain unchanged, rather than being retroactively claimed as Phase 2.

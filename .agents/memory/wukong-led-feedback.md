---
name: Wukong LED feedback
description: Two-bit CHANGE counter and overriding Hard Fault indication
---

The user selected a two-bit counter on the Wukong user LEDs and required
an indication of any Hard Fault.

**Why:** Provide physical execution feedback without using one of the two LEDs
exclusively for normal fault status.

**How to apply:** Count successful CHANGE completions modulo four. The documented
design uses a latched simultaneous blink to override the count for Hard Faults.
Keep this observation separate from execution/fault recovery and from approval
to build or flash hardware. The blink encoding is an implementation choice,
not a separately user-selected pattern.

The user explicitly requires: “The FPGA must never freeze any working threads
must continue.”

**Why:** A latched fault display must not be confused with a global execution
halt or a requirement to reset the board before unaffected work can continue.

**How to apply:** Latch only the indication. Keep unaffected Threads executing
and the CHANGE counter advancing behind the fault display; never use the LED
fault flag to stall scheduling or gate execution.

The user approved explicit security-monitor clearing once the fault is handled,
superseding reset-only clearing.

**Why:** The LEDs must indicate recovery rather than remain a fault-history
display requiring a board reset.

**How to apply:** Restore the current count without clearing recorded fault
details or interrupting working Threads. Successful CHANGE alone does not clear
the flag. A new fault relatches it and wins over a simultaneous clear. Keep the
protected control interface separate from this behavioral approval.

The user subsequently approved the proposed protected write-only clear contract
and delegated choosing a non-conflicting hardware address.

**Why:** The simulation-only input was insufficient; the monitor needs a real
instruction path without giving ordinary callers a grant.

**How to apply:** Preserve exclusive SecurityRegulator custody and exact
one-word W access. The address map records the selected ABI. Local synthetic
grants are test evidence, not approval to provision saved images, run vendor
builds or operate the board. Indicator clearing and the separate fault-hold
recovery work must not be conflated.

Keep local LED integration opt-in until release selection is approved. The
protected write-only monitor-clear contract is approved and has a real DWRITE
path; it is no longer an unsettled interface or simulation-only proposal.

**Why:** Authorization for a local RTL trial is not authorization to change the
default physical build or expose a new software control.

**How to apply:** Preserve the real protected DWRITE path alongside the separate
simulation stimulus. Neither local tests nor that implementation authorize
provisioning a saved grant or changing the physical release. Full-wrapper RTL tests must budget for serialized trace
output, rather than treating a short timeout as a core freeze or bypassing
trace backpressure to make a test pass.

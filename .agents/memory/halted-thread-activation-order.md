---
name: Halted Thread activation order
description: Rules for turning a selected saved Thread image into the simulator's live stopped execution context.
---

A manual stopped-Thread switch is an invocation of canonical CHANGE, not a separate scheduler implementation. CHANGE must validate the incoming Thread descriptor, CR0–CR11 homes, and executable GT at +18 before saving or exposing any state. After saving the outgoing object, install incoming CR12 before restoring CR0–CR11, DR0–DR15, protected context, and the independent executable context.

**Why:** Ordinary register writes consult the active CR12 home, so restoring first can corrupt the outgoing image. CapabilityTest intentionally changes CR0 to SelfTest while executing CapabilityTest in CR14, proving CR14 cannot be derived from CR0. HALT and host call-frame state remain transient rather than serialized Thread fields.

**How to apply:** Keep Run/Walk guards in the UI, then call CHANGE with the ordinary CR14 descriptor. CHANGE performs read-only preflight, saves outgoing homes/+18/context, installs target CR12, projects incoming homes without write-through, and validates +18 through the shared header installer to produce matching CR6 and CR14 views. Invalid saved state faults before outgoing mutation.
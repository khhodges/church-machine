---
name: Button-free control trust
description: Approved custody and limits for the future development-profile maintenance protocol.
---

The owner accepted per-board control keys held by the IDE server and protected
board maintenance logic, not browser or bridge. Server compromise is a control
authority compromise. Initial provisioning and lost-key recovery require a
separately authorized trusted procedure; physical reprogramming/key extraction
are outside this development threat model.

**Why:** Server/bridge authorization does not authenticate UART commands to the
FPGA, and unchecked Phase 2 Passcodes cannot replace physical maintenance enable.
The owner explicitly selected server custody rather than a separate authority.

**How to apply:** Require board-verifiable authentication and qualified cross-reset
freshness; disable remote control if those cannot be provided. This design
approval grants no runtime changes, credentials, board commands, synthesis or
programming. Preserve frozen button-based evidence and existing ISA/Passcode rules.

---
name: Church-first hardware tracing
description: Default tracing scope and Turing breakpoint detail requested by the user.
---

Trace Church instructions by default until reaching a selected PetName and
specific Turing instruction set as a breakpoint. Always retain faults and the
breakpoint event itself.

**Why:** The user requested this rule while investigating the long backlog from
an arithmetic-heavy SelfTest trace. Trace delivery volume must not hide the
Church execution flow or the deliberate stopping instruction.

**How to apply:** Resolve breakpoint addresses from the exact uploaded image.
Do not enable broad Turing tracing merely because a breakpoint is armed.
The implemented interpretation retains detail after breakpoint arrival or an
explicit Step and returns to Church-only on Run. Activating a bridge update or
arming a physical breakpoint remains a separate operator action; investigations
do not authorize board commands or restarts.

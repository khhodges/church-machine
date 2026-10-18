---
name: Amobea Thread initialization ownership
description: All Thread initialization belongs to Amobea; distinguish fixture prerequisites from an operational lifecycle.
---

All Threads should be initialized by the Amobea abstraction. As of 2026-10-18,
the user explicitly states that this abstraction does not yet exist.
Do not confuse an Amobea design view or prototype with the initialization
service.

**Why:** The user clarified: “In truth all Thread should be initialized with
the Amobea abstraction, but that doe not yet exist.”

**How to apply:** Keep initialization ownership with Amobea, not Mint or
instruction microcode. Disposable tests may supply an initialized context
before admission to test capability use, but must label it as a prerequisite,
not successful Amobea execution or a complete Thread lifecycle. Do not add
implicit initialization, CALLs or preparation operations to CHANGE/SWITCH.

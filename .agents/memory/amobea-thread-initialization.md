---
name: Amobea Thread initialization ownership
description: All Thread initialization belongs to Amobea; distinguish fixture prerequisites from an operational lifecycle.
---

Mint always primes a Thread with Amoeba (spelled Amobea in earlier notes).
The supplied E-GT identifies the application abstraction Amoeba will start,
not Amoeba itself or a routine Mint should call to format the Thread.
All Threads should be initialized by that abstraction. As of 2026-10-18,
the user explicitly states that this abstraction does not yet exist.
Do not confuse an Amobea design view or prototype with the initialization
service.

**Why:** The user clarified: “In truth all Thread should be initialized with
the Amobea abstraction, but that doe not yet exist,” and later explicitly
specified “Mint always primes a thread with Amoeba.” The user then selected
“The application abstraction Amoeba will start” as the supplied E-GT's role.

**How to apply:** Distinguish Mint's required priming from Amoeba's initialization
work; do not move the latter into instruction microcode or a generic Mint
formatter. Preserve the application handoff without inventing its detailed ABI.
Disposable tests may supply an initialized context
before admission to test capability use, but must label it as a prerequisite,
not successful Amobea execution or a complete Thread lifecycle. Do not add
implicit initialization, CALLs or preparation operations to CHANGE/SWITCH.

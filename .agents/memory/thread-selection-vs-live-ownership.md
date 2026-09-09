---
name: Thread selection versus live ownership
description: Why a selected Thread slot does not always own the simulator register banks.
---

A configured or selected Thread slot is not proof that the live CR/DR bank belongs to that Thread. Reset and successful whole-image replacement leave a default selection but reset scratch registers; only successful boot or Thread restoration establishes ownership.

**Why:** Gating outgoing suspension on boot completion loses pre-boot Threads after the first manual restore, while treating the default selection as owned overwrites its dormant image with reset scratch state.

**How to apply:** Any Thread-switch lifecycle must gate outgoing validation and serialization on explicit live-bank ownership. Clear ownership when register state or the whole image is reset/replaced, preserve it on rejected atomic operations, and establish it only after a successful restore or boot transition. A boot reset must first suspend any owned pre-boot Thread, then synchronize the selected slot with the Thread boot installs.
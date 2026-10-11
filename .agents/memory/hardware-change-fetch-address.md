---
name: Hardware CHANGE fetch addresses
description: Full-core transition evidence must use absolute NIA and the real fetch port.
---

Full-core hardware transition probes must fetch from imem_addr rather than
adding CR14.base to NIA. Hardware NIA is an absolute byte address and the saved
CHURCH frame carries an absolute word address.

**Why:** A synthetic CR14-relative harness made CHANGE completion appear
successful with NIA zero, but the next instruction faulted against the real
absolute code fence. Only first-destination retirement exposed the mismatch.

**How to apply:** Check saved continuation bounds against the resolved code
address range, and require actual destination instruction retirement. Keep this
hardware address convention distinct from simulator word-index conventions.

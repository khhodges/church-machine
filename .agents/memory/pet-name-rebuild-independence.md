---
name: Pet-name rebuild independence
description: Architectural intent for removing provider-before-consumer LUMP rebuild ordering through Pet Name resolution.
---

The dependency-first rebuild order is a temporary safety rule, not the intended final architecture. Pet Names are intended to let a consumer name another abstraction without permanently binding itself to that provider's current compiled token or Namespace generation. Rebuilding SelfTest or WukongCallHome should therefore not require rebuilding CapabilityTest afterward merely to refresh embedded identities.

**Why:** Requiring providers to be rebuilt before every consumer recreates link-order coupling. Pet Names exist to preserve semantic references while concrete LUMP identities, tokens, slots, or generations change.

**How to apply:** Until name-based resolution and destination rebinding are proven end to end, rebuild providers first and consumers last. Treat that ordering as a compatibility safeguard. Future compiler, Mint, loader, and boot-image work should resolve Pet Names to the final canonical identities during binding and should include a regression proving that independently rebuilt providers do not stale their consumers.
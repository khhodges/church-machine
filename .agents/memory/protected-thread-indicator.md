---
name: Protected Thread indicator
description: Normative packing and save/restore semantics for machine-protected Thread word +17.
---

Do not conflate the live protected Thread indicator with a packed saved frame.
The earlier memory incorrectly assigned saved-frame NIA to the live indicator,
leading to the false claim that no running bit could fit without repacking.

**Why:** The two words have similar packing but different semantics. Current
shared layout and Amaranth reserve the live word's middle bits while saved
frames use those positions for NIA.

**How to apply:** Check both representations before proposing layout changes.
Live ownership metadata must never be restored from historical NIA bits.
The proposed running-bit allocation still needs approval and coordinated
writer/validator changes; finding reserved space is not proof of implementation.
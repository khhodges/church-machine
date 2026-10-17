---
name: Protected Thread indicator
description: Normative packing and save/restore semantics for machine-protected Thread word +17.
---

Do not conflate the live protected Thread indicator with a packed saved frame.
Do not assume that the complete live indicator is unchanged after a successful
RETURN merely because STO/SZ returns to the same root frame.

**Why:** The two words have similar packing but different semantics. Historical
reserved-bit descriptions are not reliable evidence of the current simulator
contract; live context can change independently of the retained root frame.

**How to apply:** Check both representations before proposing layout changes.
Diagnostic tests should capture exact raw indicators at each boundary, compare
STO/SZ for stack restoration, and require unchanged raw evidence across a
rejected poison-root RETURN and its later diagnostic export.
Live ownership metadata must never be restored from historical NIA bits.
The proposed running-bit allocation still needs approval and coordinated
writer/validator changes; finding reserved space is not proof of implementation.
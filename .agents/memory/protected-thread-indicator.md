---
name: Protected Thread indicator
description: Normative packing and save/restore semantics for machine-protected Thread word +17.
---

Thread word +17 is a machine-protected indicator with `FLAGS[31:28]`, reserved
bits `[27:13]`, `SZ[12]`, and `STO[11:0]`. It is outside the ordinary heap;
CR5 begins at +18.

**Why:** The indicator must preserve condition flags and distinguish whether
the current top frame includes an E-GT, without exposing this state through
software heap authority.

**How to apply:** A push stores the prior indicator fields in the frame word,
then installs the new frame's SZ and decremented STO in +17. RETURN restores
the prior fields. CHANGE refreshes FLAGS when saving and restores FLAGS when
loading. A machine reboot starts with the empty-stack indicator even when BRAM
retains an older runtime value.
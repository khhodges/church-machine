---
name: Alternative IDE prototype boundary
description: User priorities and isolation requirements for a simplified alternative IDE.
---

The user requires Thread Design and Namespace Design alongside Namespace,
CodeEdit, LUMP Side-by-Side, the compiler, and the bitstream builder.
Obsolete functionality may be retired to simplify the
experience, but this is not blanket permission to delete saved work or archives.

**Why:** The user reported repeated regressions during a layout transition and
wants a simpler alternative rather than more layers on the existing interface.

**How to apply:** Prototype on a separate URL alongside the existing site first.
Keep demo data, draft storage, and simulated compiler/build actions isolated
from the live IDE, Namespace, saved artifacts, and hardware. Adoption into the
real application requires a subsequent explicit request.

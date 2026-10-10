---
name: Wukong NS base is not ISA-safe at zero
description: The standalone Wukong image places Boot.NS at DMEM byte 0, but the ISA/platform contract reserves the high-memory namespace region
---

The user expects the Namespace table at the top of memory, not at address zero.
The standalone Wukong zero-base override is a bring-up shortcut, not the
intended architectural placement. Distinguish the retained image's actual
layout from the design when explaining register values.

**Why:** M-elevated boot tests can pass with the zero-base shortcut, but normal ISA operations and null-base guards do not establish that zero is a legal namespace root. A new factory image must not inherit this contradiction.

**How to apply:** Derive placement from the selected target's memory capacity
and the architectural inverted four-word slot layout. Do not promote historical
A7 addresses such as `0x1FC00` to a universal ISA constant, and do not silently
change frozen inputs while validating an initializer against a retained image.
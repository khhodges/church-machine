---
name: Namespace DNA containment
description: User-defined visual meaning of the Namespace DNA diagram.
---
The DNA diagram represents NS[1] itself. NS[1] must be the enclosing
page-filling box containing all Namespace slots, not a peer node alongside
its contents. Show Metadata Slot[0] and Slot[1] as text-line header information
on that enclosing box.

**Why:** The user explicitly described Namespace containment as the meaning
of this diagram, rather than a flat collection of equal boxes.

**How to apply:** Preserve slot identities and capability relationships while
rendering this hierarchy; this is a presentation requirement, not permission
to alter Namespace contents or hardware.

Unresolved dot.names need explicit “Unresolve” boxes and incoming connections,
distinct from allocated slots.

**Why:** The user requested visible destinations for unresolved names rather
than dangling connections.

**How to apply:** Group references by their retained name; never invent names
from raw slot numbers or treat NULL as an unresolved named reference.

Display dot.names alongside slot IDs on DNA boxes, not slot IDs alone.
**Why:** The user asked for readable object names, giving “NS[1]
Namespace.Boot” as the desired format.
**How to apply:** Prefer names retained in the exact inspected object's
self-definition and references; archived slot maps can describe a different
layout. Keep presentation labels distinct from retained identity evidence.

Keep image/build metadata inside the enclosing Namespace header, not in a
separate tall strip above it; remove repeated labels.
**Why:** The user explicitly requested less duplication and height.
**How to apply:** Use compact summaries with full identities and warnings
accessible through details, preserving installation-unverified status.

The total object-word count links to Memory Glass for the exact inspected
Namespace, never an unrelated default design.
The user approved one consistent image name and remembered exact selection
across DNA, Memory Glass and Build Approval, to simplify the IDE.
**Why:** Near-identical choices and newly invented labels made the same image
look like unrelated builds. Keep revision details separate from its display name.
**How to apply:** Restore inspection identity only; do not infer approval or
installed contents, and show unavailable evidence rather than selecting a replacement.
**Why:** The user requested the total as a navigable memory overview.
**How to apply:** Count each occupied slot once, show RAM versus MMIO in the
breakdown, and exclude unresolved placeholders. Experimental evidence stays
read-only when opened in Memory Glass.

Place the Memory Glass button at the far right of the enclosing box's top row,
not on an extra row.
**Why:** The user explicitly corrected the extra height. The previous link
also targeted the outer Replit frame instead of the app.
**How to apply:** Navigation from DNA must stay in the highest same-origin
IDE host, close the DNA modal, and preserve the exact Namespace selection;
never navigate the cross-origin preview shell via `_top`.

Complete DNA's asynchronous dialog-close cleanup before navigating away, and
skip restoring focus to its Testing launch control during navigation.
**Why:** A close event runs after `dialog.close()` returns; restoring focus
after switching pages leaves focus owned by the previous iframe. The user
reported returning to Testing despite fresh-load navigation checks passing.
**How to apply:** Test the completed close event, not only the destination
URL or a loaded-but-hidden iframe.

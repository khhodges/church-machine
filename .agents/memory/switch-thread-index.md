---
name: SWITCH Thread selection
description: User correction to fixed-slot-2 handoff assumptions during SecurityRegulator review.
---

SWITCH saves the outgoing Thread, changes Namespace between the save and load
halves of CHANGE, then loads the Thread whose slot is selected by the
instruction's index. The slot is not necessarily 2.

The destination Namespace GT is preloaded directly in any usable CRn. It is
not fetched through the older proposed source-C-list/row lookup. Do not assume
that “usable” approves a particular register range or removes protected-register
rules.

**Why:** The user explicitly corrected the review's fixed-entry-Thread claim.
Older ISA prose and diagnostics must not override this correction.

**How to apply:** Reconcile direct Namespace input and Thread-index semantics before
freezing SWITCHM's signature or encoding. Do not silently equate the Thread
index with the older proposed source C-list row. This review correction alone
does not authorize hardware changes.

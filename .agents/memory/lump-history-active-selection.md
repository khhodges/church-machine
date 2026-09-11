---
name: LUMP History active selection
description: How historical selection and bootstrap correction create a new live LUMP without rewriting immutable evidence.
---

An archived LUMP revision becomes active through the History “This” checkbox,
which invokes the existing approval-backed restore transition. The live result is
a fresh monotonic revision containing the selected immutable bytes; do not
retag or overwrite an old version in place.

**Why:** Version numbers identify immutable history entries. Reusing an old
version number as the live entry would collide with its archive, make later
saves overwrite history, and weaken the integrity trail.

**How to apply:** Show one checked disabled checkbox for the current live
revision. Enable the checkbox only for validated, approved, non-historical
archives. Keep invalid or legacy records inspectable and deletable but unable to
become live.

An archived bootstrap identity mismatch may be corrected only by issuing a new
live revision through a server-derived, approval-bound plan. The repair may
change the sealed c-list row-zero SELF GT to the current frozen Namespace
binding and reissue the resulting canonical Token/T; it must never change the
historical archive or its old record token.

**Why:** Historical invalid bytes remain important evidence. Allowing a client
to patch them in place would erase the reason the repair was needed and break
the immutable history contract.

**How to apply:** Bind a repair plan to the exact archive hash, live manifest
identity, expected Namespace GT, and one-time approval intent. Revalidate each
of those facts immediately before the normal atomic history transition.
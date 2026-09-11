---
name: LUMP History active selection
description: How a programmer chooses an archived revision to become the live LUMP.
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
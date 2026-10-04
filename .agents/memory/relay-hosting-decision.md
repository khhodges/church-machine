---
name: Relay hosting decision
description: Approved hosting boundary for the stateful Wukong relay.
---

The user approved configuring Reserved VM for the next publish on 2026-10-04,
without authorizing an immediate republish or saved-artifact changes.

**Why:** The relay's in-memory command and fault correlation cannot safely be
split among Autoscale instances. One Gunicorn worker is not a single-instance
hosting guarantee.

**How to apply:** Preserve the always-on, single-process deployment requirement
unless shared durable coordination is implemented and explicitly approved.
Configuration changes do not establish that the live site has been republished.
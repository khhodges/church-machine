---
name: Bridge pairing restart boundary
description: Persistence and operational safety constraints for paired hardware bridges.
---
Pairing persistence is local to one IDE installation, not a portable credential backup. Keep private grant state out of source control and deployment packages; do not renew expiry on restart.

**Why:** Operators need server restarts to preserve an already-running bridge without copying the server authority secret to the bridge or extending its authorization indefinitely.

**How to apply:** Test restarts with isolated stores and fresh processes. Never issue board commands for pairing tests. Notify the user before restarting an active paired IDE; an initial upgrade from memory-only grants cannot recover those existing credentials.

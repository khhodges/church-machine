---
name: Wukong operator device identity
description: Confirmed continuity of the physical board and its configured control-routing UID.
---

On 2026-10-29 the user confirmed the currently programmed Wukong is the same
physical board used on October 26. Reuse its previously recorded operator UID
`20250619ac5c01` for bridge/IDE target configuration.

**Why:** The bridge can monitor COM3 while reporting an empty UID. The user
confirmed physical continuity with the prior recorded board; COM3 alone would
not establish it. This is an operator-provisioned identity, not UART attestation
or proof of a silicon serial number.

**How to apply:** Keep bridge and explicit IDE target selection consistent.
Never infer a UID from a port or session, and reconfirm identity if the physical
board changes. Configuration confirmation does not authorize board commands,
reprogramming, persistent flash changes, or a new image installation.

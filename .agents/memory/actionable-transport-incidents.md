---
name: Actionable transport incidents
description: How repeated transport diagnostics become one durable, dismissible user alert.
---

Terminal connection failures must stay latched as the active incident until recovery is demonstrated by a fresh successful health signal. Later low-level retry/read errors may enrich diagnostics, but must not downgrade or replace the actionable diagnosis.

**Why:** A terminal reconnect failure can be followed immediately by another routine read error. Treating only the latest event as truth makes the useful recovery guidance disappear before a browser polls.

**How to apply:** Keep transient events in bounded diagnostics, not execution logs. Give each sustained incident a stable identity; allow its guidance to escalate in place, respect dismissal for that identity, and mint a new identity only after proven recovery.
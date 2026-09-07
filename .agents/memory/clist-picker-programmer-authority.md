---
name: C-List picker programmer authority
description: The capability picker must accept dynamic and future pet names, not only currently materialized LUMPs.
---

The C-List picker is a declaration tool, not an inventory gate. It must expose live and committed Namespace pet names while also allowing a programmer to declare a valid symbolic pet name before its abstraction exists or has a slot.

**Why:** The programmer controls capability naming and future binding. Requiring a current manifest record or duplicated slot metadata incorrectly prevents forward declarations and dynamic Namespace use.

**How to apply:** Treat Namespace state as authoritative when a name is bound, prefer live dynamic names over saved labels, and keep unbound names selectable as symbolic declarations. Resolve and validate their concrete GTs later without bypassing permission or bounds checks.
---
name: Executed-artifact freshness warning
description: User-facing rule for distinguishing a valid committed boot image from the latest successful compilations.
---

A valid, provenance-approved boot image may intentionally contain older LUMPs. The IDE must prominently and persistently identify every committed Namespace artifact that differs from the latest successful compilation for that abstraction.

**Why:** Restoring an older approved resident image made the IDE boot, but the user was blindsided because “boot works” was reported without an equally prominent warning that newer successfully compiled code was not executing.

**How to apply:** Treat boot validity and execution freshness as separate statuses. Show selected and latest versions before simulation, keep the warning visible while they differ, and never describe a successful boot as proof that current source is running.
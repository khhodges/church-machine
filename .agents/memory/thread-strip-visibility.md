---
name: Persistent Thread strip
description: User requirement for Thread visibility across IDE views and execution states.
---

The configured Thread strip should show all the time, including CR12 inspection,
before boot and after Reset.

**Why:** The user saw three Threads disappear in the CR12 view and explicitly
stated, “it should show all the time.”

**How to apply:** Keep Thread visibility independent of register selection and
execution state. Distinguish configured context from live runtime values without
inventing running state or changing machine authority just to populate the UI.

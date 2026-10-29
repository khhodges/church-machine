---
name: GitHub source-control access
description: Distinguish connector lookup failures from the working secure GitHub proxy.
---
An active GitHub Source Control connection can work through `git` and `gh`
even when connector discovery reports connect or returns no connection.
Do not repeatedly ask the user to reconnect based only on that lookup.

**Why:** Repository pushes and release metadata creation succeeded through the
documented secure Git provider proxy while the connector lookup was unusable.

**How to apply:** Use the documented `gh` interface without extracting credentials.
Test release asset upload separately from metadata creation: binary upload
requests returned HTTP 400 even though release creation worked. Keep incomplete
releases in draft and report asset-upload failures rather than claiming completion.

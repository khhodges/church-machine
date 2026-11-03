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

Always explicitly select the intended GitHub repository for backup checks.

**Why:** The default `gh` repository selection can differ from Git `origin`
when multiple historical GitHub remotes are configured. An empty release list
from the default repository is not evidence that the origin has no releases.

**How to apply:** Check the sanitized origin identity and pass `--repo` or an
explicit repository API path. Check repository visibility before exporting
live user data; an existing code repository is not necessarily private.

---
name: Release candidate completeness
description: Qualify full build and served asset coverage, not only API import success.
---
An isolated release candidate must include and test the configured deployment
build inputs and public static assets, not merely the main server source.

**Why:** A server/catalog smoke pass can miss omitted secondary build artifacts
and static directories. Even a full Git archive can omit ignored or untracked
images that existing pages serve.

**How to apply:** Preserve frozen source identities, execute the actual configured
build in private installation/cache destinations, and check direct asset
references on representative public pages. Record any supplemental untracked
runtime assets with hashes and explicit origin rather than calling them part
of the frozen Git snapshot. Test installed native dependencies with the
interpreter used by the build. Passing packaging checks does not certify
production data recovery or hardware behavior.

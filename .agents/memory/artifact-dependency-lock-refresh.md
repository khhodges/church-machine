---
name: Artifact dependency lock refresh
description: How to recover a newly added pnpm-filtered artifact that cannot resolve its local Vite executable.
---

When a newly added artifact workflow fails with `vite: command not found`, first check whether its package is absent from the current pnpm lock/importer graph. A frozen or offline install may fail because the root manifest has moved ahead of the lockfile or the local package mirror lacks Replit plugin metadata.

**Why:** The workflow can correctly find the artifact package through its pnpm filter while the executable remains unavailable because dependencies were never linked after the artifact was added.

**How to apply:** Refresh dependencies from the existing manifests with a normal `pnpm install` when the offline/frozen attempt identifies lock drift or unavailable cached metadata, then restart only the artifact workflow. Validate with the artifact's configured `PORT` and `BASE_PATH`; its standalone Vite config requires both.
---
name: GitHub mirror stale via workflow-scope rejection
description: Post-merge GitHub sync silently fails when a commit touches .github/workflows and PAT lacks workflow scope
---

- Once any commit touches `.github/workflows/*`, every `git push` with a PAT lacking the `workflow` scope is rejected — the mirrors (khhodges/s-ide-v1, khhodges/church-machine) go stale silently while the user's `git pull` reports "up to date".
- The Resend failure alert also fails (churchmachine.io domain unverified), making the failure doubly silent.
- Workaround: PUT individual changed files via the Contents API (repo scope suffices) — see github-api-put-delivery.md.
- **How to apply:** if a remote checkout is mysteriously missing recent fixes, check sync-to-github push results before debugging anything else. Real fix = regenerate PAT with `workflow` scope.

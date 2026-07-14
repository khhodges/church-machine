---
name: GitHub API PUT for cross-repo file delivery
description: When git histories have diverged (after force-push), use the GitHub Contents API to deliver individual files rather than fighting history merges.
---

## The rule

When the Replit repo and a remote build machine (e.g., a DigitalOcean droplet) have diverged histories due to force-pushes, `git push` from Replit fails non-fast-forward, and `git pull` on the droplet brings in conflicting commits.

**Delivery pattern that works:**
1. Use `curl` + `GITHUB_PAT` from Replit's bash environment to PUT individual files via the GitHub Contents API:
   ```bash
   SHA=$(curl -s -H "Authorization: token $GITHUB_PAT" \
     "https://api.github.com/repos/OWNER/REPO/contents/PATH?ref=main" \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sha',''))")
   CONTENT=$(base64 -w0 path/to/file)
   curl -s -X PUT -H "Authorization: token $GITHUB_PAT" \
     -H "Content-Type: application/json" \
     "https://api.github.com/repos/OWNER/REPO/contents/PATH" \
     -d "{\"message\":\"...\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\",\"branch\":\"main\"}"
   ```
2. On the droplet (receiving end), pull just those files without a full history merge:
   ```bash
   git fetch origin
   git checkout origin/main -- hardware/soc_combined/firmware/main.c hardware/soc_combined/firmware/Makefile
   ```

**Why:** `code_execution` sandbox does NOT have access to `process.env.GITHUB_PAT` — use the Replit bash environment (`$GITHUB_PAT`) instead. The `base64 -w0` flag prevents line-wrapping in the encoded content.

**How to apply:** Any time firmware source or scripts need to reach a build machine that has a diverged git history. The PUT approach creates a new commit directly on the GitHub branch without requiring the local machine to have a compatible history.

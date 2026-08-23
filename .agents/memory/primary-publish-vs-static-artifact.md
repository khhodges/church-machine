---
name: Primary publish vs static artifact
description: How to recognize and prevent a nested static artifact from replacing the main IDE deployment.
---

In this multi-artifact project, a publish initiated for the Introduction artifact can make the production custom domain serve that artifact at `/` instead of running the primary IDE web service, even while the root project configuration still declares the correct autoscale command.

**Why:** A republish registered `artifact mode enabled runnable=0 static=1` and mounted the Introduction artifact's static output at `/`. The custom domain returned HTTP 200 but appeared blank because it was no longer the Flask IDE deployment.

**How to apply:** When the custom-domain root changes unexpectedly after publishing, inspect deployment metadata and logs rather than assuming DNS failure. Restore/select the primary autoscale deployment and verify logs show the Gunicorn service, not a static artifact mounted at `/`.
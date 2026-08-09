---
name: networkidle never fires on /simulator/
description: Playwright waitForLoadState('networkidle') deterministically times out on the simulator page
---
The simulator page runs background polling (Ti60 status watchers etc.) that keeps network activity alive indefinitely, so Playwright's `page.waitForLoadState('networkidle')` never fires and times out deterministically.

**Why:** Group 7 of startup_wizard.spec.js silently failed on page load for this reason; ~20 other e2e specs still use 'networkidle' and may share latent flakiness.

**How to apply:** In e2e tests, wait for a concrete readiness signal instead — `domcontentloaded` plus `waitForFunction` for the globals the test needs (e.g. `StartupWizard`, `switchView`, `switchBuilderViewTab`). See `waitForAppReady()` in tests/e2e/startup_wizard.spec.js.

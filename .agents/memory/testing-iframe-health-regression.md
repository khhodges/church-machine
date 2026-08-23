---
name: Testing iframe health regression
description: Browser tests for Builder Testing must distinguish iframe persistence from live FPGA telemetry.
---

The Builder Testing panel is a persistent iframe, but its FPGA status page polls asynchronously and may auto-collapse health details when the board is disconnected. Browser regressions for tab navigation should stub or abort telemetry endpoints, then assert the real iframe control state and load count.

**Why:** Live polling can race a manual toggle and make a persistence test fail for the wrong reason; a malformed status-page script can also leave static controls visible while preventing their handlers from initializing.

**How to apply:** Keep navigation/state assertions in Playwright against the iframe, isolate unrelated telemetry, and run a standalone JavaScript syntax check for `server/fpga_status.html` when changing its inline script.
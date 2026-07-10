---
name: Simulator E2E boot-state testing
description: How to reliably establish cold-boot simulator state in Playwright E2E tests for the Church Machine IDE.
---

## The pattern that works

```javascript
// 1. Pre-suppress modals before page load
await page.addInitScript(() => {
    localStorage.setItem('church_whatsnew_dismissed_perm', '1');
});

// 2. Intercept the boot binary
await page.route('**/api/boot-image/binary', route =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'no binary' })
);

await page.goto('/simulator/');
await page.waitForLoadState('networkidle');

// 3. Clear boot state THEN reset — order matters
await page.evaluate(() => {
    window.bootImage = null;
    window.bootImageAvailable = false;
    window.bootConfig = null;
    if (typeof sim !== 'undefined') sim.reset(); // → nsCount = 7
});
await page.waitForTimeout(300);

// Suite 2 only: force bootComplete before compileAndCreateAbstraction()
await page.evaluate(() => { sim.bootComplete = true; });
```

## Why instantBoot() doesn't work in tests

`instantBoot()` runs `sim._bootStep()` synchronously in a while-loop (30 iterations).
Boot phase **B:04 CALL_HOME** starts an async network fetch inside `_bootStep()`.
The fetch's `.then()` callback (which increments `bootStep` from 4 → 5) is a
Promise microtask — it cannot run while the synchronous while-loop is executing.
Result: `instantBoot()` runs 30 iterations all stuck at `bootStep = 4` and returns
`false` with `bootComplete` still false.

## Why slowBoot() doesn't work after sim.reset() in a test

`slowBoot()` has the guard: `if (bootAnimating || sim.bootComplete || sim.halted) return;`

The page's own auto-boot (fired during page load) sets `bootAnimating = true`.
`sim.reset()` does NOT clear `bootAnimating` (it's an app-run.js module variable,
not a `sim` property). So a subsequent `slowBoot()` call exits immediately.

## Why resetSim() crashes Chromium in tests

`resetSim()` calls `switchView('dashboard')` and other DOM mutation functions
synchronously from inside `page.evaluate()`. This causes a Chromium process crash
("ESRCH: No such process") in the Replit sandbox environment.

## Why forcing sim.bootComplete = true is correct for NS-slot tests

`compileAndCreateAbstraction()` has exactly one guard: `if (!sim.bootComplete)`.
It does NOT use CR14, memory layout, or any other hardware boot output.
Navana.Abstraction.Add (the slot allocator) calls `sim.writeNSEntry()` which is
pure JS. Forcing `bootComplete = true` is the minimal, correct intervention.

**Why:** `bootComplete` is a JS flag, not hardware state. The NS slot allocation
pathway is entirely JS-side and doesn't depend on the hardware boot phases.

## What's New modal

The `#whatsNewModal` blocks clicks on the hamburger menu and other UI elements.
It is suppressed by `localStorage.setItem('church_whatsnew_dismissed_perm', '1')`.
Use `page.addInitScript()` (not `page.evaluate()` after goto) so it runs before
the page's JS reads localStorage on startup.

## nsCount after cold boot

After `sim.reset()` with `window.bootImage = null`, `_initNamespaceTable()` calls
`_getHardwareBootCatalog()` which returns 7 entries (slots 0–6). `sim.nsCount = 7`.
Slot 7 is null/programmable and produces no NS table row.

## When Playwright navigation itself is flaky, drop to a Node harness instead

Fresh Playwright contexts sometimes landed on inconsistent pages (editor vs.
"FPGA Disconnected" vs. `window.sim` undefined) when trying to reproduce a
specific fault (e.g. capability-resolution bugs in `_injectClistNow`). This
was navigation/environment flakiness, not a real bug — confirmed by writing a
plain Node script that requires `simulator.js`/`app-run.js` directly (same
technique as `scripts/check_selftest_lump_stale.js`), drives boot + assemble +
run programmatically, and copies the exact logic under test verbatim. This
gives a deterministic, fast repro and isolates "is the fix correct" from "is
Playwright navigating correctly today". Prefer this over retrying flaky
browser E2E when the bug is deep in simulator state logic rather than DOM/UI.

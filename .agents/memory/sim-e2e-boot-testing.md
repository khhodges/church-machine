---
name: Simulator E2E boot-state testing
description: How to reliably establish cold-boot simulator state in Playwright E2E tests for the Church Machine IDE.
---

## The pattern that works (NS-slot tests — no real boot image needed)

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

## The pattern that works (full boot via real binary — step/run tests)

```javascript
await page.addInitScript(() => {
    localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    localStorage.setItem('churchMachine_autoBootOnOpen', '0');
    // CRITICAL: set bootEntrySlot to 6 (Boot.Abstr post slot-3→6 migration).
    // Without this, _applyBootEntryToSim() finds LED_DEV (slot 3) valid and
    // clobbers sim.bootEntrySlot to 3 → B:06 NUC_CLIST faults with magic=0x0.
    localStorage.setItem('bootEntrySlot', '6');
});
await page.goto('/simulator/');
await page.waitForLoadState('networkidle');

// Wait for boot image fetch + sim.loadBootImage() overlay to complete.
await page.waitForFunction(
    () => typeof sim !== 'undefined'
       && typeof instantBoot === 'function'
       && window.bootImageAvailable === true,
    { timeout: 10000 }
);

// Call instantBoot() directly — synchronous 8-phase loop, no async I/O.
const bootResult = await page.evaluate(() => {
    const ok = instantBoot();
    if (ok) return { ok: true };
    return { ok: false, bootStep: sim.bootStep, halted: sim.halted,
             bootComplete: sim.bootComplete,
             faultLog: JSON.stringify((sim.faultLog||[]).slice(0,5)),
             output: (sim.output||'').slice(-800) };
});
if (!bootResult.ok) throw new Error(`instantBoot() failed — ${JSON.stringify(bootResult)}`);

// instantBoot() called directly does NOT call switchView('dashboard').
// Must do it explicitly so #toolStepBtn is visible for subsequent clicks.
await page.evaluate(() => switchView('dashboard'));
```

## bootEntrySlot localStorage trap (slot-3→6 migration)

`_applyBootEntryToSim()` reads the **module-level `bootEntrySlot` variable**
(declared in `app-abstractions.js`, init'd from localStorage). In a fresh test
environment, localStorage has no `bootEntrySlot` key → the variable defaults to
**3** (the pre-migration value). `sim.isNSEntryValid(3)` is **true** (LED_DEV IS
a valid NS entry in the binary NS table), so the fallback branch is NOT taken,
and `sim.bootEntrySlot` is **overwritten to 3**.

This overrides the correct value (6) that `sim.loadBootImage()` already read from
the binary's tag (`NS_TABLE_BASE - 2`). B:05 INIT_ABSTR then loads LED_DEV, and
B:06 NUC_CLIST faults: "LED_DEV lump header magic=0x0".

**Fix:** `addInitScript(() => localStorage.setItem('bootEntrySlot', '6'))`.

**Why:** The module-level variable initialises before the binary is fetched;
`_applyBootEntryToSim()` must see 6 in localStorage so it doesn't overwrite the
value that `sim.loadBootImage()` correctly derived from the binary.

## Do NOT call sim.reset() from page.evaluate() in full-boot tests

`sim.reset()` was already called by `init()` during page load.  A second call
from `page.evaluate()` re-fires the 'reset' event, triggering `updateDashboard()`
and other DOM handlers that can interfere with in-flight page state.  It also
does NOT re-call `_applyBootEntryToSim()`, so if there is any stale
module-level `bootEntrySlot` it stays stale.

After page load with `bootImageAvailable === true`, the sim is already in the
correct pre-boot state: `bootComplete=false`, `bootStep=0`, `halted=false`, and
`sim.memory` has the binary overlay from the `.then()` handler.  Just call
`instantBoot()` directly.

## Why instantBoot() works (CALL_HOME is synchronous in the simulator)

**Old note claimed** B:04 CALL_HOME starts an async network fetch → the while-loop
stalls at bootStep=4.  **This is wrong for the simulator context.**

In the browser simulator, B:04 CALL_HOME calls `abstractionRegistry.dispatchMethod`
synchronously (no real network fetch), so `instantBoot()`'s while-loop advances
through all 8 phases (B:00–B:07) and returns `true`.

The async-fetch problem only occurs when the test intercepts or blocks
`/api/boot-image/binary` (the 404 pattern above) — in that case `instantBoot()`
cannot advance past B:04 because the NS table data is never loaded.

## instantBoot() called directly does NOT switch the view

`stepSim()` calls `switchView('dashboard')` after `instantBoot()` returns.
Calling `instantBoot()` directly from `page.evaluate()` bypasses that.  The page
stays on the Home panel where the toolbar is hidden.  Always call
`switchView('dashboard')` from `page.evaluate()` after `instantBoot()`.

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

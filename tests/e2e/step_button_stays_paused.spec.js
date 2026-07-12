'use strict';

// step_button_stays_paused.spec.js — Playwright E2E test
//
// Verifies that clicking the Step button does NOT trigger continuous execution
// after boot completes. Two scenarios are covered:
//
//   Scenario A (Path 1 — instant boot):
//     A compiled program is pending in the assembler buffer (_pendingSimLoad=true).
//     One click of the Step button triggers instantBoot() then returns paused.
//     The simulator must stay paused — no walk or run loop may start.
//
//   Scenario B (Path 2 — manual boot ceremony):
//     No pending program. The user clicks Step 8 times to step manually through
//     all 8 boot phases (B:00…B:07). After the final click the simulator must
//     be paused — not in a continuous run loop.
//
// Approach:
//   Auto-boot is disabled via localStorage before page load (prevents slowBoot()
//   from starting automatically and eventually calling runSimGo() which puts the
//   sim into continuous execution mode).
//
//   loadSimulator() then calls sim.reset() + instantBoot() explicitly from
//   page.evaluate().  sim.reset() fires the 'reset' event, which causes
//   _maybeApplyBootImage() to apply window.bootImage (if the server has one) to
//   sim.memory.  instantBoot() runs all 8 boot phases synchronously (B:04
//   CALL_HOME is offline-safe and fully synchronous — no async fetch).
//
//   Each scenario then forces sim.bootComplete=false / sim.bootStep=0 to put
//   the sim back in pre-boot state, so the Step click(s) exercise the real path.
//
//   Key assertions (assertPausedState):
//     - sim.bootComplete === true  (boot finished)
//     - sim.halted === false        (machine alive)
//     - sim.running === false       (no batch in flight)
//     - sim.stepCount unchanged over 1300 ms  (no walk/run loop ticking)
//     - #dashboard has class "active"  (UI landed on the dashboard)
//     - #toolStepBtn visible and enabled
//
// Boot phase count:
//   B:00 FAULT_RST → B:01 LOAD_NS → B:02 INIT_THRD → B:03 INIT_HEAP →
//   B:04 CALL_HOME → B:05 INIT_ABSTR → B:06 NUC_CLIST → B:07 NUC_CODE (sets bootComplete).
//   Eight total phases → Scenario B requires 8 Step clicks.

const { test, expect } = require('@playwright/test');

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Load the simulator page with auto-boot disabled, then explicitly run
 * sim.reset() + instantBoot() for a deterministic, fully-booted start state.
 *
 * Why disable auto-boot?
 *   The auto-boot path fires slowBoot(), which runs one _bootStep() per 800ms
 *   timer tick and calls runSimGo() on completion.  If runSimGo() starts before
 *   we reset sim.bootComplete=false for the test, the running batch interferes.
 *
 * Why instantBoot() works here:
 *   B:04 CALL_HOME is fully synchronous (it calls abstractionRegistry.dispatchMethod,
 *   not a network fetch).  All 8 phases complete in one while-loop pass.
 *
 * Boot setup in loadSimulator():
 *   - addInitScript sets localStorage 'bootEntrySlot'='6' before page load so
 *     the module-level bootEntrySlot variable (app-abstractions.js) initialises
 *     to slot 6 (Boot.Abstr).  Without this, _applyBootEntryToSim() finds slot 3
 *     (LED_DEV) valid and overwrites sim.bootEntrySlot to 3, causing B:06
 *     NUC_CLIST to fault with "LED_DEV lump header magic=0x0".
 *   - We wait for window.bootImageAvailable===true (boot image fetch complete and
 *     sim.loadBootImage() overlay applied) before calling instantBoot().
 *   - We do NOT call sim.reset() from the test — init() already called it, and
 *     a second reset would re-fire event handlers and potentially break state.
 */
async function loadSimulator(page) {
    await page.addInitScript(() => {
        // Suppress What's New modal so it cannot block UI clicks.
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        // Disable the auto-boot checkbox so the page's .then() handler
        // does NOT call resetSim() → slowBoot() → runSimGo() automatically.
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        // Set the module-level bootEntrySlot to 6 (Boot.Abstr, post slot-3→6
        // migration).  Without this, the variable initialises from localStorage
        // (null → default 3), and _applyBootEntryToSim() checks
        // sim.isNSEntryValid(3) → LED_DEV IS valid → sets sim.bootEntrySlot=3,
        // overriding the correct value (6) that sim.loadBootImage() read from
        // the binary.  B:05 INIT_ABSTR then loads the wrong slot and B:06
        // NUC_CLIST faults with "LED_DEV lump header magic=0x0".
        localStorage.setItem('bootEntrySlot', '6');
    });
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    // Wait for the simulator object, the instantBoot global function, AND the
    // boot image probe to have resolved.  sim.loadBootImage() is called inside
    // the _probeBootImage().then() handler (app-shell.js) — once
    // window.bootImageAvailable is true, sim.memory already has the correct
    // lump data that B:06 NUC_CLIST and B:07 NUC_CODE need to read.
    //
    // NOTE: we do NOT call sim.reset() here.  sim.reset() was already called by
    // init() at page-load time and populated sim.memory via _initNamespaceTable().
    // Calling it again from page.evaluate() would re-emit 'reset', which triggers
    // updateDashboard() and other DOM handlers that can interfere with in-flight
    // page state.  The sim is already in the correct pre-boot state:
    //   bootComplete=false, bootStep=0, halted=false, memory=bootImage overlay.
    await page.waitForFunction(
        () =>  typeof sim !== 'undefined'
            && typeof instantBoot === 'function'
            && window.bootImageAvailable === true,
        { timeout: 10000 }
    );

    // Call instantBoot() directly — all 8 phases run synchronously (B:04
    // CALL_HOME calls abstractionRegistry.dispatchMethod, no network fetch).
    // If it fails, surface diagnostics so the cause is visible in CI output.
    const bootResult = await page.evaluate(() => {
        const ok = instantBoot();
        if (ok) return { ok: true };
        return {
            ok: false,
            bootComplete: sim.bootComplete,
            halted:       sim.halted,
            bootStep:     sim.bootStep,
            faultLog:     JSON.stringify((sim.faultLog || []).slice(0, 5)),
            output:       (sim.output || '').slice(-800),
        };
    });

    if (!bootResult.ok) {
        throw new Error(
            `instantBoot() failed in loadSimulator() — ` +
            `bootStep=${bootResult.bootStep}, halted=${bootResult.halted}, ` +
            `bootComplete=${bootResult.bootComplete}\n` +
            `faultLog: ${bootResult.faultLog}\n` +
            `sim.output (tail): ${bootResult.output}`
        );
    }

    // Switch to dashboard so the toolbar (#toolStepBtn, #toolRunBtn, etc.) is
    // visible.  instantBoot() called directly (not via stepSim()) does NOT
    // trigger a view switch.  Without this the tests wait forever for
    // #toolStepBtn to become visible, because the page stays on the Home panel
    // where the toolbar is hidden.
    await page.evaluate(() => switchView('dashboard'));
}

/**
 * Assert that the simulator is fully paused after a Step-triggered boot:
 *   - Boot is complete and the machine is alive.
 *   - No continuous run/walk loop has started.
 *   - stepCount does not advance over the next 1300 ms (covers one walk tick).
 *   - The dashboard view is active.
 *   - The Step button is still visible and enabled.
 */
async function assertPausedState(page) {
    const state = await page.evaluate(() => ({
        bootComplete: sim.bootComplete,
        halted:       sim.halted,
        running:      sim.running,
        stepCount:    sim.stepCount,
    }));

    expect(state.bootComplete, 'sim.bootComplete must be true after Step through boot').toBe(true);
    expect(state.halted,       'machine must not be halted after clean boot').toBe(false);
    expect(state.running,      'sim.running must be false — no batch loop active').toBe(false);

    // Wait longer than one walk tick (600–1000 ms) so a spurious loop would show up.
    await page.waitForTimeout(1300);

    const stepCountAfter = await page.evaluate(() => sim.stepCount);
    expect(stepCountAfter, 'stepCount must not increase — no continuous execution loop').toBe(state.stepCount);

    // Dashboard must be the active view (switchView('dashboard') called by stepSim
    // on boot completion for both Path 1 and Path 2).
    const dashPanel = page.locator('#dashboard');
    await expect(dashPanel).toHaveClass(/\bactive\b/, { timeout: 3000 });

    // Step button must still be visible and interactive.
    const stepBtn = page.locator('#toolStepBtn');
    await expect(stepBtn).toBeVisible();
    await expect(stepBtn).not.toBeDisabled();
}

// ─── Scenario A — instant boot (stepSim Path 1) ───────────────────────────────
//
// When _pendingSimLoad is truthy, one click of Step calls instantBoot()
// synchronously (all 8 phases run in a tight while-loop, no async I/O),
// loads the assembled program, and returns paused.
// Continuous execution must NOT start.

test.describe('Step button stays paused — Scenario A (instant boot, Path 1)', () => {

    test('one Step click with a pending compiled program does not start continuous execution', async ({ page }) => {
        test.setTimeout(60000);

        await loadSimulator(page);

        // ── 1. Assemble a minimal NOP program so _pendingSimLoad becomes true ──
        //
        // assembleAndLoad() is a global function.  It reads from #asmEditor,
        // assembles the source, writes to lastAssembledWords, and sets the
        // module-level _pendingSimLoad = true.
        await page.evaluate(() => {
            const editor = document.getElementById('asmEditor');
            if (editor) editor.value = 'NOP';
        });
        await page.evaluate(() => assembleAndLoad());
        await page.waitForTimeout(200);

        // ── 2. Force the sim back to pre-boot state ────────────────────────────
        //
        // stepSim() enters the boot branch only when sim.bootComplete === false.
        // Setting bootStep=0 ensures _bootStep() starts from B:00.
        // _pendingSimLoad remains true (set by assembleAndLoad above) — stepSim()
        // will take the instantBoot path.
        await page.evaluate(() => {
            sim.bootComplete = false;
            sim.bootStep     = 0;
            sim.halted       = false;
            sim.running      = false;
        });

        // ── 3. Click Step once — triggers the instant-boot path ───────────────
        //
        // stepSim() sees: !bootComplete && _pendingSimLoad === true
        //   → calls instantBoot() (8 synchronous phases)
        //   → loads the NOP program
        //   → calls switchView('dashboard')
        //   → returns WITHOUT calling runSimGo() or walkToggle()
        const stepBtn = page.locator('#toolStepBtn');
        await stepBtn.waitFor({ state: 'visible' });
        await stepBtn.click();

        // Allow click handler and any microtasks to settle.
        await page.waitForTimeout(400);

        // ── 4. Assert paused state ─────────────────────────────────────────────
        await assertPausedState(page);
    });

});

// ─── Scenario B — 8-click manual boot ceremony (stepSim Path 2) ──────────────
//
// When _pendingSimLoad is false and bootComplete is false, each Step click
// advances one boot phase:
//   Click 1 → B:00 FAULT_RST    (bootStep: 0→1)
//   Click 2 → B:01 LOAD_NS      (bootStep: 1→2)
//   Click 3 → B:02 INIT_THRD    (bootStep: 2→3)
//   Click 4 → B:03 INIT_HEAP    (bootStep: 3→4)
//   Click 5 → B:04 CALL_HOME    (bootStep: 4→5)
//   Click 6 → B:05 INIT_ABSTR   (bootStep: 5→6)
//   Click 7 → B:06 NUC_CLIST    (bootStep: 6→7)
//   Click 8 → B:07 NUC_CODE     (bootComplete=true, bootStep stays at 7)
//
// After click 8, stepSim() sees sim.bootComplete===true, calls
// switchView('dashboard'), and returns.  runSimGo() is NOT called by
// the manual-step path (only slowBoot() calls runSimGo() after animation).
// The machine must be paused.

test.describe('Step button stays paused — Scenario B (manual boot, 8 clicks, Path 2)', () => {

    test('stepping through all 8 boot phases manually leaves the sim paused', async ({ page }) => {
        test.setTimeout(60000);

        await loadSimulator(page);

        // ── 1. Force pre-boot state (no pending program) ──────────────────────
        //
        // _pendingSimLoad is already false (assembleAndLoad() was not called).
        // stepSim() will take the manual-stepping branch: one _bootStep() call
        // per click.
        await page.evaluate(() => {
            sim.bootComplete = false;
            sim.bootStep     = 0;
            sim.halted       = false;
            sim.running      = false;
        });

        const stepBtn = page.locator('#toolStepBtn');
        await stepBtn.waitFor({ state: 'visible' });

        // ── 2. Click Step 8 times — one per boot phase ────────────────────────
        //
        // B:07 NUC_CODE (click 8) sets bootComplete=true.  stepSim() then
        // calls _autoLoadDefaultProgram(), switchView('dashboard'), and returns —
        // without calling runSimGo() (that is only done by slowBoot()).
        for (let phase = 1; phase <= 8; phase++) {
            await stepBtn.click();
            // Small pause so DOM updates and the next click sees correct state.
            await page.waitForTimeout(150);
        }

        // Allow final DOM callbacks to settle.
        await page.waitForTimeout(400);

        // ── 3. Assert paused state ─────────────────────────────────────────────
        await assertPausedState(page);
    });

});

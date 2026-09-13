'use strict';

// step_button_stays_paused.spec.js — Playwright E2E test
//
// Verifies that clicking the Step button does NOT trigger continuous execution
// after boot completes. Three scenarios are covered:
//
//   Scenario A (Path 1 — instant boot):
//     A compiled program is pending in the assembler buffer (_pendingSimLoad=true).
//     One click of the Step button triggers instantBoot() then returns paused.
//     The simulator must stay paused — no walk or run loop may start.
//
//   Scenario B (Path 2 — manual boot ceremony):
//     No pending program. The user clicks Step 3 times to step manually through
//     the three boot instructions. After the final click the simulator must
//     be paused — not in a continuous run loop.
//
//   Scenario C (Boot → Step race — cancel guard):
//     The user clicks Boot (starting slowBoot() animation, bootAnimating=true),
//     waits 200 ms (mid-animation), then clicks Step.  stepSim() must cancel
//     the animation (clearTimeout + bootAnimating=false) and return paused after
//     running one manual boot phase.  No continuous execution loop may start.
//
// Approach:
//   Auto-boot is disabled via localStorage before page load (prevents slowBoot()
//   from starting automatically and eventually calling runSimGo() which puts the
//   sim into continuous execution mode).
//
//   loadSimulator() then calls sim.reset() + instantBoot() explicitly from
//   page.evaluate().  sim.reset() fires the 'reset' event, which causes
//   _maybeApplyBootImage() to apply window.bootImage (if the server has one) to
//   sim.memory.  instantBoot() runs all three boot instructions synchronously;
//   CALL_HOME is an out-of-band post-boot event and has no progress row.
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
// Boot instruction count:
//   LOAD CR15 → CHANGE CR12 → CALL CR0 (sets bootComplete).
//   Three instructions → Scenario B requires 3 Step clicks.

const { test, expect } = require('@playwright/test');
const { loadSimulator } = require('./helpers/simulator');

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
// synchronously (all three instructions run in a tight while-loop, no async I/O),
// loads the assembled program, and returns paused.
// Continuous execution must NOT start.

test.describe('Step button stays paused — Scenario A (instant boot, Path 1)', () => {

    test('one Step click with a pending compiled program does not start continuous execution', async ({ page }) => {
        test.setTimeout(60000);

        await loadSimulator(page);

        // ── 1. Assemble a minimal executable program so _pendingSimLoad is true
        //
        // assembleAndLoad() is a global function.  It reads from #asmEditor,
        // assembles the source, writes to lastAssembledWords, and sets the
        // module-level _pendingSimLoad = true.
        await page.evaluate(() => {
            const editor = document.getElementById('asmEditor');
            if (editor) editor.value = 'IADD DR1, DR0, 1';
        });
        const pendingCandidate = await page.evaluate(() => assembleAndLoad());
        await page.waitForTimeout(200);

        // ── 2. Hard-reset the sim back to pre-boot state ──────────────────────
        //
        // A field-only rewind would leave the live Thread owner from the
        // previous boot attached to the reset bank. Use the real reset path so
        // the three-instruction boot starts with clean architectural state.
        await page.evaluate(() => {
            sim.reset();
            if (sim._bootImageLoaded !== true && window.bootImage) {
                sim.loadBootImage(window.bootImage);
            }
            sim.running      = false;
        });
        // assembleAndLoad() is allowed to auto-boot when invoked against an
        // already-running machine. Reinstall its immutable candidate after
        // the hard reset so this test deterministically exercises Step's
        // pending-compile branch.
        await page.evaluate(candidate => {
            _setPendingSimLoad({
                token: candidate.token,
                abstraction: 'step-test',
                words: candidate.words,
                capabilities: candidate.capabilities || [],
                labels: candidate.labels || null,
                methodTableSize: candidate.methodTableSize || 0,
            });
        }, pendingCandidate);

        // ── 3. Click Step once — triggers the instant-boot path ───────────────
        //
        // stepSim() sees: !bootComplete && _pendingSimLoad === true
        //   → calls instantBoot() (3 synchronous instructions)
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

// ─── Scenario B — 3-click manual boot ceremony (stepSim Path 2) ──────────────
//
// When _pendingSimLoad is false and bootComplete is false, each Step click
// advances one boot instruction:
//   Click 1 → LOAD CR15   (bootStep: 0→1)
//   Click 2 → CHANGE CR12 (bootStep: 1→2)
//   Click 3 → CALL CR0    (bootComplete=true)
//
// After click 8, stepSim() sees sim.bootComplete===true, calls
// switchView('dashboard'), and returns.  runSimGo() is NOT called by
// the manual-step path (only slowBoot() calls runSimGo() after animation).
// The machine must be paused.

test.describe('Step button stays paused — Scenario B (manual boot, 3 clicks, Path 2)', () => {

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

        // ── 2. Click Step 3 times — one per boot instruction ────────────────
        //
        // CALL CR0 (click 3) sets bootComplete=true.  stepSim() then
        // calls _autoLoadDefaultProgram(), switchView('dashboard'), and returns —
        // without calling runSimGo() (that is only done by slowBoot()).
        for (let phase = 1; phase <= 3; phase++) {
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

// ─── Scenario C — Boot → Step race (bootAnimating cancel guard) ───────────────
//
// The user clicks Boot (which calls slowBoot() and sets bootAnimating=true),
// waits 200 ms while the animation is mid-flight, then clicks Step.
// stepSim() must detect bootAnimating===true, cancel the pending timer via
// clearTimeout(_bootAnimTimer), clear bootAnimating=false, and run ONE manual
// boot phase (B:00 FAULT_RST).  After that it returns without calling
// runSimGo() or walkToggle(), so the sim must stay paused.
//
// Why this scenario cannot use assertPausedState():
//   assertPausedState() checks sim.bootComplete===true, but after cancelling the
//   animation and running only B:00, bootComplete is still false (only one of
//   the eight phases ran).  The critical invariants are sim.running===false and
//   a stable stepCount over 1300 ms — those are what this scenario asserts.

test.describe('Step button stays paused — Scenario C (Boot→Step race, cancel guard)', () => {

    test('clicking Step mid-boot-animation cancels it and leaves the sim paused', async ({ page }) => {
        test.setTimeout(60000);

        await loadSimulator(page);

        // ── 1. Force pre-boot state ────────────────────────────────────────────
        //
        // slowBoot() returns immediately if sim.bootComplete or sim.halted.
        // Clear them so the animation actually starts.
        await page.evaluate(() => {
            sim.bootComplete = false;
            sim.bootStep     = 0;
            sim.halted       = false;
            sim.running      = false;
        });

        // ── 2. Start slowBoot() — this sets bootAnimating=true and schedules
        //       the first _bootAnimTimer tick (800 ms from now).
        await page.evaluate(() => slowBoot());

        // Confirm animation has started before proceeding.
        const animStarted = await page.evaluate(() => bootAnimating === true);
        expect(animStarted, 'slowBoot() must set bootAnimating=true before Step is clicked').toBe(true);

        // ── 3. Wait 200 ms (well within the 800 ms tick) then click Step ──────
        //
        // stepSim() will see bootAnimating===true at line 711 of app-run.js,
        // cancel the pending timeout, clear bootAnimating, then run one manual
        // boot phase (B:00 FAULT_RST).  It returns without calling runSimGo().
        await page.waitForTimeout(200);

        const stepBtn = page.locator('#toolStepBtn');
        await stepBtn.waitFor({ state: 'visible' });
        await stepBtn.click();

        // Allow the click handler and any microtasks to settle.
        await page.waitForTimeout(400);

        // ── 4. Assert cancel guard fired and sim is paused ────────────────────

        const state = await page.evaluate(() => ({
            bootAnimating:   bootAnimating,
            bootAnimTimer:   _bootAnimTimer,
            running:         sim.running,
            halted:          sim.halted,
            stepCount:       sim.stepCount,
        }));

        expect(state.bootAnimating, 'bootAnimating must be false — cancel guard must have fired').toBe(false);
        expect(state.bootAnimTimer, '_bootAnimTimer must be null — clearTimeout must have been called').toBeNull();
        expect(state.running,       'sim.running must be false — no batch loop may start').toBe(false);
        expect(state.halted,        'sim must not be halted after B:00').toBe(false);

        // Wait longer than one walk tick to confirm no hidden execution loop.
        await page.waitForTimeout(1300);

        const stepCountAfter = await page.evaluate(() => sim.stepCount);
        expect(stepCountAfter, 'stepCount must not increase — no continuous execution loop active').toBe(state.stepCount);

        // Step button must still be interactive.
        await expect(stepBtn).toBeVisible();
        await expect(stepBtn).not.toBeDisabled();
    });

});

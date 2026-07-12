'use strict';

// run_double_click_guard.spec.js — Playwright E2E test
//
// Verifies that calling runSimGo() twice in rapid succession (effectively 0 ms
// apart, well under the 100 ms threshold in the task spec) does NOT spawn two
// concurrent runBatch() loops.
//
// Guard under test:
//   runSimGo() (app-run.js) checks `if (sim.running || _simRunActive) return;`
//   before calling runSim().  runSim() sets _simRunActive = true synchronously
//   on its first line, so a second runSimGo() call issued in the same JS turn
//   sees the flag and returns immediately without starting a second loop.
//
// Test strategy — direct call-count interception:
//   In browser scripts (non-module), `function runSim()` at the top level is a
//   property of `window`.  We temporarily wrap window.runSim with a counting
//   shim inside the same page.evaluate() block that issues the two runSimGo()
//   calls.  After both calls return (synchronously), we restore the original and
//   return the counter.
//
//   Expected: runSim called exactly once.
//   If the guard is broken: runSim called twice.
//
//   We also verify that stepCount advances (the one permitted run was live) and
//   then stabilises after the run ends (no second loop still ticking).
//   We do NOT check sim.halted or sim.faultLog — the NOP program reliably hits a
//   RANGE fault from thread-area limits during normal single-batch execution;
//   that is unrelated to the double-click guard under test.
//
// Boot setup is identical to step_button_stays_paused.spec.js — see that file for
// the full explanation of why autoboot is disabled, why bootEntrySlot=6 is forced,
// and why instantBoot() is used instead of the slow animated path.

const { test, expect } = require('@playwright/test');

// ─── Shared boot helper ───────────────────────────────────────────────────────

async function loadSimulator(page) {
    await page.addInitScript(() => {
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        // Slot 3→6 migration: force the module-level variable so
        // _applyBootEntryToSim() does not clobber it with slot 3 (LED_DEV).
        localStorage.setItem('bootEntrySlot', '6');
    });

    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(
        () =>  typeof sim           !== 'undefined'
            && typeof instantBoot   === 'function'
            && window.bootImageAvailable === true,
        { timeout: 10000 }
    );

    const bootResult = await page.evaluate(() => {
        const ok = instantBoot();
        if (ok) return { ok: true };
        return {
            ok:           false,
            bootComplete: sim.bootComplete,
            halted:       sim.halted,
            bootStep:     sim.bootStep,
            faultLog:     JSON.stringify((sim.faultLog || []).slice(0, 5)),
            output:       (sim.output || '').slice(-800),
        };
    });

    if (!bootResult.ok) {
        throw new Error(
            `instantBoot() failed — ` +
            `bootStep=${bootResult.bootStep}, halted=${bootResult.halted}, ` +
            `bootComplete=${bootResult.bootComplete}\n` +
            `faultLog: ${bootResult.faultLog}\n` +
            `sim.output (tail): ${bootResult.output}`
        );
    }

    await page.evaluate(() => switchView('dashboard'));
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('Run button double-click guard', () => {

    test('calling runSimGo() twice in rapid succession starts exactly one batch', async ({ page }) => {
        test.setTimeout(60000);

        // ── 1. Boot ────────────────────────────────────────────────────────────
        await loadSimulator(page);

        // ── 2. Assemble a minimal NOP program ─────────────────────────────────
        await page.evaluate(() => {
            const editor = document.getElementById('asmEditor');
            if (editor) editor.value = 'NOP';
        });
        await page.evaluate(() => assembleAndLoad());
        await page.waitForTimeout(200);

        // ── 3. Wrap runSim and call runSimGo() twice synchronously ─────────────
        //
        // window.runSim is a property on window (function declarations at the top
        // of non-module scripts live on window).  We replace it with a counting
        // shim for the duration of the evaluate call, then restore it.
        //
        // Both runSimGo() calls happen synchronously in one JS turn — 0 ms apart.
        //   Call 1: runSimGo() → runSim() → shim increments counter, sets
        //           _simRunActive = true, schedules runBatch via setTimeout(0).
        //   Call 2: runSimGo() checks sim.running || _simRunActive (true) → bails
        //           out before reaching runSim — shim is never called again.
        //
        // We also capture stepCount before the calls so we can verify later that
        // the single batch actually ran and advanced it.
        const result = await page.evaluate(() => {
            const stepBefore = sim.stepCount;

            // Wrap runSim with a call counter.
            const originalRunSim = window.runSim;
            let runSimCallCount  = 0;
            window.runSim = function() {
                runSimCallCount++;
                return originalRunSim.apply(this, arguments);
            };

            // Fire both calls — second must be a no-op.
            runSimGo(); // first  — guard not yet set → calls runSim
            runSimGo(); // second — _simRunActive is true → returns immediately

            // Restore original before any async work runs.
            window.runSim = originalRunSim;

            return { stepBefore, runSimCallCount };
        });

        // ── 4. Primary assertion: runSim called exactly once ──────────────────
        //
        // If the guard is broken, runSim would be called twice and
        // runSimCallCount would be 2.
        expect(
            result.runSimCallCount,
            `runSim must be called exactly once — guard must block the second runSimGo() call (got ${result.runSimCallCount} calls)`
        ).toBe(1);

        // ── 5. Wait for the single batch to finish ─────────────────────────────
        //
        // The batch runs until it halts naturally (RANGE fault or MAX_STEPS).
        // Poll until sim.running goes false — finishRun() clears it.
        await page.waitForFunction(
            () => !sim.running,
            { timeout: 20000, polling: 200 }
        );

        // Allow any final microtasks to settle.
        await page.waitForTimeout(200);

        // ── 6. Verify the single batch ran ─────────────────────────────────────
        const stepCountAfterBatch = await page.evaluate(() => sim.stepCount);
        expect(
            stepCountAfterBatch,
            `stepCount must have advanced from ${result.stepBefore} — the single permitted batch must have run`
        ).toBeGreaterThan(result.stepBefore);

        // ── 7. Confirm no second batch is running in the background ────────────
        //
        // If the guard failed, a second runBatch loop would still be ticking
        // via setTimeout(0).  Wait 600 ms and assert stepCount has not moved.
        await page.waitForTimeout(600);
        const stepCountFinal = await page.evaluate(() => sim.stepCount);
        expect(
            stepCountFinal,
            'stepCount must not advance after the batch ends — no second runBatch loop must be running'
        ).toBe(stepCountAfterBatch);
    });

});

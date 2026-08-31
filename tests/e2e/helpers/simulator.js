'use strict';

/**
 * Load the simulator page with auto-boot disabled, then explicitly run
 * instantBoot() for a deterministic, fully-booted start state.
 *
 * The boot-entry slot is pinned to 6 so the canonical SelfTest lump is used
 * during the boot ceremony rather than a stale localStorage selection.
 */
async function loadSimulator(page) {
    await page.addInitScript(() => {
        // Suppress What's New modal so it cannot block UI clicks.
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
        // Prevent the page's startup handler from launching slowBoot().
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        // Boot.Abstr/SelfTest lives at slot 6 after the slot migration.
        localStorage.setItem('bootEntrySlot', '6');
    });
    await page.goto('/simulator/');

    // bootImageAvailable means the boot image fetch has completed and its
    // contents have been overlaid into sim.memory.
    await page.waitForFunction(
        () => typeof sim !== 'undefined'
            && typeof instantBoot === 'function'
            && window.bootImageAvailable === true,
        { timeout: 10000 }
    );

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

    // instantBoot() does not change the active view when called directly.
    await page.evaluate(() => switchView('dashboard'));
}

module.exports = { loadSimulator };
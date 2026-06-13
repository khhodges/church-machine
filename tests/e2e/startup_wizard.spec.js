'use strict';

// startup_wizard.spec.js — Playwright E2E test suite for the Startup Wizard
//
// app-startup-wizard.js is loaded with <script defer>, so the browser executes
// it after HTML parsing and before DOMContentLoaded fires. This means init()
// is called reliably on every page load and:
//   - localStorage step is restored via _load()
//   - _renderProgress() is called, setting the active step body to display:'block'
//     and all others to display:'none' — making the active body truly visible
//   - The Ti60 polling watcher is started via _watchTi60Steps()
//
// Step body visibility convention (after the _renderProgress fix):
//   Active step body:   el.style.display === 'block'  → Playwright toBeVisible() ✓
//   Inactive step body: el.style.display === 'none'   → Playwright toBeHidden()  ✓
//
// Buttons inside the active step body are genuinely visible and respond to
// normal Playwright .click() calls.
//
// Covers 10 test groups:
//   Group 1  — Initial render
//   Group 2  — "Done" button advances
//   Group 3  — Back button
//   Group 4  — "I'm stuck" panel toggle
//   Group 5  — localStorage persistence (real reload-init restore path)
//   Group 6  — Auto-advance mock (Connect step, uart element)
//   Group 7  — Auto-advance mock (Upload step, release element)
//   Group 8  — Retry button on failed Connect step
//   Group 9  — Demo mode (conditionally skipped if startDemo absent)
//   Group 10 — Reset

const { test, expect } = require('@playwright/test');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Load the simulator fresh (no wizard state in localStorage) and open the
 * wizard panel at step 0.
 *
 * The wizard lives inside #builder > #ti60ConnectPanel, so it is only visible
 * once we navigate to Builder > Connect.  Both switchView and
 * switchBuilderViewTab are synchronous global functions defined by the
 * (synchronous) app-shell.js / app-run.js scripts, so they are available by
 * the time networkidle settles.
 *
 * Because app-startup-wizard.js is loaded with <script defer>, init() runs
 * via DOMContentLoaded after HTML parsing; it calls _load() (reads
 * localStorage) and _renderProgress() which sets the active step body to
 * display:'block'.  By networkidle time, init() has already executed.
 */
async function loadFreshWizard(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');
    // Clear any wizard localStorage left by a prior test, and suppress the
    // "What's New" modal so it cannot block clicks during Group 9 (demo tour).
    await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('sw_')) localStorage.removeItem(key);
        }
        localStorage.setItem('church_whatsnew_dismissed_perm', '1');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openWizard(page);
}

/**
 * Navigate to Builder > Connect, making #ti60ConnectPanel (the wizard's
 * parent) visible.  Does NOT open the wizard body — call StartupWizard.open()
 * and assert the expected body step separately so callers control which step
 * is checked (e.g. Group 5 checks swBody2 after a reload, not swBody0).
 */
async function navigateToConnect(page) {
    await page.waitForFunction(
        () => typeof switchView === 'function' && typeof switchBuilderViewTab === 'function',
        { timeout: 8000 }
    );
    await page.evaluate(() => {
        switchView('builder');
        switchBuilderViewTab('ti60-connect');
    });
}

/**
 * Navigate to Builder > Connect, open the wizard, and wait for step 0 to be
 * visible.  Convenience wrapper for the common case.
 */
async function openWizard(page) {
    await navigateToConnect(page);
    await page.evaluate(() => StartupWizard.open());
    await expect(page.locator('#swBody0')).toBeVisible({ timeout: 5000 });
}

/**
 * Advance the wizard to `targetStep` by calling StartupWizard.advance()
 * the appropriate number of times via page.evaluate().
 */
async function navigateToStep(page, targetStep) {
    await page.evaluate((target) => {
        for (let i = 0; i < target; i++) StartupWizard.advance();
    }, targetStep);
}

/**
 * Ensure an element with `id` exists in the DOM, creating it if absent.
 */
async function ensureTi60StepEl(page, id, initialClass) {
    await page.evaluate(({ id, cls }) => {
        if (!document.getElementById(id)) {
            const el = document.createElement('div');
            el.id = id;
            el.className = cls;
            document.body.appendChild(el);
        }
    }, { id, cls: initialClass });
}

// ─── Group 1 — Initial render ─────────────────────────────────────────────────

test.describe('Group 1 — initial render', () => {
    test('wizard panel present, step 0 active, correct icons and progress', async ({ page }) => {
        await loadFreshWizard(page);

        // Panel is in the DOM.
        await expect(page.locator('#swPanel')).toBeAttached();

        // Step 0 body is visible; steps 1–5 are hidden.
        await expect(page.locator('#swBody0')).toBeVisible();
        for (let i = 1; i <= 5; i++) {
            await expect(page.locator(`#swBody${i}`)).toBeHidden();
        }

        // Strip icons: step 0 shows ▶ (active), steps 1–5 show ○ (pending).
        await expect(page.locator('#swStep0 .sw-step-icon')).toHaveText('▶');
        for (let i = 1; i <= 5; i++) {
            await expect(page.locator(`#swStep${i} .sw-step-icon`)).toHaveText('○');
        }

        // Progress label and fill.
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 1 of 6');
        const w = await page.locator('#swProgressFill').evaluate((el) => el.style.width);
        expect(w).toBe('0%');
    });
});

// ─── Group 2 — "Done" button advances ─────────────────────────────────────────

test.describe('Group 2 — "Done" button advances', () => {
    test('clicking Done marks step 0 done and auto-advances to step 1', async ({ page }) => {
        test.setTimeout(15000);
        await loadFreshWizard(page);

        // Done button is visible (it's inside the visible step 0 body).
        const doneBtn = page.locator('#swBody0 .sw-btn-done');
        await expect(doneBtn).toBeVisible();
        await doneBtn.click();

        // Step 0 strip icon shows ✓ immediately.
        await expect(page.locator('#swStep0 .sw-step-icon')).toHaveText('✓');

        // After the 700 ms auto-advance timeout, step 1 body becomes visible.
        await expect(page.locator('#swBody1')).toBeVisible({ timeout: 2000 });

        // Step 0 body must now be hidden.
        await expect(page.locator('#swBody0')).toBeHidden();

        // Progress label updates to "Step 2 of 6".
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 2 of 6');
    });
});

// ─── Group 3 — Back button ────────────────────────────────────────────────────

test.describe('Group 3 — Back button', () => {
    test('Back from step 1 returns to step 0', async ({ page }) => {
        await loadFreshWizard(page);

        // Advance programmatically to step 1.
        await navigateToStep(page, 1);
        await expect(page.locator('#swBody1')).toBeVisible();
        await expect(page.locator('#swBody0')).toBeHidden();

        // Click ← Back (step 1 body is visible so this is a real click).
        await page.locator('#swBody1 .sw-btn-back').click();

        // Step 0 must be visible again; step 1 hidden.
        await expect(page.locator('#swBody0')).toBeVisible();
        await expect(page.locator('#swBody1')).toBeHidden();

        // Progress label reverts to "Step 1 of 6".
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 1 of 6');
    });
});

// ─── Group 4 — "I'm stuck" panel toggle ──────────────────────────────────────

test.describe('Group 4 — "I\'m stuck" panel toggle', () => {
    test('clicking I\'m stuck shows trouble panel; clicking again hides it', async ({ page }) => {
        await loadFreshWizard(page);

        const trouble = page.locator('#swTrouble0');
        const btn = page.locator('#swBody0 .sw-btn-stuck');

        // Initially no sw-visible on trouble panel.
        expect(await trouble.evaluate((el) => el.classList.contains('sw-visible'))).toBe(false);

        // First click — sw-visible added (CSS .sw-visible sets display:block).
        await expect(btn).toBeVisible();
        await btn.click();
        expect(await trouble.evaluate((el) => el.classList.contains('sw-visible'))).toBe(true);

        // Second click — sw-visible removed.
        await btn.click();
        expect(await trouble.evaluate((el) => el.classList.contains('sw-visible'))).toBe(false);
    });
});

// ─── Group 5 — localStorage persistence ──────────────────────────────────────

test.describe('Group 5 — localStorage persistence', () => {
    test('wizard reopens at the saved step after page reload (real init restore path)', async ({ page }) => {
        test.setTimeout(20000);
        await loadFreshWizard(page);

        // Advance to step 2 — advance() calls _save() → writes sw_step_ti60='2'.
        await navigateToStep(page, 2);
        await expect(page.locator('#swBody2')).toBeVisible();

        // Confirm the localStorage key was saved.
        const saved = await page.evaluate(() => localStorage.getItem('sw_step_ti60'));
        expect(saved).toBe('2');

        // Reload WITHOUT clearing localStorage.
        await page.reload();
        await page.waitForLoadState('networkidle');
        // init() runs via defer+DOMContentLoaded, calls _load() (reads '2'),
        // then _renderProgress() which sets swBody2.style.display='block'.
        // Navigate to Builder > Connect and open the wizard; check step 2.
        await navigateToConnect(page);
        await page.evaluate(() => StartupWizard.open());
        await expect(page.locator('#swBody2')).toBeVisible({ timeout: 5000 });

        // Step 2 must be active; steps 0 and 1 must be hidden.
        await expect(page.locator('#swBody0')).toBeHidden();
        await expect(page.locator('#swBody1')).toBeHidden();
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 3 of 6');
    });
});

// ─── Group 6 — Auto-advance mock (Connect step) ───────────────────────────────

test.describe('Group 6 — auto-advance mock (Connect step)', () => {
    test('ti60-step-pass on uart element advances wizard to Upload step', async ({ page }) => {
        test.setTimeout(15000);
        await loadFreshWizard(page);

        // Navigate to step 3 (Connect). The poll watcher was started by init().
        await navigateToStep(page, 3);
        await expect(page.locator('#swBody3')).toBeVisible();

        // Ensure the uart element exists.
        await ensureTi60StepEl(page, 'ti60Step-uart', 'ti60-step-pending');

        // Inject ti60-step-pass — the watcher polls every 800 ms.
        await page.evaluate(() => {
            const el = document.getElementById('ti60Step-uart');
            if (el) el.className = 'ti60-step-pass';
        });

        // Within 2000 ms (≤800 ms poll + 700 ms advance delay) step 4 must be visible.
        await expect(page.locator('#swBody4')).toBeVisible({ timeout: 2000 });
        await expect(page.locator('#swBody3')).toBeHidden();
    });
});

// ─── Group 7 — Auto-advance mock (Upload step) ───────────────────────────────

test.describe('Group 7 — auto-advance mock (Upload step)', () => {
    test('ti60-step-pass on release element advances wizard to Running step', async ({ page }) => {
        test.setTimeout(15000);
        await loadFreshWizard(page);

        // Navigate to step 4 (Upload). Poll watcher started by init().
        await navigateToStep(page, 4);
        await expect(page.locator('#swBody4')).toBeVisible();

        // Ensure the release element exists.
        await ensureTi60StepEl(page, 'ti60Step-release', 'ti60-step-pending');

        // Inject ti60-step-pass.
        await page.evaluate(() => {
            const el = document.getElementById('ti60Step-release');
            if (el) el.className = 'ti60-step-pass';
        });

        // Within 2000 ms step 5 must be visible.
        await expect(page.locator('#swBody5')).toBeVisible({ timeout: 2000 });
        await expect(page.locator('#swBody4')).toBeHidden();
    });
});

// ─── Group 8 — Retry button on failed Connect step ────────────────────────────

test.describe('Group 8 — retry button on failed Connect step', () => {
    test('markStepFail shows retry button; clicking retry clears fail state', async ({ page }) => {
        await loadFreshWizard(page);

        // Navigate to step 3 (Connect).
        await navigateToStep(page, 3);
        await expect(page.locator('#swBody3')).toBeVisible();

        // Ensure uart element exists so retryStep(3) does not error.
        await ensureTi60StepEl(page, 'ti60Step-uart', 'ti60-step-pending');

        // Trigger a fail.
        await page.evaluate(() => StartupWizard.markStepFail(3));

        // Retry button must have sw-visible; strip icon must show ✗.
        const retryBtn = page.locator('#swBody3 .sw-btn-retry');
        expect(await retryBtn.evaluate((el) => el.classList.contains('sw-visible'))).toBe(true);
        await expect(page.locator('#swStep3 .sw-step-icon')).toHaveText('✗');

        // Click retry — step body is visible so this is a real Playwright click.
        // sw-btn-retry gets display:block when sw-visible is added.
        await retryBtn.click();

        // Retry button must lose sw-visible; strip icon must return to ▶.
        expect(await retryBtn.evaluate((el) => el.classList.contains('sw-visible'))).toBe(false);
        await expect(page.locator('#swStep3 .sw-step-icon')).toHaveText('▶');
    });
});

// ─── Group 9 — Demo mode ──────────────────────────────────────────────────────

test.describe('Group 9 — demo mode', () => {
    test('demo tour shows DEMO badge and auto-advances; Exit tour resets wizard', async ({ page }) => {
        test.setTimeout(20000);
        await loadFreshWizard(page);

        // Skip gracefully if startDemo is not yet implemented.
        const hasDemoMode = await page.evaluate(() => typeof StartupWizard.startDemo === 'function');
        test.skip(!hasDemoMode, 'startDemo not implemented — skipping Group 9');

        // Trigger demo via the tour button.
        const tourBtn = page.locator('.sw-btn-tour');
        await expect(tourBtn).toBeVisible();
        await tourBtn.click();

        // DEMO badge must be visible (style.display cleared from 'none').
        expect(
            await page.locator('#swDemoBadge').evaluate((el) => el.style.display !== 'none')
        ).toBe(true);

        // Record current step number before auto-advance.
        const stepBefore = await page.evaluate(() =>
            parseInt(document.getElementById('swProgressLabel').textContent.match(/\d+/)[0], 10)
        );

        // Wait 3.5 s — DEMO_DWELL_MS=3000 ms, so one tick must have fired.
        await page.waitForTimeout(3500);

        const stepAfter = await page.evaluate(() =>
            parseInt(document.getElementById('swProgressLabel').textContent.match(/\d+/)[0], 10)
        );
        expect(stepAfter).toBeGreaterThan(stepBefore);

        // Click Exit tour.
        const exitTour = page.locator('#swExitTour');
        await expect(exitTour).toBeVisible();
        await exitTour.click();

        // DEMO badge hidden; wizard reset to step 0.
        expect(
            await page.locator('#swDemoBadge').evaluate((el) => el.style.display === 'none')
        ).toBe(true);
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 1 of 6');
    });
});

// ─── Group 10 — Reset ────────────────────────────────────────────────────────

test.describe('Group 10 — reset', () => {
    test('reset() returns wizard to step 0 from any step', async ({ page }) => {
        await loadFreshWizard(page);

        // Advance to step 2.
        await navigateToStep(page, 2);
        await expect(page.locator('#swBody2')).toBeVisible();
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 3 of 6');

        // Reset.
        await page.evaluate(() => StartupWizard.reset());

        // Must return to step 0.
        await expect(page.locator('#swProgressLabel')).toHaveText('Step 1 of 6');
        await expect(page.locator('#swBody0')).toBeVisible();
        await expect(page.locator('#swBody2')).toBeHidden();
    });
});

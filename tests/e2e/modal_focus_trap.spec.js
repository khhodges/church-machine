'use strict';

// Browser regression coverage for modal focus trapping.
// Verifies that Tab cannot escape into the page behind any custom dialog, that
// Escape closes the dialog, and that focus returns to the element that opened it.

const { test, expect } = require('@playwright/test');

async function gotoIde(page) {
    await page.goto('/simulator/');
    await page.waitForFunction(() => typeof switchView === 'function');
}

test.describe('Modal focus trapping', () => {

    // ── Shortcuts help overlay ─────────────────────────────────────────────────
    test.describe('Shortcuts modal', () => {
        test('Tab cycles within modal and Escape closes it', async ({ page }) => {
            await gotoIde(page);

            // Open via JS so we have a predictable trigger element
            await page.evaluate(() => openShortcutsHelp());
            const modal = page.locator('#shortcutsModal');
            await expect(modal).toBeVisible();

            // Close button (only focusable control) should receive initial focus
            const closeBtn = modal.locator('.shortcuts-close-btn');
            await expect(closeBtn).toBeFocused();

            // Forward Tab stays inside (wraps to same element when only 1 control)
            await page.keyboard.press('Tab');
            await expect(closeBtn).toBeFocused();

            // Shift+Tab also stays inside
            await page.keyboard.press('Shift+Tab');
            await expect(closeBtn).toBeFocused();

            // Escape closes the modal
            await page.keyboard.press('Escape');
            await expect(modal).not.toBeVisible();
        });

        test('close button click closes the modal', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => openShortcutsHelp());
            await expect(page.locator('#shortcutsModal')).toBeVisible();
            await page.locator('#shortcutsModal .shortcuts-close-btn').click();
            await expect(page.locator('#shortcutsModal')).not.toBeVisible();
        });
    });

    // ── LUMP type-selector modal ───────────────────────────────────────────────
    test.describe('LUMP type selector modal', () => {
        test('Tab cycles through all buttons and Escape closes', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => switchView('lumps'));

            await page.evaluate(() => showLumpTypeSelector());
            const modal = page.locator('#lumpTypeSelectorModal');
            await expect(modal).toBeVisible();

            // First focusable control (first type button) should be focused
            const allBtns = modal.locator('button');
            await expect(allBtns.first()).toBeFocused();

            // Count buttons and Tab through all of them
            const btnCount = await allBtns.count();
            for (let i = 1; i < btnCount; i++) {
                await page.keyboard.press('Tab');
            }
            // After tabbing through all, should be on last button
            await expect(allBtns.last()).toBeFocused();

            // One more Tab wraps back to first — focus stays inside modal
            await page.keyboard.press('Tab');
            await expect(allBtns.first()).toBeFocused();

            // Shift+Tab from first wraps to last — still inside modal
            await page.keyboard.press('Shift+Tab');
            await expect(allBtns.last()).toBeFocused();

            // Escape closes
            await page.keyboard.press('Escape');
            await expect(modal).not.toBeVisible();
        });

        test('focuses trigger on close', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => switchView('lumps'));

            // Make a specific element the trigger by focusing it before opening
            const trigger = page.locator('body');
            await page.evaluate(() => {
                // Use a real button so we can track focus restoration
                const btn = document.createElement('button');
                btn.id = '_focusTrapTestTrigger';
                btn.textContent = 'trigger';
                document.body.appendChild(btn);
                btn.focus();
                showLumpTypeSelector();
            });
            await expect(page.locator('#lumpTypeSelectorModal')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('#lumpTypeSelectorModal')).not.toBeVisible();
            // Trigger button should have regained focus
            await expect(page.locator('#_focusTrapTestTrigger')).toBeFocused();
        });
    });

    // ── LUMP import modal ──────────────────────────────────────────────────────
    test.describe('LUMP import modal', () => {
        test('initial focus lands on Name field', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => showLumpImportModal());
            await expect(page.locator('#lumpImportModal')).toBeVisible();
            await expect(page.locator('#lumpImportName')).toBeFocused();
        });

        test('Tab stays inside modal on Shift+Tab from first control', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => showLumpImportModal());
            await expect(page.locator('#lumpImportModal')).toBeVisible();

            // Name is focused (first control); Shift+Tab wraps to last control inside modal
            await page.keyboard.press('Shift+Tab');
            const isInsideModal = await page.evaluate(() => {
                const modal = document.getElementById('lumpImportModal');
                return modal ? modal.contains(document.activeElement) : false;
            });
            expect(isInsideModal).toBe(true);
        });

        test('Escape closes the modal', async ({ page }) => {
            await gotoIde(page);
            await page.evaluate(() => showLumpImportModal());
            await expect(page.locator('#lumpImportModal')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('#lumpImportModal')).not.toBeVisible();
        });
    });

});

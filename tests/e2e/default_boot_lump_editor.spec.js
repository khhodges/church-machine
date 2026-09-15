'use strict';

// The default Code View must open the executable selected by the loaded
// image's Lightning Bolt boot-entry slot, not the generic capability_test
// example.

const { test, expect } = require('@playwright/test');
const { loadSimulator } = require('./helpers/simulator');

const BOOT_TOKEN = '4a00000a';

const STUB_BOOT_LUMP = {
    token:        BOOT_TOKEN,
    abstraction:  'SelfTest',
    ns_slot:      10,
    lump_type:    'code',
    content_type: 'code',
    language:     'assembly',
    lump_version: 86,
    compiled_at:  2000,
    resident:     true,
    boot_resident: true,
    load_policy:  'Resident',
    cw:           2,
    cc:           0,
};

test('default Code View opens the configured Lightning Bolt LUMP', async ({ page }) => {
    test.setTimeout(60000);

    await page.addInitScript(() => {
        localStorage.setItem('church_defaultView', 'editor');
    });

    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_BOOT_LUMP]),
        });
    });

    // openLumpInEditor reads the authoritative words endpoint before handing
    // ownership of the editor to the saved LUMP.
    await page.route(`**/api/lump/${BOOT_TOKEN}/words`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: BOOT_TOKEN,
                abstraction: 'SelfTest',
                words: [0xF8000800, 0x00000000],
                source: '; configured boot-entry source',
                trusted: true,
                approved: true,
                binary_valid: true,
                validation_errors: [],
            }),
        });
    });

    await loadSimulator(page);

    // loadSimulator deliberately lands on the dashboard after its deterministic
    // boot. Re-enter the configured default Code View with an empty editor and
    // exercise the same resolver used by boot completion.
    const opened = await page.evaluate(async () => {
        switchView('editor');
        const editor = document.getElementById('asmEditor');
        if (editor) editor.value = '';
        return await _openConfiguredBootLumpInDefaultEditor();
    });
    expect(opened).toBe(true);

    await page.waitForFunction(token =>
        window._editorOpenLumpToken === token &&
        document.getElementById('editor')?.classList.contains('active'),
        BOOT_TOKEN,
        { timeout: 15000 }
    );

    const result = await page.evaluate(() => ({
        token: window._editorOpenLumpToken,
        currentToken: window.LumpRegistry && window.LumpRegistry.getCurrent(),
        bootSlot: sim.bootEntrySlot,
        editor: document.getElementById('asmEditor')?.value || '',
    }));

    expect(result.bootSlot).toBe(10);
    expect(result.token).toBe(BOOT_TOKEN);
    expect(result.currentToken).toBe(BOOT_TOKEN);
    expect(result.editor).not.toContain('Capability Test');
});
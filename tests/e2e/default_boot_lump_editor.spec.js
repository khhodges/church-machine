'use strict';

// The default Code View must open the executable selected by the loaded
// image's Lightning Bolt boot-entry slot, not the generic capability_test
// example.

const { test, expect } = require('@playwright/test');

const BOOT_TOKEN = '4a00000a';

const STUB_BOOT_LUMP = {
    token:        BOOT_TOKEN,
    abstraction:  'SelfTest',
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
        localStorage.setItem('churchMachine_autoBootOnOpen', '0');
        // Simulate an older generic editor snapshot restored before the
        // validated boot image arrives. It must not block the boot LUMP.
        localStorage.setItem('church_editor_code',
            '; stale source from the previous startup\nLOAD CR3, CR6, 1');
        localStorage.removeItem('church_editor_document_v1');
    });

    await page.route('**/api/lumps/list', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([STUB_BOOT_LUMP]),
        });
    });

    await page.route('**/api/boot-config', async route => {
        const response = await route.fetch();
        const body = await response.json();
        body.lumpCatalog = [{
            token: BOOT_TOKEN,
            abstraction: 'SelfTest',
            nsSlot: 10,
            loadPolicy: 'Resident',
        }];
        await route.fulfill({
            response,
            contentType: 'application/json',
            body: JSON.stringify(body),
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

    await page.goto('/simulator/');

    // This is intentionally tested with auto-boot disabled: loading the
    // authoritative image must still populate a default Code View with the
    // selected LUMP's disassembly.
    await page.waitForFunction(() =>
        window.bootImageAvailable === true &&
        typeof sim !== 'undefined' &&
        sim &&
        sim._bootImageLoaded === true,
        { timeout: 15000 }
    );

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
        disassembly: document.getElementById('savedLumpDisassembly')?.textContent || '',
        disassemblyVisible:
            document.getElementById('savedLumpDisassemblyPanel')?.style.display === 'flex',
    }));

    expect(result.bootSlot).toBe(10);
    expect(result.token).toBe(BOOT_TOKEN);
    expect(result.currentToken).toBe(BOOT_TOKEN);
    expect(result.editor).not.toContain('Capability Test');
    expect(result.disassemblyVisible).toBe(true);
    expect(result.disassembly).toContain('SelfTest');
});

test('default LUMP open is not gated by a restored generic editor buffer', async () => {
    const fs = require('fs');
    const source = fs.readFileSync('simulator/app-run.js', 'utf8');
    const autoLoadStart = source.indexOf('function _autoLoadDefaultProgram()');
    const autoLoadEnd = source.indexOf(
        '// Do NOT auto-assemble here.', autoLoadStart);
    const autoLoad = source.slice(autoLoadStart, autoLoadEnd);

    expect(autoLoad).toContain(
        "if (!_userTabActive) {\n        _openConfiguredBootLumpInDefaultEditor()");
    expect(autoLoad).not.toContain('if (!_edHasContent && !_userTabActive)');
});
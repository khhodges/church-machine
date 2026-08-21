'use strict';

// wukong_callhome_hw_hex_tab.spec.js
//
// Playwright regression test for the Hex tab of the Lumps Directory viewer when
// the WukongCallHome.hw entry is selected.
//
// Assertion targets (WukongCallHome.hw: token=1dcb7b09, lump_size=128, cw=73, cc=2):
//
//   HEX-01  The binary note text contains "128 of 128 words loaded"
//           (all 128 lump words are fetched and every hex cell is filled)
//   HEX-02  The binary note text contains "73 code words"
//           (fillHexFromBinary counts exactly 73 words in the code region)
//   HEX-03  None of the 73 code cells (hexW1..hexW73) carry the hex-freespace
//           CSS class — they must all be hex-code or hex-code-start
//
// The /api/lump/1dcb7b09 endpoint is intercepted and served from the real lump
// binary on disk (server/lumps/WukongCallHome.hw.1.1dcb7b09.lump) so the test
// is deterministic and does not rely on the Mum Tunnel Library or GitHub.
//
// Response wire format (mirrors server._lump_with_crc):
//   word 0 [4 bytes big-endian] : CRC-32/ISO-HDLC of the lump payload
//   words 1..128 [512 bytes]    : the raw lump binary

const { test, expect } = require('@playwright/test');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const TOKEN        = '1dcb7b09';
const EXPECTED_CW  = 73;
const LUMP_SIZE    = 128;
const LUMPS_PAGE   = '/docs/figures/lumps-directory.html';

const LUMP_FILE = path.join(
    __dirname, '..', '..', 'server', 'lumps',
    'WukongCallHome.hw.1.1dcb7b09.lump'
);

// ── Helper: build the CRC-prefixed wire payload ───────────────────────────────
// Mirrors server._lump_with_crc:
//   payload = struct.pack('>I', zlib.crc32(data) & 0xFFFFFFFF) + data
//
// CRC-32/ISO-HDLC = same polynomial as Python zlib.crc32().
// Node's built-in does not expose crc32 directly, so compute it manually.
// Poly = 0xEDB88320 (reflected), init = 0xFFFFFFFF, xorOut = 0xFFFFFFFF.
function crc32IsoHdlc(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let b = 0; b < 8; b++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildWirePayload(lumpBytes) {
    const crc = crc32IsoHdlc(lumpBytes);
    const out = Buffer.alloc(4 + lumpBytes.length);
    out.writeUInt32BE(crc, 0);
    lumpBytes.copy(out, 4);
    return out;
}

// ── Test ─────────────────────────────────────────────────────────────────────

test('WukongCallHome.hw Hex tab: note shows 128 of 128 words loaded · 73 code words', async ({ page }) => {
    // Build wire payload from the canonical lump file on disk.
    const lumpBytes = fs.readFileSync(LUMP_FILE);
    const wirePayload = buildWirePayload(lumpBytes);

    // Compute the real SHA-256 of the raw lump bytes (before CRC prefix).
    // This matches what the server sends as X-Lump-Hash, so the Hex view
    // reports a successful integrity check rather than a hash failure banner.
    const lumpSha256 = crypto.createHash('sha256').update(lumpBytes).digest('hex');

    // Intercept the binary endpoint so the test does not depend on the running
    // server having LAZY_LUMPS populated (avoids ordering / startup-timing risk).
    await page.route(`**/api/lump/${TOKEN}`, async route => {
        await route.fulfill({
            status:      200,
            contentType: 'application/octet-stream',
            body:        wirePayload,
            headers: {
                'Content-Length': String(wirePayload.length),
                'X-Lump-Hash':    `sha256:${lumpSha256}`,
                'Access-Control-Allow-Origin': '*',
            },
        });
    });

    // ── Navigate ──────────────────────────────────────────────────────────────
    await page.goto(LUMPS_PAGE);

    // Wait for the lump list to render.
    await expect(page.locator('#lumpList')).not.toBeEmpty({ timeout: 8000 });

    // ── Select the WukongCallHome.hw row ─────────────────────────────────────
    const hwRow = page.locator('#row-WukongCallHome\\.hw');
    await expect(hwRow).toBeVisible({ timeout: 5000 });
    await hwRow.click();

    // Review panel must become visible.
    await expect(page.locator('#review.visible')).toBeVisible({ timeout: 5000 });

    // ── Click the Hex tab ────────────────────────────────────────────────────
    // The tab label is "💾 Hex".
    const hexTab = page.locator('.tab', { hasText: 'Hex' });
    await hexTab.click();

    // ── Wait for binary to load ──────────────────────────────────────────────
    // The note element starts as "⏳ Loading binary…" and is updated once the
    // fetch resolves.  We wait until the loading spinner text is gone.
    const note = page.locator('#_hexBinaryNote');
    await expect(note).toBeVisible({ timeout: 5000 });
    await expect(note).not.toContainText('Loading binary', { timeout: 10000 });

    // ── HEX-01: total words loaded ───────────────────────────────────────────
    // All 128 lump words are in the binary; every hexW{0..127} cell is filled.
    // note.textContent = "{totalFilled} of {lumpSize} words loaded · {filled} code words"
    // → "128 of 128 words loaded · 73 code words"
    await expect(note).toContainText(`${LUMP_SIZE} of ${LUMP_SIZE} words loaded`);

    // ── HEX-02: code word count ───────────────────────────────────────────────
    await expect(note).toContainText(`${EXPECTED_CW} code words`);

    // ── HEX-03: code cells carry hex-code or hex-code-start, nothing else ────
    // hexW1..hexW73 are in the .code region.  Each must have exactly one of:
    //   • hex-code-start  (method entry point — setup at W1, loop_top at W4)
    //   • hex-code        (all other code words)
    // Any other region class (hex-freespace, hex-header, hex-clist, hex-clist-live,
    // hex-empty) indicates a classifier regression.
    const codeCellAudit = await page.evaluate(({ cw }) => {
        const wrongClass  = [];   // cells without hex-code or hex-code-start
        const methodStarts = []; // cells that are hex-code-start (method entry)
        for (let wi = 1; wi <= cw; wi++) {
            const cell = document.getElementById('hexW' + wi);
            if (!cell) { wrongClass.push({ wi, reason: 'element missing' }); continue; }
            const cls = cell.className;
            const isCodeStart = cls.includes('hex-code-start');
            const isCode      = cls.includes('hex-code') && !isCodeStart;
            if (!isCodeStart && !isCode) {
                wrongClass.push({ wi, classes: cls });
            }
            if (isCodeStart) methodStarts.push(wi);
        }
        return { wrongClass, methodStarts };
    }, { cw: EXPECTED_CW });

    // Every code word must be hex-code or hex-code-start.
    expect(codeCellAudit.wrongClass).toHaveLength(0);

    // WukongCallHome.hw declares two methods:
    //   setup    offset=0 → W1   (hex-code-start)
    //   loop_top offset=3 → W4   (hex-code-start)
    // Exactly those two words should be method-start cells.
    expect(codeCellAudit.methodStarts).toEqual([1, 4]);
});

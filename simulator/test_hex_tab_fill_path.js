// test_hex_tab_fill_path.js — Smoke test for the Hex tab binary fill path
// in docs/figures/Lumps Directory.html (Task #2768).
//
// Strategy: extract the exact code blocks from the HTML and execute them under
// Node.js with a synthetic binary buffer and a minimal DOM stub.  A regression
// such as the fill loop dropping the clistNames argument, or the builder
// assigning to the wrong variable, will break these assertions directly.
//
// Coverage:
//   FP-1  Structural: clistNames builder statement is present in the HTML
//   FP-2  Structural: _disMnem(val,clistNames) call-site is present in the HTML
//   FP-3  Integration: running the extracted fill-path code on a synthetic
//          WukongCallHome-like lump produces tooltip strings for code words
//          that contain the "→ AbstrName" annotation derived from capabilities
//   FP-4  ELOADCALL word 1 (slot 0) → "→ SelfTest" in its tooltip
//   FP-5  ELOADCALL word 2 (slot 1) → "→ Tunnel" in its tooltip
//   FP-6  RETURN word 3 → no "→" annotation (RETURN has no cap slot)
//   FP-7  Word 0 (header sentinel) → tooltip contains ".header" (fill loop
//          correctly routes word 0 to the header branch)
//   FP-8  With empty capabilities the same code words produce no "→" annotation
//
// Run with: node simulator/test_hex_tab_fill_path.js
'use strict';

const fs   = require('fs');
const path = require('path');

const HTML_PATH = path.resolve(__dirname, '../docs/figures/Lumps Directory.html');

// ── HTML extraction helpers ───────────────────────────────────────────────────

function readHtml() {
    return fs.readFileSync(HTML_PATH, 'utf8');
}

/**
 * Extract the OPNAMES + CONDS + _disMnem + _mkCmt block from the HTML.
 * Returns a source string that declares all four names in the same scope.
 */
function extractHelperBlock(html) {
    const opStart = html.indexOf('const OPNAMES = {');
    if (opStart === -1) throw new Error('OPNAMES table not found in HTML');
    const opEnd = html.indexOf('};\n', opStart) + 3;

    const condStart = html.indexOf('const CONDS = [', opEnd);
    if (condStart === -1) throw new Error('CONDS array not found in HTML');
    const condEnd = html.indexOf('];\n', condStart) + 3;

    // _disMnem
    const disMnemMarker = 'function _disMnem(w32, clistNames)';
    const disMnemStart  = html.indexOf(disMnemMarker, condEnd);
    if (disMnemStart === -1) throw new Error('_disMnem not found in HTML');
    let depth = 0, disMnemEnd = -1;
    for (let i = disMnemStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { if (--depth === 0) { disMnemEnd = i; break; } }
    }
    if (disMnemEnd === -1) throw new Error('Could not find closing brace of _disMnem');

    // _mkCmt
    const mkCmtMarker = 'function _mkCmt(w32, crAlias, clistNames)';
    const mkCmtStart  = html.indexOf(mkCmtMarker, disMnemEnd);
    if (mkCmtStart === -1) throw new Error('_mkCmt not found in HTML');
    depth = 0; let mkCmtEnd = -1;
    for (let i = mkCmtStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { if (--depth === 0) { mkCmtEnd = i; break; } }
    }
    if (mkCmtEnd === -1) throw new Error('Could not find closing brace of _mkCmt');

    return html.slice(opStart, opEnd) +
           html.slice(condStart, condEnd) +
           html.slice(disMnemStart, disMnemEnd + 1) + '\n' +
           html.slice(mkCmtStart,  mkCmtEnd  + 1);
}

/**
 * Extract the fill-path block from the HTML: from the clistNames builder
 * through the end of the fill loop (the "if(note)" note line).
 *
 * Returns the raw source string.
 */
function extractFillLoopBlock(html) {
    const builderMarker = 'const clistNames={};';
    const builderStart  = html.indexOf(builderMarker);
    if (builderStart === -1) throw new Error('clistNames builder not found in HTML');

    // End marker: the line that writes to the note element after the loop
    const noteMarker = "if(note) note.textContent=";
    const noteIdx    = html.indexOf(noteMarker, builderStart);
    if (noteIdx === -1) throw new Error('fill-loop end marker not found in HTML');
    const noteEnd = html.indexOf(';\n', noteIdx) + 2;

    return html.slice(builderStart, noteEnd).trim();
}

/**
 * Run the extracted fill-path code against controlled inputs.
 *
 * @param {string} helperBlock  - OPNAMES/CONDS/_disMnem/_mkCmt source
 * @param {string} fillBlock    - fill-loop source extracted from HTML
 * @param {object} lumpData     - synthetic lump descriptor
 * @param {ArrayBuffer} buf     - synthetic binary (CRC word + lump words, big-endian)
 * @returns {Object<number, string>} tips — map from word index → tooltip string
 */
function runFillPath(helperBlock, fillBlock, lumpData, buf) {
    const view = new DataView(buf);

    // Collect tooltip strings instead of writing to DOM cells
    const tips = {};
    const domStub = {
        getElementById(_id) {
            // Return a minimal cell stub that captures the tooltip via .title setter
            const wi = parseInt(String(_id).replace('hexW', ''), 10);
            return {
                set textContent(_v) {},
                set title(v) { tips[wi] = v; },
            };
        },
    };

    // methodStarts: no named method boundaries in our synthetic lump
    const methodStarts = {};
    // note stub (the element that shows "N of M words loaded · K code words")
    const noteCapture = { value: '' };
    const note = { set textContent(v) { noteCapture.value = v; } };

    // Build the combined source.
    // The fill loop uses `document`, `buf`, `view`, `lumpData`, `methodStarts`,
    // `note`, and the helpers. We inject them all as parameters.
    const src = `
${helperBlock}
${fillBlock}
`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(
        'document', 'buf', 'view', 'lumpData', 'methodStarts', 'note',
        src
    );
    fn(domStub, buf, view, lumpData, methodStarts, note);
    return { tips, noteText: noteCapture.value };
}

// ── Synthetic binary builder ─────────────────────────────────────────────────
// Layout: [CRC word (4 bytes)] [word 0] [word 1] … [word lump_size-1]
// All big-endian (DataView.getUint32(off, false)).
//
// For WukongCallHome (lump_size=64, cw=3, cc=2):
//   word 0  — header sentinel (op=0x1F)
//   word 1  — ELOADCALL CR0, CR6, slot=0, method=0
//   word 2  — ELOADCALL CR0, CR6, slot=1, method=0
//   word 3  — RETURN
//   words 4-61 — zero (free space)
//   words 62-63 — c-list entries
function encodeWord(op, dst, src, imm, cond = 14) {
    return (((op  & 0x1F) * (1 << 27)) |
            ((cond & 0xF) * (1 << 23)) |
            ((dst  & 0xF) * (1 << 19)) |
            ((src  & 0xF) * (1 << 15)) |
            (imm & 0x7FFF)) >>> 0;
}

function buildBinary(lumpWords) {
    const buf  = new ArrayBuffer((lumpWords.length + 1) * 4);  // +1 for CRC word
    const view = new DataView(buf);
    view.setUint32(0, 0, false);  // CRC word = 0
    lumpWords.forEach((w, i) => view.setUint32((i + 1) * 4, w >>> 0, false));
    return buf;
}

const HEADER_SENTINEL = encodeWord(0x1F, 0, 0, 0);
const ELOADCALL_SLOT0 = encodeWord(8, 0, 6, 0);   // op=ELOADCALL, src=CR6, slot=0
const ELOADCALL_SLOT1 = encodeWord(8, 0, 6, 1);   // op=ELOADCALL, src=CR6, slot=1
const RETURN_WORD     = encodeWord(3, 0, 0, 0);

const LUMP_WORDS_64 = new Array(64).fill(0);
LUMP_WORDS_64[0]  = HEADER_SENTINEL;
LUMP_WORDS_64[1]  = ELOADCALL_SLOT0;
LUMP_WORDS_64[2]  = ELOADCALL_SLOT1;
LUMP_WORDS_64[3]  = RETURN_WORD;
LUMP_WORDS_64[62] = 0x4A000006;  // c-list[0] GT
LUMP_WORDS_64[63] = 0x4A000008;  // c-list[1] GT

const SYNTHETIC_BUF = buildBinary(LUMP_WORDS_64);

const WUKONG_CALLHOME = {
    lump_size: 64,
    cw: 3,
    cc: 2,
    capabilities: [
        { slot: 0, name: 'SelfTest', rights: ['E'], gt: '0x4A000006' },
        { slot: 1, name: 'Tunnel',   rights: ['E'], gt: '0x4A000008' },
    ],
    methods: [{ name: 'Main', offset: 0, length: 3, visibility: 'public' }],
};

const WUKONG_NO_CAPS = { ...WUKONG_CALLHOME, capabilities: [] };

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(id, desc, actual, expected) {
    if (actual === expected) {
        console.log(`  ✓ ${id}  ${desc}`);
        passed++;
    } else {
        console.error(`  ✗ ${id}  ${desc}`);
        console.error(`       expected: ${JSON.stringify(expected)}`);
        console.error(`       actual:   ${JSON.stringify(actual)}`);
        failed++;
    }
}
function checkContains(id, desc, haystack, needle) {
    const ok = typeof haystack === 'string' && haystack.includes(needle);
    if (ok) {
        console.log(`  ✓ ${id}  ${desc}`);
        passed++;
    } else {
        console.error(`  ✗ ${id}  ${desc}`);
        console.error(`       needle:   ${JSON.stringify(needle)}`);
        console.error(`       haystack: ${JSON.stringify(haystack)}`);
        failed++;
    }
}
function checkAbsent(id, desc, haystack, needle) {
    const ok = typeof haystack === 'string' && !haystack.includes(needle);
    if (ok) {
        console.log(`  ✓ ${id}  ${desc}`);
        passed++;
    } else {
        console.error(`  ✗ ${id}  ${desc}`);
        console.error(`       unexpected needle: ${JSON.stringify(needle)}`);
        console.error(`       haystack:          ${JSON.stringify(haystack)}`);
        failed++;
    }
}

// ── Load HTML and extract code blocks ────────────────────────────────────────
const HTML = readHtml();
const HELPER_BLOCK = extractHelperBlock(HTML);
const FILL_BLOCK   = extractFillLoopBlock(HTML);

// ── FP-1  Structural: clistNames builder is present in the HTML ───────────────
console.log('\n── FP-1  Structural: clistNames builder present in HTML ─────────────────');
{
    const builderMarker = 'const clistNames={};';
    check('FP-1a', 'clistNames builder found',
        HTML.includes(builderMarker), true);
    const capabilityLine = '(lumpData.capabilities||[]).forEach((cap,i)=>{if(cap&&cap.name)clistNames[i]=cap.name;});';
    check('FP-1b', 'capability forEach statement found',
        HTML.includes(capabilityLine), true);
}

// ── FP-2  Structural: _disMnem(val,clistNames) call-site is present ───────────
console.log('\n── FP-2  Structural: _disMnem(val,clistNames) call-site present ──────────');
{
    check('FP-2a', '_disMnem(val,clistNames) call-site found',
        HTML.includes('_disMnem(val,clistNames)'), true);
}

// ── FP-3  Integration: fill path runs without throwing ────────────────────────
console.log('\n── FP-3  Integration: extracted fill path runs without throwing ──────────');
{
    let threw = false, tips, noteText;
    try {
        ({ tips, noteText } = runFillPath(HELPER_BLOCK, FILL_BLOCK, WUKONG_CALLHOME, SYNTHETIC_BUF));
    } catch (e) {
        threw = true;
        console.error('       exception:', e.message);
    }
    check('FP-3a', 'fill path does not throw', threw, false);
    check('FP-3b', 'tooltips collected for at least 4 words',
        !threw && Object.keys(tips).length >= 4, true);
}

// ── FP-4 / FP-5 / FP-6 / FP-7  Per-word tooltip assertions ──────────────────
const { tips: TIPS_WITH_CAPS, noteText: NOTE_WITH_CAPS } = runFillPath(HELPER_BLOCK, FILL_BLOCK, WUKONG_CALLHOME, SYNTHETIC_BUF);

console.log('\n── FP-4  Word 1 (ELOADCALL slot 0): tooltip contains → SelfTest ──────────');
{
    const tip = TIPS_WITH_CAPS[1] || '';
    checkContains('FP-4a', 'word 1 tooltip includes → SelfTest', tip, '→ SelfTest');
}

console.log('\n── FP-5  Word 2 (ELOADCALL slot 1): tooltip contains → Tunnel ────────────');
{
    const tip = TIPS_WITH_CAPS[2] || '';
    checkContains('FP-5a', 'word 2 tooltip includes → Tunnel', tip, '→ Tunnel');
}

console.log('\n── FP-6  Word 3 (RETURN): tooltip contains no → annotation ─────────────');
{
    const tip = TIPS_WITH_CAPS[3] || '';
    // RETURN has no c-list slot reference, so no → annotation
    checkContains('FP-6a', 'word 3 tooltip contains RETURN mnemonic', tip, 'RETURN');
    checkAbsent('FP-6b',  'word 3 tooltip has no → annotation',      tip, '→ SelfTest');
    checkAbsent('FP-6c',  'word 3 tooltip has no → Tunnel',          tip, '→ Tunnel');
}

console.log('\n── FP-7  Word 0 (header sentinel): tooltip contains .header ─────────────');
{
    const tip = TIPS_WITH_CAPS[0] || '';
    checkContains('FP-7a', 'word 0 tooltip contains .header', tip, '.header');
    checkAbsent('FP-7b',   'word 0 tooltip has no → annotation', tip, '→');
}

// ── FP-8  Empty capabilities → no abstraction-name annotation on code words ────
// Note: _mkCmt may still emit "→" as part of its semantic descriptions
// (e.g. "fused load+call ... → CR0").  We check specifically for the
// "→ <name>" suffix that _disMnem appends — which requires a non-empty
// clistNames entry.  When capabilities is empty, those suffixes must be absent.
console.log('\n── FP-8  Empty capabilities: no → AbstrName annotation in code words ─────');
{
    const { tips: noCaps } = runFillPath(HELPER_BLOCK, FILL_BLOCK, WUKONG_NO_CAPS, SYNTHETIC_BUF);
    const tip1 = noCaps[1] || '';
    const tip2 = noCaps[2] || '';
    // The _disMnem annotation suffix always starts on the mnemonic line (first
    // newline-delimited line of the tooltip after the W#### header).
    const mnemonicLine1 = tip1.split('\n')[1] || '';
    const mnemonicLine2 = tip2.split('\n')[1] || '';
    checkAbsent('FP-8a', 'word 1 mnemonic line has no → AbstrName when caps empty',
        mnemonicLine1, '→ SelfTest');
    checkAbsent('FP-8b', 'word 2 mnemonic line has no → AbstrName when caps empty',
        mnemonicLine2, '→ Tunnel');
    // But words are still decoded (ELOADCALL mnemonic still present)
    checkContains('FP-8c', 'word 1 still decoded as ELOADCALL', tip1, 'ELOADCALL');
}

// ── FP-9  Note text: total words loaded + code word count ─────────────────────
console.log('\n── FP-9  Note text shows total words and code word count ──────────────────');
{
    // WukongCallHome: lump_size=64, cw=3 → "64 of 64 words loaded · 3 code words"
    checkContains('FP-9a', 'note contains "64 of 64 words loaded"',
        NOTE_WITH_CAPS, '64 of 64 words loaded');
    checkContains('FP-9b', 'note contains "3 code words"',
        NOTE_WITH_CAPS, '3 code words');
    // cw=0: "64 of 64 words loaded · 0 code words"
    const ZERO_CW = { ...WUKONG_CALLHOME, cw: 0, cc: 0, capabilities: [], methods: [] };
    const { noteText: noteZeroCw } = runFillPath(HELPER_BLOCK, FILL_BLOCK, ZERO_CW, SYNTHETIC_BUF);
    checkContains('FP-9c', 'note for cw=0 contains "64 of 64 words loaded"',
        noteZeroCw, '64 of 64 words loaded');
    checkContains('FP-9d', 'note for cw=0 contains "0 code words"',
        noteZeroCw, '0 code words');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

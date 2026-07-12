/**
 * Unit tests for the GT word decoding and display-name resolution logic in
 * simulator/app-lumps.js (_renderLumpGTSection loop, ~line 3443).
 *
 * Run with Node.js:
 *   node tests/lump/test_lump_gt_display.js
 *
 * The two pure helpers (_gtDecodeWord, _gtLiveDisplayName) are extracted from
 * simulator/app-lumps.js via the GT_DECODE_UNIT_TEST_EXPORT marker block so
 * the test exercises the real production logic without pulling in DOM deps.
 *
 * Bugs caught by this suite (regression guard):
 *   B1 — wrong gtType bit position (was >>> 23, correct is >>> 25)
 *   B2 — wrong gtSeq width (was & 0x7F / 7-bit, correct is & 0x1FF / 9-bit)
 *   B3 — missing capabilities[] lookup (displayed "NS[N]" instead of cap name)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Extract the two pure helper functions from app-lumps.js
// ---------------------------------------------------------------------------
const appLumpsSrc = fs.readFileSync(
    path.join(__dirname, '../../simulator/app-lumps.js'),
    'utf8'
);

const exportMatch = appLumpsSrc.match(
    /\/\* ---- GT_DECODE_UNIT_TEST_EXPORT_START[\s\S]*?GT_DECODE_UNIT_TEST_EXPORT_END ---- \*\//
);
if (!exportMatch) {
    console.error('FATAL: GT_DECODE_UNIT_TEST_EXPORT marker block not found in simulator/app-lumps.js');
    process.exit(1);
}

let _gtDecodeWord, _gtLiveDisplayName;
try {
    const mod = new Function(
        exportMatch[0] + '\nreturn { _gtDecodeWord, _gtLiveDisplayName };'
    )();
    _gtDecodeWord      = mod._gtDecodeWord;
    _gtLiveDisplayName = mod._gtLiveDisplayName;
} catch (e) {
    console.error('FATAL: failed to load GT decode helpers from app-lumps.js:', e.message);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  \u2713 ${label}`);
        passed++;
    } else {
        console.error(`  \u2717 FAIL: ${label}`);
        failed++;
    }
}

function assertEqual(actual, expected, label) {
    if (actual === expected) {
        console.log(`  \u2713 ${label}`);
        passed++;
    } else {
        console.error(`  \u2717 FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Helpers to construct GT words with known fields
//
// GT word layout (as implemented in app-lumps.js _renderLumpGTSection):
//   bits[31:27] — other fields (abType for Abstract GTs; unused here)
//   bits[26:25] — gtType  (1=Inform, 2=Outform, 3=Abstract, 0=Null)
//   bits[24:16] — gtSeq   (9-bit sequence / version counter)
//   bits[15: 0] — gtSlotId (NS slot index for Live GTs)
// ---------------------------------------------------------------------------

/**
 * Build a raw 32-bit Live GT word (Inform or Outform).
 * @param {number} gtType   1=Inform, 2=Outform
 * @param {number} gtSeq    9-bit value (0..511)
 * @param {number} slotId   16-bit NS slot index
 */
function makeLiveGT(gtType, gtSeq, slotId) {
    return (((gtType  & 0x3)   << 25) |
            ((gtSeq   & 0x1FF) << 16) |
             (slotId  & 0xFFFF)) >>> 0;
}

/**
 * Build a raw 32-bit Abstract GT word.
 * bits[26:25] = 0b11 = 3
 * @param {number} gtSeq    9-bit value (0..511)
 * @param {number} abType   5-bit abstract type
 */
function makeAbstractGT(gtSeq, abType) {
    return (((abType & 0x1F) << 27) |
            (3 << 25) |
            ((gtSeq & 0x1FF) << 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Test 1: Inform GT — gtType=1 decoded from bits[26:25]
// Regression guard for B1: wrong bit position (was >>> 23)
// ---------------------------------------------------------------------------
console.log('\nTest 1: Inform GT (gtType=1) — bits[26:25]');
{
    // bits[26:25] = 0b01 = 1  (Inform)
    const wVal = makeLiveGT(1, 0, 0);
    const { gtType, gtSeq } = _gtDecodeWord(wVal);
    assertEqual(gtType, 1, 'gtType === 1 (Inform)');
    // Regression: if bits[27:26] were read instead, gtType would be 0
    assert(gtType !== 0, 'gtType is not 0 (wrong bit position guard)');
    // Regression: if bits[24:23] were read, gtType would also be wrong
    assert(gtType !== 2, 'gtType is not misread as Outform');
}

// ---------------------------------------------------------------------------
// Test 2: Outform GT — gtType=2 decoded from bits[26:25]
// ---------------------------------------------------------------------------
console.log('\nTest 2: Outform GT (gtType=2) — bits[26:25]');
{
    // bits[26:25] = 0b10 = 2  (Outform)
    const wVal = makeLiveGT(2, 0, 0);
    const { gtType } = _gtDecodeWord(wVal);
    assertEqual(gtType, 2, 'gtType === 2 (Outform)');
    assert(gtType !== 1, 'gtType is not misread as Inform');
}

// ---------------------------------------------------------------------------
// Test 3: Abstract GT — gtType=3 decoded from bits[26:25]
// ---------------------------------------------------------------------------
console.log('\nTest 3: Abstract GT (gtType=3) — bits[26:25]');
{
    // bits[26:25] = 0b11 = 3  (Abstract)
    const wVal = makeAbstractGT(0, 0);
    const { gtType } = _gtDecodeWord(wVal);
    assertEqual(gtType, 3, 'gtType === 3 (Abstract)');
}

// ---------------------------------------------------------------------------
// Test 4: gtType=0 for a null/zero word
// ---------------------------------------------------------------------------
console.log('\nTest 4: Zero word — gtType=0 (Null)');
{
    const { gtType, gtSeq } = _gtDecodeWord(0);
    assertEqual(gtType, 0, 'gtType === 0 for zero word');
    assertEqual(gtSeq,  0, 'gtSeq === 0 for zero word');
}

// ---------------------------------------------------------------------------
// Test 5: gtSeq round-trips correctly — 9-bit field bits[24:16]
// Regression guard for B2: gtSeq was & 0x7F (7-bit), now & 0x1FF (9-bit)
// ---------------------------------------------------------------------------
console.log('\nTest 5: gtSeq — 9-bit field [24:16] round-trips');
{
    // Test low values
    for (const seq of [0, 1, 42, 127]) {
        const wVal = makeLiveGT(1, seq, 0);
        const { gtSeq } = _gtDecodeWord(wVal);
        assertEqual(gtSeq, seq, `gtSeq round-trips: ${seq}`);
    }
    // Values > 127 (0x7F) would be truncated by the old 7-bit mask
    for (const seq of [128, 255, 256, 511]) {
        const wVal = makeLiveGT(1, seq, 0);
        const { gtSeq } = _gtDecodeWord(wVal);
        assertEqual(gtSeq, seq, `gtSeq round-trips > 127: ${seq}`);
        assert(gtSeq !== (seq & 0x7F) || seq === (seq & 0x7F),
            `gtSeq ${seq} not truncated to 7 bits (old bug guard)`);
    }
}

// ---------------------------------------------------------------------------
// Test 6: gtSeq maximum value (511 = 0x1FF)
// ---------------------------------------------------------------------------
console.log('\nTest 6: gtSeq maximum value (511)');
{
    const wVal = makeLiveGT(1, 511, 0);
    const { gtSeq } = _gtDecodeWord(wVal);
    assertEqual(gtSeq, 511, 'gtSeq max value 511 round-trips');
}

// ---------------------------------------------------------------------------
// Test 7: gtSeq and gtType are independent — changing one does not affect other
// ---------------------------------------------------------------------------
console.log('\nTest 7: gtType and gtSeq are independent bit fields');
{
    const wVal = makeLiveGT(2, 300, 5);
    const { gtType, gtSeq } = _gtDecodeWord(wVal);
    assertEqual(gtType, 2,   'gtType=2 with gtSeq=300 in same word');
    assertEqual(gtSeq,  300, 'gtSeq=300 with gtType=2 in same word');
}

// ---------------------------------------------------------------------------
// Test 8: gtSeq for Abstract GT
// ---------------------------------------------------------------------------
console.log('\nTest 8: Abstract GT — gtSeq also decoded correctly');
{
    const wVal = makeAbstractGT(200, 3);
    const { gtType, gtSeq } = _gtDecodeWord(wVal);
    assertEqual(gtType, 3,   'Abstract GT: gtType=3');
    assertEqual(gtSeq,  200, 'Abstract GT: gtSeq=200');
}

// ---------------------------------------------------------------------------
// Test 9: Live GT with capabilities[slot].name → displays that name
// Regression guard for B3: missing capabilities[] lookup produced "NS[N]"
// ---------------------------------------------------------------------------
console.log('\nTest 9: Live GT — capabilities[slot].name overrides fallbacks');
{
    const name = _gtLiveDisplayName(0, { name: 'LED0' }, '', '');
    assertEqual(name, 'LED0', 'capabilities.name returned directly');
}

// ---------------------------------------------------------------------------
// Test 10: capabilities entry as plain string (typeof === 'string' path)
// ---------------------------------------------------------------------------
console.log('\nTest 10: Live GT — capabilities[slot] as plain string');
{
    const name = _gtLiveDisplayName(2, 'UART0', '', '');
    assertEqual(name, 'UART0', 'capabilities string entry returned directly');
}

// ---------------------------------------------------------------------------
// Test 11: No capabilities entry → falls back to petName from manifest
// ---------------------------------------------------------------------------
console.log('\nTest 11: No capabilities entry — falls back to petName');
{
    const name = _gtLiveDisplayName(1, null, 'Boot.Thread', '');
    assertEqual(name, 'Boot.Thread', 'petName fallback when capMeta is null');
}

// ---------------------------------------------------------------------------
// Test 12: No capabilities, no petName → falls back to nsLabel from sim
// ---------------------------------------------------------------------------
console.log('\nTest 12: No capabilities, no petName — falls back to nsLabel');
{
    const name = _gtLiveDisplayName(3, null, '', 'SelfTest');
    assertEqual(name, 'SelfTest', 'nsLabel fallback when capMeta and petName absent');
}

// ---------------------------------------------------------------------------
// Test 13: Nothing available → falls back to "GT#<slot>", never "NS[N]"
// Regression guard for B3: the old code could produce "NS[N]" labels
// ---------------------------------------------------------------------------
console.log('\nTest 13: No info available — fallback is "GT#<slot>", never "NS[N]"');
{
    for (const slot of [0, 1, 5, 12]) {
        const name = _gtLiveDisplayName(slot, null, '', '');
        assertEqual(name, `GT#${slot}`, `slot ${slot}: fallback is GT#${slot}`);
        assert(!name.startsWith('NS['), `slot ${slot}: does NOT produce NS[N] label`);
    }
}

// ---------------------------------------------------------------------------
// Test 14: capabilities.name takes priority over petName and nsLabel
// ---------------------------------------------------------------------------
console.log('\nTest 14: capabilities.name wins over petName and nsLabel');
{
    const name = _gtLiveDisplayName(0, { name: 'LED0' }, 'WrongPetName', 'WrongNS');
    assertEqual(name, 'LED0', 'capabilities.name highest priority');
}

// ---------------------------------------------------------------------------
// Test 15: petName takes priority over nsLabel
// ---------------------------------------------------------------------------
console.log('\nTest 15: petName wins over nsLabel');
{
    const name = _gtLiveDisplayName(0, null, 'Boot.Thread', 'WrongNS');
    assertEqual(name, 'Boot.Thread', 'petName higher priority than nsLabel');
}

// ---------------------------------------------------------------------------
// Test 16: Empty capabilities object (no .name field) → skips to petName
// ---------------------------------------------------------------------------
console.log('\nTest 16: Empty capabilities object (no .name) — falls through to petName');
{
    const name = _gtLiveDisplayName(0, {}, 'MyPetName', '');
    assertEqual(name, 'MyPetName', 'empty capMeta.name falls through to petName');
}

// ---------------------------------------------------------------------------
// Test 17: capabilities.name empty string → treated as falsy, falls through
// ---------------------------------------------------------------------------
console.log('\nTest 17: capabilities.name = "" — falls through to petName');
{
    const name = _gtLiveDisplayName(0, { name: '' }, 'MyPetName', '');
    assertEqual(name, 'MyPetName', 'empty capMeta.name string falls through to petName');
}

// ---------------------------------------------------------------------------
// Test 18: All four GT types produce correct gtType values in one sweep
// ---------------------------------------------------------------------------
console.log('\nTest 18: Full sweep — all four gtType values');
{
    const cases = [
        { wVal: 0x00000000, expected: 0, label: 'Null (0)' },
        { wVal: makeLiveGT(1, 0, 0), expected: 1, label: 'Inform (1)' },
        { wVal: makeLiveGT(2, 0, 0), expected: 2, label: 'Outform (2)' },
        { wVal: makeAbstractGT(0, 0), expected: 3, label: 'Abstract (3)' },
    ];
    for (const c of cases) {
        const { gtType } = _gtDecodeWord(c.wVal);
        assertEqual(gtType, c.expected, `${c.label}: gtType=${c.expected}`);
    }
}

// ---------------------------------------------------------------------------
// Test 19: Bit-position regression — old wrong decode (>>> 23) & 0x3
// If the old bug were present, these specific words would mis-decode.
// ---------------------------------------------------------------------------
console.log('\nTest 19: Bit-position regression guard (vs old >>> 23 bug)');
{
    // Word with gtType=1 at bits[26:25]=0b01.
    // Old decode (>>> 23) & 0x3 would read bits[24:23].
    // We set bits[24:23]=0b00 so old code yields 0, correct code yields 1.
    const wVal = (1 << 25) >>> 0;   // only bit 25 set → gtType=1 correct, 0 under old bug
    const { gtType } = _gtDecodeWord(wVal);
    assertEqual(gtType, 1, 'bit-25-only word: gtType=1 (not 0 from old >>> 23)');

    // Word with gtType=2 at bits[26:25]=0b10.
    // Bit 26 set, bit 25 clear: old (>>> 23) would read bits[24:23]=0.
    const wVal2 = (2 << 25) >>> 0;
    const { gtType: gt2 } = _gtDecodeWord(wVal2);
    assertEqual(gt2, 2, 'bit-26-only word: gtType=2 (not 0 from old >>> 23)');
}

// ---------------------------------------------------------------------------
// Test 20: Width regression guard — gtSeq values 128..511 (> old 7-bit max)
// ---------------------------------------------------------------------------
console.log('\nTest 20: Width regression guard (vs old & 0x7F bug)');
{
    // Seq=128 (0x80): with old 7-bit mask yields 0; correct 9-bit mask yields 128.
    const wVal = makeLiveGT(1, 128, 0);
    const { gtSeq } = _gtDecodeWord(wVal);
    assertEqual(gtSeq, 128, 'gtSeq=128 not truncated to 0 (old 7-bit bug guard)');

    // Seq=384: old mask → 384 & 0x7F = 0; correct → 384.
    const wVal2 = makeLiveGT(1, 384, 0);
    const { gtSeq: seq2 } = _gtDecodeWord(wVal2);
    assertEqual(seq2, 384, 'gtSeq=384 not truncated (old 7-bit bug guard)');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
if (failed === 0) {
    console.log(`\u2713 All ${passed} assertions passed.\n`);
    process.exit(0);
} else {
    console.error(`\u2717 ${failed} assertion${failed !== 1 ? 's' : ''} failed, ${passed} passed.\n`);
    process.exit(1);
}

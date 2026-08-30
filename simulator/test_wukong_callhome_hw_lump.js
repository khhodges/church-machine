'use strict';
// test_wukong_callhome_hw_lump.js — Binary verification for WukongCallHome.hw
// Task #2779
//
// Loads server/lumps/WukongCallHome.hw.1.1dcb7b09.lump (the 512-byte hardware
// ROM binary recovered from git history) and verifies:
//
//   WCH-HW-01  Header word is valid: magic=0x1F, cw=73, cc=2, lumpSize=128, typ=0
//   WCH-HW-02  lumpSize=128 matches file size (512 bytes = 128 big-endian words)
//   WCH-HW-03  words[1..73] — all 73 code words match the known binary exactly
//   WCH-HW-04  words[74..125] — freespace region is entirely zero (52 words)
//   WCH-HW-05  words[126..127] — c-list entries are present (non-zero)
//   WCH-HW-06  loadLumpBinary() installs the header at EXTENDED_BASE (0x0400)
//   WCH-HW-07  NS[bootEntrySlot].word1 encodes limit=73; header encodes cc=2
//   WCH-HW-08  CR14.word1 = EXTENDED_BASE (0x0400) after load
//   WCH-HW-09  sim.parseLumpHeader agrees with raw header decode (cw=73, cc=2, lumpSize=128)
//   WCH-HW-10  Every code word survives the load intact in simulator memory
//
// Run:  node simulator/test_wukong_callhome_hw_lump.js

const fs   = require('fs');
const path = require('path');
const ChurchSimulator = require('./simulator.js');
const ChurchAssembler = require('./assembler.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        fail++;
    }
}

// ── Constants ────────────────────────────────────────────────────────────────
const EXTENDED_BASE  = 0x0400;
const LUMP_FILE      = path.join(__dirname, '..', 'server', 'lumps',
                                 'WukongCallHome.hw.1.1dcb7b09.lump');
const SIDECAR_FILE   = path.join(__dirname, '..', 'server', 'lumps',
                                  'WukongCallHome.hw.1.1dcb7b09.json');
const EXPECTED_CW       = 73;
const EXPECTED_CC       = 2;
const EXPECTED_LUMPSIZE = 128;
const EXPECTED_TYP      = 0;

// ── Helper: read a .lump binary as big-endian uint32 words ───────────────────
// Matches the format served by Flask's /api/lump/<token>/words endpoint:
//   words = struct.unpack(f'>{num_words}I', data[:num_words * 4])
//
// Validates that the file byte length is:
//   (a) divisible by 4 — required for clean big-endian uint32 decoding
//   (b) exactly expectedBytes when supplied — guards against truncation/padding
// Throws on either violation so callers always receive a well-formed array.
function readLumpFile(filePath, expectedBytes) {
    const buf = fs.readFileSync(filePath);
    if (buf.length % 4 !== 0) {
        throw new Error(
            `readLumpFile: ${filePath} is ${buf.length} bytes — not word-aligned (must be a multiple of 4)`
        );
    }
    if (expectedBytes !== undefined && buf.length !== expectedBytes) {
        throw new Error(
            `readLumpFile: ${filePath} is ${buf.length} bytes, expected exactly ${expectedBytes}`
        );
    }
    const numWords = buf.length >> 2;
    const words    = [];
    for (let i = 0; i < numWords; i++) {
        words.push(buf.readUInt32BE(i * 4));
    }
    return words;
}

// ── Helper: seed a minimal sim for a binary load ─────────────────────────────
// Mirrors the preconditions that the browser sets up before loadLumpBinary:
//   bootComplete=true, CR14 (non-null), CR12 (non-null), NS bootEntrySlot seeded.
function setupSimForBinary() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;

    const GT_SEQ    = 1;
    const INIT_BASE = 0x80;
    const INIT_CW   = 64;
    const nsBase = sim._nsSlotBase(sim.bootEntrySlot);
    sim.memory[nsBase + 0] = INIT_BASE;
    sim.memory[nsBase + 1] = sim.packNSWord1(INIT_CW, 0, 0, 0, 0);
    sim.memory[nsBase + 2] = sim.makeVersionSeals(GT_SEQ, INIT_BASE, INIT_CW);
    sim.cr[14] = {
        word0: sim.createGT(GT_SEQ, sim.bootEntrySlot, {R:1,W:0,X:1,L:0,S:0,E:0}, 1),
        word1: INIT_BASE,
        word2: sim.memory[nsBase + 1],
        word3: sim.memory[nsBase + 2],
        m: 0,
    };
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    return { sim, nsBase, GT_SEQ };
}

// ── Known code words: rawWords[1] through rawWords[73] ───────────────────────
// Generated from the binary via: node -e (big-endian uint32 reads).
// These are the 73 LED-blink + UART callhome instructions burned into the
// Wukong FPGA ROM (infinite loop, no RETURN, no CALL).
const KNOWN_CODE_WORDS = [
    0x071b0000, // [1]  setup:    LOAD LED0→CR3
    0x07230001, // [2]            LOAD UART_TX→CR4
    0xaf084001, // [3]            IADD DR1=1 (LED on / STATUS offset)
    0x8f098000, // [4]  loop_top: DWRITE CR3[0]=DR1 (LED on)
    0xaf284043, // [5]            DREAD DR5=CR4[1] (UART STATUS — busy poll 'C')
    0x8f2a0000, // [6]
    0x87320001, // [7]
    0xb73b4001, // [8]
    0xb8007ffe, // [9]
    0xaf28404d, // [10]           busy-poll 'M'
    0x8f2a0000, // [11]
    0x87320001, // [12]
    0xb73b4001, // [13]
    0xb8007ffe, // [14]
    0xaf28403a, // [15]           busy-poll ':'
    0x8f2a0000, // [16]
    0x87320001, // [17]
    0xb73b4001, // [18]
    0xb8007ffe, // [19]
    0xaf284057, // [20]           busy-poll 'W'
    0x8f2a0000, // [21]
    0x87320001, // [22]
    0xb73b4001, // [23]
    0xb8007ffe, // [24]
    0xaf284055, // [25]           busy-poll 'U'
    0x8f2a0000, // [26]
    0x87320001, // [27]
    0xb73b4001, // [28]
    0xb8007ffe, // [29]
    0xaf28404b, // [30]           busy-poll 'K'
    0x8f2a0000, // [31]
    0x87320001, // [32]
    0xb73b4001, // [33]
    0xb8007ffe, // [34]
    0xaf28404f, // [35]           busy-poll 'O'
    0x8f2a0000, // [36]
    0x87320001, // [37]
    0xb73b4001, // [38]
    0xb8007ffe, // [39]
    0xaf28404e, // [40]           busy-poll 'N'
    0x8f2a0000, // [41]
    0x87320001, // [42]
    0xb73b4001, // [43]
    0xb8007ffe, // [44]
    0xaf284047, // [45]           busy-poll 'G'
    0x8f2a0000, // [46]
    0x87320001, // [47]
    0xb73b4001, // [48]
    0xb8007ffe, // [49]
    0xaf28400d, // [50]           busy-poll '\r'
    0x8f2a0000, // [51]
    0x87320001, // [52]
    0xb73b4001, // [53]
    0xb8007ffe, // [54]
    0xaf28400a, // [55]           busy-poll '\n'
    0x8f2a0000, // [56]
    0x87320001, // [57]
    0xb73b4001, // [58]
    0xb8007ffe, // [59]
    0xaf18417c, // [60]           on-phase delay outer loop (380 × 16383)
    0xaf107fff, // [61]
    0xb7114001, // [62]
    0xb8807fff, // [63]
    0xb719c001, // [64]
    0xb8807ffc, // [65]
    0x8f018000, // [66]           DWRITE CR3[0]=0 (LED off)
    0xaf18417c, // [67]           off-phase delay outer loop (380 × 16383)
    0xaf107fff, // [68]
    0xb7114001, // [69]
    0xb8807fff, // [70]
    0xb719c001, // [71]
    0xb8807ffc, // [72]
    0xbf007fbb, // [73]           BRANCH back to loop_top (word 4)
];

// ────────────────────────────────────────────────────────────────────────────
console.log('\n═══ WukongCallHome.hw binary verification ═══\n');

const lumpExists = fs.existsSync(LUMP_FILE);
check('WCH-HW-00: lump file exists on disk', lumpExists, LUMP_FILE);

if (!lumpExists) {
    console.log('\nFATAL: fixture file missing — cannot run remaining tests.');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

// Read the binary — passes expectedBytes=512 so readLumpFile throws immediately
// on any truncation, padding, or non-word-aligned file rather than silently
// masking the problem behind a word-count check.
const EXPECTED_FILE_BYTES = EXPECTED_LUMPSIZE * 4;   // 512
const rawWords = readLumpFile(LUMP_FILE, EXPECTED_FILE_BYTES);

// ── WCH-HW-02: File size ────────────────────────────────────────────────────
// readLumpFile already throws if the file isn't exactly 512 bytes or not
// word-aligned, so reaching here means both invariants held.  The checks
// below record the verified values explicitly in the test log.
console.log('\n--- WCH-HW-02: File size matches lumpSize=128 (512 bytes exactly) ---');
{
    const rawByteLength = fs.statSync(LUMP_FILE).size;
    check('WCH-HW-02a: file is exactly 512 bytes (4 × lumpSize)',
        rawByteLength === EXPECTED_FILE_BYTES,
        `got ${rawByteLength} bytes`);
    check('WCH-HW-02b: file byte length is word-aligned (divisible by 4)',
        rawByteLength % 4 === 0,
        `got ${rawByteLength} bytes`);
    check('WCH-HW-02c: rawWords.length = 128 (512 ÷ 4)',
        rawWords.length === EXPECTED_LUMPSIZE,
        `got ${rawWords.length}`);
}

// ── WCH-HW-01: Header decode ─────────────────────────────────────────────────
console.log('\n--- WCH-HW-01: Header word decode ---');
{
    const w0        = rawWords[0] >>> 0;
    const magic     = (w0 >>> 27) & 0x1F;
    const n_minus_6 = (w0 >>> 23) & 0xF;
    const cw        = (w0 >>> 10) & 0x1FFF;
    const typ       = (w0 >>>  8) & 0x3;
    const cc        = w0 & 0xFF;
    const lumpSize  = 1 << (n_minus_6 + 6);

    check('WCH-HW-01a: header magic = 0x1F (valid LUMP)',
        magic === 0x1F,
        `got 0x${magic.toString(16)}, word[0]=0x${w0.toString(16)}`);
    check('WCH-HW-01b: header cw = 73',
        cw === EXPECTED_CW,
        `got cw=${cw}`);
    check('WCH-HW-01c: header cc = 2',
        cc === EXPECTED_CC,
        `got cc=${cc}`);
    check('WCH-HW-01d: header lumpSize = 128 (n_minus_6=1 → 2^7)',
        lumpSize === EXPECTED_LUMPSIZE,
        `got lumpSize=${lumpSize} (n_minus_6=${n_minus_6})`);
    check('WCH-HW-01e: header typ = 0',
        typ === EXPECTED_TYP,
        `got typ=${typ}`);
}

// ── WCH-HW-09: parseLumpHeader agrees ────────────────────────────────────────
console.log('\n--- WCH-HW-09: sim.parseLumpHeader agrees with raw header decode ---');
{
    const sim = new ChurchSimulator();
    const hdr = sim.parseLumpHeader(rawWords[0] >>> 0);
    check('WCH-HW-09a: parseLumpHeader reports valid=true',
        hdr.valid,
        hdr ? `magic=0x${hdr.magic.toString(16)}` : 'hdr null');
    check('WCH-HW-09b: parseLumpHeader.cw = 73',
        hdr.valid && hdr.cw === EXPECTED_CW,
        `got cw=${hdr ? hdr.cw : 'N/A'}`);
    check('WCH-HW-09c: parseLumpHeader.cc = 2',
        hdr.valid && hdr.cc === EXPECTED_CC,
        `got cc=${hdr ? hdr.cc : 'N/A'}`);
    check('WCH-HW-09d: parseLumpHeader.lumpSize = 128',
        hdr.valid && hdr.lumpSize === EXPECTED_LUMPSIZE,
        `got lumpSize=${hdr ? hdr.lumpSize : 'N/A'}`);
}

// ── WCH-HW-03: All 73 code words match known binary ─────────────────────────
console.log('\n--- WCH-HW-03: words[1..73] — all 73 code words match known binary ---');
{
    let allMatch = true;
    const mismatches = [];

    for (let i = 0; i < KNOWN_CODE_WORDS.length; i++) {
        const idx      = i + 1;   // rawWords index
        const got      = rawWords[idx] >>> 0;
        const expected = KNOWN_CODE_WORDS[i] >>> 0;
        if (got !== expected) {
            allMatch = false;
            mismatches.push(`[${idx}]: got 0x${got.toString(16).padStart(8,'0')} expected 0x${expected.toString(16).padStart(8,'0')}`);
        }
    }

    check('WCH-HW-03a: all 73 code words match known binary exactly',
        allMatch,
        allMatch ? '' : `${mismatches.length} mismatch(es): ${mismatches.slice(0, 3).join('; ')}`);

    // Spot-check a few key words individually for clear diagnostics
    check('WCH-HW-03b: word[1] = 0x071b0000 (setup: LOAD LED0→CR3)',
        (rawWords[1] >>> 0) === 0x071b0000,
        `got 0x${(rawWords[1]>>>0).toString(16)}`);
    check('WCH-HW-03c: word[3] = 0xaf084001 (IADD DR1=1)',
        (rawWords[3] >>> 0) === 0xaf084001,
        `got 0x${(rawWords[3]>>>0).toString(16)}`);
    check('WCH-HW-03d: word[73] = 0xbf007fbb (BRANCH back to loop_top)',
        (rawWords[73] >>> 0) === 0xbf007fbb,
        `got 0x${(rawWords[73]>>>0).toString(16)}`);
}

// ── WCH-HW-04: Freespace region (words[74..125]) is all-zero ─────────────────
console.log('\n--- WCH-HW-04: words[74..125] — freespace region is all zero ---');
{
    // Freespace = words after last code word, before c-list
    // c-list starts at lumpSize - cc = 128 - 2 = 126
    const clistBase    = EXPECTED_LUMPSIZE - EXPECTED_CC;   // 126
    const freeStart    = EXPECTED_CW + 1;                    // 74
    const freeEnd      = clistBase - 1;                      // 125

    const freespaceWords = rawWords.slice(freeStart, clistBase);
    const nonZeroIndices = freespaceWords
        .map((w, i) => ({ w: w >>> 0, idx: freeStart + i }))
        .filter(({ w }) => w !== 0);

    check(`WCH-HW-04a: freespace is words[${freeStart}..${freeEnd}] (${freespaceWords.length} words)`,
        freespaceWords.length === clistBase - freeStart,
        `got ${freespaceWords.length}`);
    check('WCH-HW-04b: all freespace words are zero',
        nonZeroIndices.length === 0,
        nonZeroIndices.length > 0
            ? `${nonZeroIndices.length} non-zero: first at [${nonZeroIndices[0].idx}]=0x${nonZeroIndices[0].w.toString(16)}`
            : '');
}

// ── WCH-HW-05: C-list entries (words[126..127]) ──────────────────────────────
console.log('\n--- WCH-HW-05: words[126..127] — c-list entries ---');
{
    const clistBase = EXPECTED_LUMPSIZE - EXPECTED_CC;   // 126
    const cl0 = rawWords[clistBase]     >>> 0;           // slot 0: LED0
    const cl1 = rawWords[clistBase + 1] >>> 0;           // slot 1: UART_TX

    check('WCH-HW-05a: c-list slot 0 (word[126]) is non-zero',
        cl0 !== 0,
        `got 0x${cl0.toString(16)}`);
    check('WCH-HW-05b: c-list slot 1 (word[127]) is non-zero',
        cl1 !== 0,
        `got 0x${cl1.toString(16)}`);
    // Verify both look like GT words (bits[31:30] typical for hardware device GTs)
    check('WCH-HW-05c: c-list slot 0 = 0x32000003 (LED0 RW-GT, hardware)',
        cl0 === 0x32000003,
        `got 0x${cl0.toString(16)}`);
    check('WCH-HW-05d: c-list slot 1 = 0x32000002 (UART_TX W-GT, hardware)',
        cl1 === 0x32000002,
        `got 0x${cl1.toString(16)}`);
}

// ── WCH-HW-06: loadLumpBinary installs header at EXTENDED_BASE ───────────────
console.log('\n--- WCH-HW-06: loadLumpBinary installs header at EXTENDED_BASE (0x0400) ---');
{
    const { sim, nsBase } = setupSimForBinary();
    const loaded = sim.loadLumpBinary(rawWords);

    check('WCH-HW-06a: loadLumpBinary returns true',
        loaded === true);
    check('WCH-HW-06b: memory[0x0400] = header word (LUMP placed at EXTENDED_BASE)',
        (sim.memory[EXTENDED_BASE] >>> 0) === (rawWords[0] >>> 0),
        `got 0x${(sim.memory[EXTENDED_BASE]>>>0).toString(16)}`);
    check('WCH-HW-06c: NS[bootEntrySlot].word0 = EXTENDED_BASE',
        sim.memory[nsBase + 0] === EXTENDED_BASE,
        `got 0x${sim.memory[nsBase+0].toString(16)}`);
}

// ── WCH-HW-07: NS authority has limit; LUMP header has c-list count ──────────
console.log('\n--- WCH-HW-07: NS word1 encodes limit=73; resident header encodes cc=2 ---');
{
    const { sim, nsBase } = setupSimForBinary();
    sim.loadLumpBinary(rawWords);

    const nsW1   = sim.memory[nsBase + 1];
    const parsed = sim.parseNSWord1(nsW1);

    check('WCH-HW-07a: NS[bootEntrySlot].word1 limit = 73 (cw)',
        parsed.limit === EXPECTED_CW,
        `got limit=${parsed.limit}`);
    const residentHeader = sim.parseLumpHeader(sim.memory[EXTENDED_BASE] >>> 0);
    check('WCH-HW-07b: resident LUMP header cc = 2 (not duplicated in NS word1)',
        residentHeader.cc === EXPECTED_CC,
        `got header cc=${residentHeader.cc}`);
}

// ── WCH-HW-08: CR14.word1 = EXTENDED_BASE after load ────────────────────────
console.log('\n--- WCH-HW-08: CR14.word1 = EXTENDED_BASE (0x0400) after loadLumpBinary ---');
{
    const { sim } = setupSimForBinary();
    sim.loadLumpBinary(rawWords);

    check('WCH-HW-08: CR14.word1 = 0x0400',
        sim.cr[14].word1 === EXTENDED_BASE,
        `got 0x${sim.cr[14].word1.toString(16)}`);
}

// ── WCH-HW-10: All code words survive load intact in simulator memory ─────────
console.log('\n--- WCH-HW-10: All 73 code words survive loadLumpBinary intact ---');
{
    const { sim } = setupSimForBinary();
    sim.loadLumpBinary(rawWords);

    let allIntact = true;
    const mismatches = [];

    for (let i = 0; i < KNOWN_CODE_WORDS.length; i++) {
        const physAddr = EXTENDED_BASE + 1 + i;   // header at +0, code at +1
        const got      = sim.memory[physAddr] >>> 0;
        const expected = KNOWN_CODE_WORDS[i] >>> 0;
        if (got !== expected) {
            allIntact = false;
            mismatches.push(`[mem 0x${physAddr.toString(16)}]: got 0x${got.toString(16).padStart(8,'0')} expected 0x${expected.toString(16).padStart(8,'0')}`);
        }
    }

    check('WCH-HW-10a: all 73 code words intact at memory[0x0401..0x0449]',
        allIntact,
        allIntact ? '' : `${mismatches.length} mismatch(es): ${mismatches.slice(0, 3).join('; ')}`);

    // Spot-check: first and last code words in memory
    check('WCH-HW-10b: memory[0x0401] = 0x071b0000 (first code word)',
        (sim.memory[EXTENDED_BASE + 1] >>> 0) === 0x071b0000,
        `got 0x${(sim.memory[EXTENDED_BASE + 1]>>>0).toString(16)}`);
    check('WCH-HW-10c: memory[0x0449] = 0xbf007fbb (last code word — BRANCH)',
        (sim.memory[EXTENDED_BASE + 73] >>> 0) === 0xbf007fbb,
        `got 0x${(sim.memory[EXTENDED_BASE + 73]>>>0).toString(16)}`);

    // Also verify freespace in simulator memory is zero (no stale data)
    const clistBase   = EXPECTED_LUMPSIZE - EXPECTED_CC;   // 126
    const freePhysBase = EXTENDED_BASE + EXPECTED_CW + 1;   // 0x0400 + 74
    const freePhysEnd  = EXTENDED_BASE + clistBase;          // 0x0400 + 126
    let freeAllZero = true;
    for (let addr = freePhysBase; addr < freePhysEnd; addr++) {
        if ((sim.memory[addr] >>> 0) !== 0) {
            freeAllZero = false;
            break;
        }
    }
    check('WCH-HW-10d: freespace in simulator memory (0x044a..0x047d) is all zero',
        freeAllZero);
}

// ── WCH-HW-11: Dotted capability calls use the ROM's direct entry ────────────
console.log('\n--- WCH-HW-11: WukongCallHome.hw dispatches through its direct entry ---');
{
    const sidecar = JSON.parse(fs.readFileSync(SIDECAR_FILE, 'utf8'));
    const setupEntry = (sidecar.methods || []).find(method => method.name === 'setup');
    check('WCH-HW-11a: sidecar names the complete dotted capability label',
        sidecar.abstraction === 'WukongCallHome.hw' &&
        sidecar.dot_name === 'WukongCallHome.hw',
        `abstraction=${sidecar.abstraction} dot_name=${sidecar.dot_name}`);
    check('WCH-HW-11b: hardware ROM setup/default entry starts at code offset 0',
        setupEntry && setupEntry.offset === 0,
        setupEntry ? `offset=${setupEntry.offset}` : 'setup method missing');

    const assembled = new ChurchAssembler().assemble(
        'capabilities { Other E, WukongCallHome.hw E }\n' +
        'CALL wukongcallhome.HW'
    );
    const callWord = assembled.words[0] >>> 0;
    check('WCH-HW-11c: assembler emits ELOADCALL row 1 with direct selector 0',
        assembled.errors.length === 0 &&
        ((callWord >>> 27) & 0x1F) === 8 &&
        ((callWord >>> 15) & 0xF) === 6 &&
        (callWord & 0x1F) === 1 &&
        ((callWord >>> 5) & 0x7F) === 0,
        `errors=${assembled.errors.map(error => error.message).join('; ')} word=0x${callWord.toString(16)}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

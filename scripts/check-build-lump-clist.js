#!/usr/bin/env node
// scripts/check-build-lump-clist.js
//
// For each canonical build script that compiles a .cloomc source file into a
// LUMP binary, this check verifies that the hardcoded CLIST array matches the
// capabilities{} block declared in the corresponding .cloomc source.
//
// A future edit that adds or renames a capability in the .cloomc source without
// updating the build script's CLIST would silently produce a binary with the
// wrong c-list.  This script catches that drift before it ships.
//
// Checked pairs:
//   scripts/build_capability_test_lump.js  ↔  simulator/examples/capability_test.cloomc
//   scripts/build_selftest_lump.js         ↔  simulator/examples/post_flash_selftest.cloomc
//   scripts/build_wukong_callhome_lump.js  ↔  simulator/examples/wukong_callhome.cloomc
//
// What is compared:
//   1. Count — CLIST.length must equal the number of capabilities{} entries.
//   2. Names — each slot's name must match in order (position = c-list slot index).
//   3. Rights — derived by DECODING THE GT BITFIELD, not from the optional `rights:`
//      metadata array or inline comments (those are documentation only).
//      The GT bits are the authority for what is actually written into the binary.
//
// GT encoding (v2.0):
//   [31]    b_flag  — always 0 for standard entries
//   [30:28] perm3   — Church E: 0b100=4; Turing RW: 0b011=3; Turing W: 0b010=2; Turing R: 0b001=1
//   [27]    dom     — Church=1, Turing=0
//   [26:25] gt_type — Inform=0b01
//   [24:16] gt_seq  = 0
//   [15:0]  slot    = NS slot index
//
// Rights widening (CLIST GT encodes broader rights than source declares) is
// allowed and emits an informational note.  Rights narrowing (GT encodes fewer
// rights than source declares) is a hard failure.
//
// Usage:
//   node scripts/check-build-lump-clist.js            # run pair checks
//   node scripts/check-build-lump-clist.js --self-test # run internal unit tests
//
// Exit codes:
//   0 — all pairs pass (or all self-tests pass)
//   1 — one or more mismatches or self-test failures found

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');

// ---------------------------------------------------------------------------
// Pairs to check
// ---------------------------------------------------------------------------

const PAIRS = [
    {
        label:       'capability_test',
        buildScript: path.join(ROOT, 'scripts', 'build_capability_test_lump.js'),
        source:      path.join(ROOT, 'simulator', 'examples', 'capability_test.cloomc'),
    },
    {
        label:       'post_flash_selftest',
        buildScript: path.join(ROOT, 'scripts', 'build_selftest_lump.js'),
        source:      path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc'),
    },
    {
        label:       'wukong_callhome',
        buildScript: path.join(ROOT, 'scripts', 'build_wukong_callhome_lump.js'),
        source:      path.join(ROOT, 'simulator', 'examples', 'wukong_callhome.cloomc'),
    },
];

// ---------------------------------------------------------------------------
// GT bitfield decoder — derives effective rights from the raw GT word.
//
// This is the authoritative rights mapping; the optional `rights:` array in the
// build script is documentation only and is NOT used for the comparison.
//
// Returns a sorted array of uppercase right letters, e.g. ['E'], ['R','W'].
// Returns null if the perm encoding is unrecognised.
// ---------------------------------------------------------------------------

function decodeGTRights(gt) {
    const perm3 = (gt >>> 28) & 0x7;
    const dom   = (gt >>> 27) & 0x1;

    if (dom === 1) {
        // Church domain
        if (perm3 === 4) return ['E'];
        return null; // unrecognised Church perm
    }
    // Turing domain
    if (perm3 === 3) return ['R', 'W'];
    if (perm3 === 2) return ['W'];
    if (perm3 === 1) return ['R'];
    if (perm3 === 0) return [];
    return null; // unrecognised Turing perm
}

// ---------------------------------------------------------------------------
// Normalise a source rights string to a sorted array.
//   'E'  → ['E']
//   'RW' → ['R','W']
//   'R'  → ['R']
//   'W'  → ['W']
// ---------------------------------------------------------------------------

function parseSourceRights(str) {
    const s = str.trim().toUpperCase();
    if (s === 'E')              return ['E'];
    if (s === 'RW' || s === 'WR') return ['R', 'W'];
    if (s === 'R')              return ['R'];
    if (s === 'W')              return ['W'];
    return [...new Set(s.split('').filter(c => /[A-Z]/.test(c)))].sort();
}

// ---------------------------------------------------------------------------
// Parse the capabilities{} block from .cloomc source text.
//
// Handles both comma-separated and semicolon-commented formats:
//   SelfTest E,
//   LED_DEV  RW,
//   SelfTest     E          ; slot 0 — comment
//
// Returns an array of { name, rights } in declaration order, or null.
// ---------------------------------------------------------------------------

function parseSourceCapabilities(text) {
    const blockMatch = text.match(/capabilities\s*\{([^}]*)\}/s);
    if (!blockMatch) return null;
    const block = blockMatch[1];

    const entries = [];
    for (const rawLine of block.split('\n')) {
        const line = rawLine.replace(/;.*$/, '').replace(/,\s*$/, '').trim();
        if (!line) continue;
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z]+)\s*$/);
        if (!m) continue;
        entries.push({ name: m[1], rights: parseSourceRights(m[2]) });
    }

    return entries.length > 0 ? entries : null;
}

// ---------------------------------------------------------------------------
// Parse the CLIST array from build script text.
//
// For each { ... } entry:
//   - Always extracts `gt: 0x...` — the authority for rights.
//   - Name strategy A: name: 'Foo' property.
//   - Name strategy B: inline comment  // N  CapabilityName  ...
//
// Returns an array of { name, gt, decodedRights } in declaration order, or null.
// ---------------------------------------------------------------------------

function parseBuildScriptCLIST(text) {
    const clistMatch = text.match(/const\s+CLIST\s*=\s*\[([\s\S]*?)\];/);
    if (!clistMatch) return null;
    const block = clistMatch[1];

    const entries = [];
    let i = 0;

    while (i < block.length) {
        if (block[i] !== '{') { i++; continue; }

        // Scan for matching closing brace.
        let depth = 0;
        let j = i;
        while (j < block.length) {
            if      (block[j] === '{') depth++;
            else if (block[j] === '}') { depth--; if (depth === 0) break; }
            j++;
        }

        const objText  = block.slice(i, j + 1);
        const afterObj = block.slice(j + 1).split('\n')[0];

        // GT value — required.
        const gtMatch = objText.match(/\bgt\s*:\s*(0x[0-9A-Fa-f]+|\d+)/);
        if (!gtMatch) {
            entries.push({ name: '(no gt)', gt: null, decodedRights: null });
            i = j + 1;
            continue;
        }
        const gt           = parseInt(gtMatch[1], 16);
        const decodedRights = decodeGTRights(gt);

        // Name: prefer explicit property, fall back to inline comment.
        const namePropMatch = objText.match(/\bname\s*:\s*['"]([^'"]+)['"]/);
        let name;
        if (namePropMatch) {
            name = namePropMatch[1];
        } else {
            const commentMatch = afterObj.match(/\/\/\s*\d+\s+(\S+)/);
            name = commentMatch ? commentMatch[1] : '(unnamed)';
        }

        entries.push({ name, gt, decodedRights });
        i = j + 1;
    }

    return entries.length > 0 ? entries : null;
}

// ---------------------------------------------------------------------------
// Format a rights array for display.
// ---------------------------------------------------------------------------

function rightsStr(arr) {
    if (!arr || arr.length === 0) return '(none)';
    return arr.join('');
}

// ---------------------------------------------------------------------------
// Core comparison — works on already-parsed data.
// Returns { ok: boolean, lines: string[] }.
//
// Kept separate from file I/O so self-tests can call it directly with
// synthetic inputs without any wrapper or redefinition tricks.
// ---------------------------------------------------------------------------

function compareCaps(sourceCaps, clistEntries, label) {
    const lines = [];
    let   ok    = true;

    // (1) Count check.
    if (sourceCaps.length !== clistEntries.length) {
        ok = false;
        lines.push(`   FAIL  count mismatch:`);
        lines.push(`         source capabilities: ${sourceCaps.length} entries`);
        lines.push(`         build script CLIST:  ${clistEntries.length} entries`);
        lines.push(`         source:  ${sourceCaps.map(e => e.name).join(', ')}`);
        lines.push(`         CLIST:   ${clistEntries.map(e => e.name).join(', ')}`);
    }

    // (2) Per-slot name + GT-decoded rights comparison.
    const maxLen = Math.max(sourceCaps.length, clistEntries.length);
    for (let slot = 0; slot < maxLen; slot++) {
        const src = sourceCaps[slot];
        const cle = clistEntries[slot];

        if (!src) {
            lines.push(`   FAIL  slot ${slot}: missing in source capabilities (CLIST has '${cle.name}')`);
            ok = false;
            continue;
        }
        if (!cle) {
            lines.push(`   FAIL  slot ${slot}: missing in CLIST (source has '${src.name}')`);
            ok = false;
            continue;
        }

        const nameMismatch = (src.name !== cle.name);

        let rightsFail = false;
        let rightsNote = false;
        let rightsMsg  = '';

        if (cle.gt === null) {
            rightsFail = true;
            rightsMsg  = `slot ${slot} (${src.name}): CLIST entry has no gt value`;
        } else if (cle.decodedRights === null) {
            rightsFail = true;
            rightsMsg  = (
                `slot ${slot} (${src.name}): GT 0x${cle.gt.toString(16).padStart(8,'0')} ` +
                `has unrecognised perm encoding`
            );
        } else {
            const srcSet  = new Set(src.rights);
            const cleSet  = new Set(cle.decodedRights);
            const missing = src.rights.filter(r => !cleSet.has(r));
            const extra   = cle.decodedRights.filter(r => !srcSet.has(r));

            if (missing.length > 0) {
                rightsFail = true;
                rightsMsg  = (
                    `slot ${slot} (${src.name}): GT 0x${cle.gt.toString(16).padStart(8,'0')} ` +
                    `encodes ${rightsStr(cle.decodedRights)}, ` +
                    `but source declares ${rightsStr(src.rights)} — ` +
                    `missing right(s): ${missing.join('')}`
                );
            } else if (extra.length > 0) {
                rightsNote = true;
                rightsMsg  = (
                    `slot ${slot} (${src.name}): GT 0x${cle.gt.toString(16).padStart(8,'0')} ` +
                    `encodes ${rightsStr(cle.decodedRights)} but source declares ${rightsStr(src.rights)} ` +
                    `— binary grants wider rights than declared (verify intentional)`
                );
            }
        }

        if (nameMismatch) {
            lines.push(`   FAIL  slot ${slot}: name mismatch — source '${src.name}', CLIST '${cle.name}'`);
            ok = false;
        }
        if (rightsFail) {
            lines.push(`   FAIL  ${rightsMsg}`);
            ok = false;
        } else if (rightsNote) {
            lines.push(`   note  ${rightsMsg}`);
        }

        if (!nameMismatch && !rightsFail) {
            const r    = cle.decodedRights ? rightsStr(cle.decodedRights) : '?';
            const note = rightsNote ? '  (wider than declared)' : '';
            lines.push(`   ok    slot ${slot}  ${src.name}  ${r}${note}`);
        }
    }

    if (ok) lines.push(`   PASS  (${sourceCaps.length} slots match)`);
    return { ok, lines };
}

// ---------------------------------------------------------------------------
// checkPair — reads both files and delegates to compareCaps.
// ---------------------------------------------------------------------------

function checkPair(pair) {
    const lines     = [];
    const buildRel  = path.relative(ROOT, pair.buildScript);
    const sourceRel = path.relative(ROOT, pair.source);

    lines.push(`\n── ${pair.label} ──`);
    lines.push(`   source:       ${sourceRel}`);
    lines.push(`   build script: ${buildRel}`);

    let buildText, sourceText;
    try { buildText  = fs.readFileSync(pair.buildScript, 'utf8'); }
    catch (e) {
        lines.push(`   ERROR: cannot read build script: ${e.message}`);
        return { ok: false, lines };
    }
    try { sourceText = fs.readFileSync(pair.source, 'utf8'); }
    catch (e) {
        lines.push(`   ERROR: cannot read source file: ${e.message}`);
        return { ok: false, lines };
    }

    const sourceCaps   = parseSourceCapabilities(sourceText);
    const clistEntries = parseBuildScriptCLIST(buildText);

    if (!sourceCaps) {
        lines.push(`   ERROR: no capabilities{} block found in ${sourceRel}`);
        return { ok: false, lines };
    }
    if (!clistEntries) {
        lines.push(`   ERROR: no CLIST array found in ${buildRel}`);
        return { ok: false, lines };
    }

    const { ok, lines: cmpLines } = compareCaps(sourceCaps, clistEntries, pair.label);
    return { ok, lines: lines.concat(cmpLines) };
}

// ---------------------------------------------------------------------------
// Inline self-tests — verify parsers and compareCaps with synthetic inputs.
// Run with  --self-test.
// ---------------------------------------------------------------------------

function runSelfTests() {
    let failures = 0;

    function assert(condition, label) {
        if (!condition) { console.error(`  FAIL  ${label}`); failures++; }
        else              console.log(`  ok    ${label}`);
    }

    // Helper: parse synthetic source + CLIST texts and run compareCaps.
    function syntheticCheck(srcText, buildText) {
        const sc = parseSourceCapabilities(srcText);
        const cl = parseBuildScriptCLIST(buildText);
        if (!sc || !cl) return { ok: false, lines: ['parse error'] };
        return compareCaps(sc, cl, 'test');
    }

    // ── GT decoder ────────────────────────────────────────────────────────────
    assert(JSON.stringify(decodeGTRights(0x4A000006)) === '["E"]',
           'GT 0x4A000006 decodes to E (Church E-perm)');
    assert(JSON.stringify(decodeGTRights(0x32000003)) === '["R","W"]',
           'GT 0x32000003 decodes to RW (Turing RW)');
    assert(JSON.stringify(decodeGTRights(0x12000004)) === '["R"]',
           'GT 0x12000004 decodes to R (Turing R-only)');
    assert(JSON.stringify(decodeGTRights(0x22000000)) === '["W"]',
           'GT 0x22000000 decodes to W (Turing W-only)');
    assert(decodeGTRights(0x5A000000) === null,
           'GT with unrecognised Church perm3=5 returns null');

    // ── Source capabilities parser — comma format ─────────────────────────────
    const srcComma = parseSourceCapabilities(
        'capabilities {\n    SelfTest E,\n    LED_DEV RW,\n    BTN_DEV R,\n    UART_TX W\n}\n'
    );
    assert(srcComma !== null && srcComma.length === 4,
           'comma-format: 4 entries parsed');
    assert(srcComma && srcComma[0].name === 'SelfTest' &&
           JSON.stringify(srcComma[0].rights) === '["E"]',
           'comma-format: slot 0 = SelfTest E');
    assert(srcComma && srcComma[1].name === 'LED_DEV' &&
           JSON.stringify(srcComma[1].rights) === '["R","W"]',
           'comma-format: slot 1 = LED_DEV RW');
    assert(srcComma && srcComma[2].name === 'BTN_DEV' &&
           JSON.stringify(srcComma[2].rights) === '["R"]',
           'comma-format: slot 2 = BTN_DEV R');
    assert(srcComma && srcComma[3].name === 'UART_TX' &&
           JSON.stringify(srcComma[3].rights) === '["W"]',
           'comma-format: slot 3 = UART_TX W');

    // ── Source capabilities parser — semicolon-comment format ─────────────────
    const srcSemi = parseSourceCapabilities(
        'capabilities {\n    SelfTest     E          ; slot 0\n    Next         E          ; slot 1\n}\n'
    );
    assert(srcSemi !== null && srcSemi.length === 2,
           'semicolon-format: 2 entries parsed');
    assert(srcSemi && srcSemi[0].name === 'SelfTest', 'semicolon-format: slot 0 = SelfTest');
    assert(srcSemi && srcSemi[1].name === 'Next',     'semicolon-format: slot 1 = Next');

    // ── CLIST parser — named entries (capability_test / wukong_callhome format) ─
    const namedCLIST = parseBuildScriptCLIST(
        "const CLIST = [\n" +
        "    { gt: 0x4A000006, name: 'SelfTest', ns_slot: 6, rights: ['E'], note: '' },\n" +
        "    { gt: 0x32000003, name: 'LED_DEV',  ns_slot: 3, rights: ['R','W'], note: '' },\n" +
        "    { gt: 0x12000004, name: 'BTN_DEV',  ns_slot: 4, rights: ['R'], note: '' },\n" +
        "];\n"
    );
    assert(namedCLIST !== null && namedCLIST.length === 3,
           'named CLIST: 3 entries parsed');
    assert(namedCLIST && namedCLIST[0].name === 'SelfTest' &&
           JSON.stringify(namedCLIST[0].decodedRights) === '["E"]',
           'named CLIST: slot 0 = SelfTest, decoded E from gt');
    assert(namedCLIST && namedCLIST[1].name === 'LED_DEV' &&
           JSON.stringify(namedCLIST[1].decodedRights) === '["R","W"]',
           'named CLIST: slot 1 = LED_DEV, decoded RW from gt');
    assert(namedCLIST && namedCLIST[2].name === 'BTN_DEV' &&
           JSON.stringify(namedCLIST[2].decodedRights) === '["R"]',
           'named CLIST: slot 2 = BTN_DEV, decoded R from gt');

    // ── CLIST parser — comment-only entries (post_flash_selftest format) ──────
    const commentCLIST = parseBuildScriptCLIST(
        "const CLIST = [\n" +
        "    { gt: 0x4A000006 }, // 0  SelfTest  E  NS slot 6  — E-GT\n" +
        "    { gt: 0x4A000006 }, // 1  Next      E  template\n" +
        "];\n"
    );
    assert(commentCLIST !== null && commentCLIST.length === 2,
           'comment-only CLIST: 2 entries parsed');
    assert(commentCLIST && commentCLIST[0].name === 'SelfTest' &&
           JSON.stringify(commentCLIST[0].decodedRights) === '["E"]',
           'comment-only CLIST: slot 0 SelfTest, rights from gt 0x4A000006 (not comment)');
    assert(commentCLIST && commentCLIST[1].name === 'Next' &&
           JSON.stringify(commentCLIST[1].decodedRights) === '["E"]',
           'comment-only CLIST: slot 1 Next, rights from gt 0x4A000006 (not comment)');

    // ── Drift: name mismatch ──────────────────────────────────────────────────
    {
        const r = syntheticCheck(
            'capabilities {\n    BTN_DEV R\n}\n',
            "const CLIST = [\n    { gt: 0x12000004, name: 'BUTTON_DEV', ns_slot: 4, rights: ['R'] },\n];\n"
        );
        assert(!r.ok && r.lines.some(l => l.includes('FAIL') && l.includes('name mismatch')),
               'drift: name mismatch (BTN_DEV vs BUTTON_DEV) → FAIL');
    }

    // ── Drift: GT encodes fewer rights than source (narrowing) ────────────────
    // Source: RW.  GT 0x12000004 encodes R-only.  Must fail.
    {
        const r = syntheticCheck(
            'capabilities {\n    LED_DEV RW\n}\n',
            "const CLIST = [\n    { gt: 0x12000004, name: 'LED_DEV', ns_slot: 4, rights: ['R'] },\n];\n"
        );
        assert(!r.ok && r.lines.some(l => l.includes('FAIL') && l.includes('missing right')),
               'drift: GT 0x12000004 encodes R, source declares RW — narrowing → FAIL');
    }

    // ── Drift: comment-only CLIST with wrong GT (comment says E, GT encodes R) ─
    // The comment says "E" but the gt is 0x12000006 (Turing R-only).
    // The check must use the GT, not the comment, and must fail.
    {
        const r = syntheticCheck(
            'capabilities {\n    SelfTest E\n}\n',
            "const CLIST = [\n    { gt: 0x12000006 }, // 0  SelfTest  E  NS slot 6\n];\n"
        );
        assert(!r.ok && r.lines.some(l => l.includes('FAIL') && l.includes('missing right')),
               'comment-only CLIST: GT 0x12000006 encodes R but comment says E — GT wins → FAIL');
    }

    // ── Rights widening (W source, RW GT) — allowed, emits note, does not fail ─
    {
        const r = syntheticCheck(
            'capabilities {\n    UART_TX W\n}\n',
            "const CLIST = [\n    { gt: 0x32000002, name: 'UART_TX', ns_slot: 2, rights: ['R','W'] },\n];\n"
        );
        assert(r.ok,
               'widening: source W, GT RW (0x32000002) → PASS');
        assert(r.lines.some(l => l.includes('note') && l.includes('wider')),
               'widening: informational note emitted');
    }

    // ── Count mismatch ────────────────────────────────────────────────────────
    {
        const r = syntheticCheck(
            'capabilities {\n    LED_DEV RW,\n    BTN_DEV R\n}\n',
            "const CLIST = [\n    { gt: 0x32000003, name: 'LED_DEV', ns_slot: 3, rights: ['R','W'] },\n];\n"
        );
        assert(!r.ok && r.lines.some(l => l.includes('count mismatch')),
               'count mismatch: source 2 entries, CLIST 1 → FAIL');
    }

    console.log('');
    if (failures > 0) {
        console.error(`check-build-lump-clist --self-test: ${failures} failure(s).`);
        process.exit(1);
    }
    console.log(`check-build-lump-clist --self-test: all tests pass.`);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (SELF_TEST) {
    console.log('check-build-lump-clist: running self-tests...\n');
    runSelfTests();
}

let violations = 0;
const allLines = [];

for (const pair of PAIRS) {
    const { ok, lines } = checkPair(pair);
    allLines.push(...lines);
    if (!ok) violations++;
}

for (const line of allLines) {
    if (line.includes('FAIL') || line.includes('ERROR')) {
        console.error(line);
    } else {
        console.log(line);
    }
}

console.log('');

if (violations > 0) {
    console.error(
        `check-build-lump-clist: ${violations} pair(s) have a mismatch between` +
        ` the capabilities{} block and the build script CLIST.`
    );
    console.error('');
    console.error('To fix: update the CLIST array in the build script to match the');
    console.error('capability names (and slot order) declared in the .cloomc source,');
    console.error('then rebuild the affected LUMP binary.');
    process.exit(1);
} else {
    console.log(`check-build-lump-clist: all ${PAIRS.length} pair(s) pass.`);
}

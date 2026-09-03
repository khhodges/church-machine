'use strict';
// test_editor_roundtrip.js — Round-trip test for Task #2108
//
// Confirms that the structured source emitted by openLumpInEditor's
// reconstruction path (`method Name { ... }` blocks) compiles back through
// CLOOMCCompiler to code words that match the original LUMP binary.
//
// Steps exercised per test case:
//   1. Assemble a known N-method LUMP with assembleLump().
//   2. Run the reconstruction logic (mirrors openLumpInEditor lines 4463-4513)
//      to produce `method Name { assembly mnemonics }` source text.
//   3. Re-compile that source through CLOOMCCompiler.compile().
//   4. Assert each method's re-compiled code array matches the original body.
//   5. Re-assemble with assembleLump() and verify the code region is identical.
//
// Run:  node simulator/test_editor_roundtrip.js
//
// Coverage:
//   T-ER01 — 2-method LUMP (Alpha/Beta): full round-trip, code words match
//   T-ER02 — 3-method LUMP (Init/Run/Halt): variable-length bodies
//   T-ER03 — BRANCH dispatch table words are NOT present in any method body
//   T-ER04 — reconstructSource() returns null when table entry is not BRANCH
//   T-ER05 — Empty method body reconstructs to "; (empty)" and re-compiles
//   T-ER06 — re-assembleLump of re-compiled code produces binary-equal table
//   T-ER08 — startup restores a saved personal owner before a stale generic buffer

const fs   = require('fs');
const path = require('path');

// ChurchAssembler must be on global before CLOOMCCompiler is required
// (CLOOMCCompiler guards: typeof ChurchAssembler !== 'undefined').
const ChurchAssembler = require('./assembler.js');
global.ChurchAssembler = ChurchAssembler;

const CLOOMCCompiler  = require('./cloomc_compiler.js');
const { assembleLump, decodeBranchEntry, BRANCH_OPCODE } = require('./lump_assembler.js');

// ── Shared constants ──────────────────────────────────────────────────────────

// RETURN AL (opcode=3, cond=AL=14, all other fields 0)
// (3<<27)|(14<<23) = 0x1F000000
const RETURN_WORD = ((3 << 27) | (14 << 23)) >>> 0;

// ── reconstructSource: mirrors the structured-block emitter in openLumpInEditor
// (app-lumps.js lines 4463-4513).
//
// Inputs:
//   lumpName    — string label for the comment header
//   trimmed     — uint32 array: lump code words with header stripped + zero-trimmed
//   methodNames — array of method name strings (length = N)
//
// Returns the reconstructed source text string, or null if the BRANCH guard fails.
function reconstructSource(lumpName, trimmed, methodNames) {
    var N = methodNames.length;
    if (!trimmed || trimmed.length < N) return null;

    var BRANCH_OP = BRANCH_OPCODE;
    var allBranch = methodNames.every(function(_, i) {
        return ((trimmed[i] >>> 27) & 0x1F) === BRANCH_OP;
    });
    if (!allBranch) return null;

    var bodyStarts = methodNames.map(function(_, i) {
        var raw  = trimmed[i] & 0x7FFF;
        var soff = (raw & 0x4000) ? (raw | 0xFFFF8000) : raw;
        return i + soff;
    });

    var lines = [
        '; ' + lumpName + '  (' + trimmed.length + ' words, cc=0)'
    ];

    for (var mi = 0; mi < N; mi++) {
        var mStart = bodyStarts[mi];
        var mEnd   = (mi + 1 < N) ? bodyStarts[mi + 1] : trimmed.length;
        var slice  = trimmed.slice(mStart, mEnd);
        var sliceTrim = slice.length;
        while (sliceTrim > 0 && slice[sliceTrim - 1] === 0) sliceTrim--;
        var body  = slice.slice(0, sliceTrim);
        var mName = methodNames[mi];

        lines.push('method ' + mName + ' {  ; selector #' + (mi + 1));
        if (body.length === 0) {
            lines.push('  ; (empty)');
        } else {
            var bodyLines = ChurchAssembler.decompileWords(body);
            bodyLines.forEach(function(l) { lines.push('  ' + l); });
        }
        lines.push('}');
        lines.push('');
    }

    return lines.join('\n');
}

function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('missing function ' + name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unterminated function ' + name);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip LUMP header, zero-trim, return the trimmed code-word array.
function trimmedCodeWords(buf, totalWords) {
    var raw = Array.from(buf).slice(1, totalWords);
    var len = raw.length;
    while (len > 0 && raw[len - 1] === 0) len--;
    return raw.slice(0, len);
}

// ── Test harness ──────────────────────────────────────────────────────────────
var pass = 0;
var fail = 0;
function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : ''));
        fail++;
    }
}

// ── T-ER01: 2-method LUMP (Alpha/Beta) full round-trip ────────────────────────
// Bodies:  Alpha = [RETURN_WORD, RETURN_WORD]   (2 words)
//          Beta  = [RETURN_WORD]                (1 word)
// RETURN disassembles to "RETURN"; RETURN recompiles to RETURN_WORD — tight loop.
console.log('\n--- T-ER01: 2-method LUMP (Alpha/Beta) round-trip ---');
{
    var METHOD_NAMES = ['Alpha', 'Beta'];
    var bodyA = [RETURN_WORD, RETURN_WORD];
    var bodyB = [RETURN_WORD];

    var asm1 = assembleLump([bodyA, bodyB]);
    var trimmed1 = trimmedCodeWords(asm1.buf, asm1.totalWords);

    // Step 1: sanity-check the assembled LUMP
    check('T-ER01a: assembleLump produced words', asm1.totalWords > 1);
    check('T-ER01b: table entry 0 is BRANCH opcode',
        ((trimmed1[0] >>> 27) & 0x1F) === BRANCH_OPCODE);
    check('T-ER01c: table entry 1 is BRANCH opcode',
        ((trimmed1[1] >>> 27) & 0x1F) === BRANCH_OPCODE);

    // Step 2: reconstruction
    var src1 = reconstructSource('TestLump', trimmed1, METHOD_NAMES);
    check('T-ER01d: reconstructed source is non-null', src1 !== null);
    check('T-ER01e: source contains "method Alpha"', src1 !== null && src1.includes('method Alpha'));
    check('T-ER01f: source contains "method Beta"',  src1 !== null && src1.includes('method Beta'));
    check('T-ER01g: source contains "RETURN"',       src1 !== null && src1.includes('RETURN'));

    // Step 3: re-compile
    var compiler1 = new CLOOMCCompiler();
    var compiled1 = compiler1.compile(src1 || '', []);
    check('T-ER01h: no compile errors',
        compiled1.errors.length === 0,
        compiled1.errors.map(function(e) { return e.message; }).join('; '));
    check('T-ER01i: 2 methods compiled', compiled1.methods.length === 2, compiled1.methods.length);

    if (compiled1.errors.length === 0 && compiled1.methods.length === 2) {
        var cA = compiled1.methods[0].code;
        var cB = compiled1.methods[1].code;

        // Step 4: verify code arrays match original bodies word-for-word
        check('T-ER01j: Alpha code length = 2', cA.length === 2, cA.length);
        check('T-ER01k: Alpha[0] = RETURN_WORD',
            cA[0] === RETURN_WORD,
            '0x' + (cA[0] >>> 0).toString(16) + ' vs 0x' + RETURN_WORD.toString(16));
        check('T-ER01l: Alpha[1] = RETURN_WORD',
            cA[1] === RETURN_WORD,
            '0x' + (cA[1] >>> 0).toString(16) + ' vs 0x' + RETURN_WORD.toString(16));
        check('T-ER01m: Beta code length = 1', cB.length === 1, cB.length);
        check('T-ER01n: Beta[0] = RETURN_WORD',
            cB[0] === RETURN_WORD,
            '0x' + (cB[0] >>> 0).toString(16) + ' vs 0x' + RETURN_WORD.toString(16));

        // Step 5: re-assemble and compare the body region of the new binary
        var asm1b = assembleLump([cA, cB]);
        var bo1b  = asm1b.bodyOffsets;
        var bodyA2 = Array.from(asm1b.buf).slice(1 + bo1b[0], 1 + bo1b[1]);
        var bodyB2 = Array.from(asm1b.buf).slice(1 + bo1b[1], 1 + bo1b[1] + cB.length);
        check('T-ER01o: re-assembled Alpha body == original',
            bodyA2.length === bodyA.length && bodyA2.every(function(w, i) { return w === bodyA[i]; }),
            JSON.stringify(bodyA2) + ' vs ' + JSON.stringify(bodyA));
        check('T-ER01p: re-assembled Beta body == original',
            bodyB2.length === bodyB.length && bodyB2.every(function(w, i) { return w === bodyB[i]; }),
            JSON.stringify(bodyB2) + ' vs ' + JSON.stringify(bodyB));
    }
}

// ── T-ER02: 3-method LUMP (Init/Run/Halt) variable-length bodies ──────────────
// Bodies:  Init = [RETURN_WORD]                   (1 word)
//          Run  = [RETURN_WORD, RETURN_WORD, RETURN_WORD] (3 words)
//          Halt = [RETURN_WORD, RETURN_WORD]       (2 words — different from Init)
console.log('\n--- T-ER02: 3-method LUMP (Init/Run/Halt) variable-length round-trip ---');
{
    var METHOD_NAMES2 = ['Init', 'Run', 'Halt'];
    var bodyI = [RETURN_WORD];
    var bodyR = [RETURN_WORD, RETURN_WORD, RETURN_WORD];
    var bodyH = [RETURN_WORD, RETURN_WORD];

    var asm2 = assembleLump([bodyI, bodyR, bodyH]);
    var trimmed2 = trimmedCodeWords(asm2.buf, asm2.totalWords);

    var src2 = reconstructSource('ThreeMethod', trimmed2, METHOD_NAMES2);
    check('T-ER02a: source reconstructed', src2 !== null);

    var compiler2 = new CLOOMCCompiler();
    var compiled2 = compiler2.compile(src2 || '', []);
    check('T-ER02b: no compile errors',
        compiled2.errors.length === 0,
        compiled2.errors.map(function(e) { return e.message; }).join('; '));
    check('T-ER02c: 3 methods compiled', compiled2.methods.length === 3, compiled2.methods.length);

    if (compiled2.errors.length === 0 && compiled2.methods.length === 3) {
        var cI = compiled2.methods[0].code;
        var cR = compiled2.methods[1].code;
        var cH = compiled2.methods[2].code;
        check('T-ER02d: Init code length = 1',  cI && cI.length === 1, cI && cI.length);
        check('T-ER02e: Run  code length = 3',  cR && cR.length === 3, cR && cR.length);
        check('T-ER02f: Halt code length = 2',  cH && cH.length === 2, cH && cH.length);
        check('T-ER02g: Init code = [RETURN_WORD]',
            cI && cI.length === 1 && cI[0] === RETURN_WORD);
        check('T-ER02h: Run code = [RETURN_WORD x3]',
            cR && cR.length === 3 && cR.every(function(w) { return w === RETURN_WORD; }));
        check('T-ER02i: Halt code = [RETURN_WORD x2]',
            cH && cH.length === 2 && cH.every(function(w) { return w === RETURN_WORD; }));
    }
}

// ── T-ER03: BRANCH dispatch-table words must not appear in any method body ─────
// If the reconstruction incorrectly includes table words in a body slice, the
// BRANCH mnemonics would appear in the body text and re-compile to different
// opcode words, breaking the round-trip.
console.log('\n--- T-ER03: BRANCH table not leaked into body text ---');
{
    var METHOD_NAMES3 = ['A', 'B', 'C'];
    var asm3 = assembleLump([[RETURN_WORD], [RETURN_WORD], [RETURN_WORD, RETURN_WORD]]);
    var trimmed3 = trimmedCodeWords(asm3.buf, asm3.totalWords);

    var src3 = reconstructSource('Leak', trimmed3, METHOD_NAMES3);
    check('T-ER03a: source reconstructed', src3 !== null);

    // Body text lines (non-comment, non-header, non-brace) must all be 'RETURN'
    var bodyLines3 = (src3 || '').split('\n').filter(function(l) {
        var t = l.trim();
        return t && !t.startsWith(';') && !t.startsWith('method') && t !== '}';
    });
    var nonReturn3 = bodyLines3.filter(function(l) { return l.trim() !== 'RETURN'; });
    check('T-ER03b: all body lines are RETURN (no BRANCH table leaked)',
        nonReturn3.length === 0,
        'unexpected: ' + JSON.stringify(nonReturn3));

    // Verify via recompile: all method codes should be arrays of RETURN_WORD
    var compiler3 = new CLOOMCCompiler();
    var compiled3 = compiler3.compile(src3 || '', []);
    check('T-ER03c: recompile succeeds',
        compiled3.errors.length === 0,
        compiled3.errors.map(function(e) { return e.message; }).join('; '));
    if (compiled3.errors.length === 0 && compiled3.methods.length === 3) {
        check('T-ER03d: C code = [RETURN_WORD x2]',
            compiled3.methods[2].code &&
            compiled3.methods[2].code.length === 2 &&
            compiled3.methods[2].code.every(function(w) { return w === RETURN_WORD; }));
    }
}

// ── T-ER04: Guard — reconstructSource returns null when table entry is not BRANCH
console.log('\n--- T-ER04: Guard: non-BRANCH table entry returns null ---');
{
    // word[0] has opcode 0 (LOAD), not 23 (BRANCH)
    var fakeTrimmed = [0x00000001 >>> 0, RETURN_WORD, RETURN_WORD];
    var result4 = reconstructSource('Fake', fakeTrimmed, ['X', 'Y']);
    check('T-ER04a: returns null for non-BRANCH first entry', result4 === null);

    // word[1] has opcode 0 (LOAD), word[0] is valid BRANCH
    var asm4b = assembleLump([[RETURN_WORD]]);
    var trimmed4b = trimmedCodeWords(asm4b.buf, asm4b.totalWords);
    // inject a non-BRANCH word at slot 1 (pretend second method)
    var fakeTrimmed4b = [trimmed4b[0], 0x00000002 >>> 0].concat(trimmed4b.slice(1));
    var result4b = reconstructSource('Fake2', fakeTrimmed4b, ['P', 'Q']);
    check('T-ER04b: returns null when second table entry is not BRANCH', result4b === null);
}

// ── T-ER05: Empty method body reconstructs to "; (empty)" and re-compiles ─────
// A method with no body words (e.g. stub) should survive the round-trip without
// emitting stray assembly mnemonics.
console.log('\n--- T-ER05: Empty method body round-trip ---');
{
    var METHOD_NAMES5 = ['Setup', 'Loop'];
    // Setup = no words (empty body); Loop = [RETURN_WORD]
    var asm5 = assembleLump([[], [RETURN_WORD]]);
    var trimmed5 = trimmedCodeWords(asm5.buf, asm5.totalWords);

    var src5 = reconstructSource('EmptyBody', trimmed5, METHOD_NAMES5);
    check('T-ER05a: source reconstructed', src5 !== null);
    check('T-ER05b: source mentions "(empty)" for Setup',
        src5 !== null && src5.includes('(empty)'));

    var compiler5 = new CLOOMCCompiler();
    var compiled5 = compiler5.compile(src5 || '', []);
    check('T-ER05c: no compile errors',
        compiled5.errors.length === 0,
        compiled5.errors.map(function(e) { return e.message; }).join('; '));

    if (compiled5.errors.length === 0 && compiled5.methods.length >= 2) {
        var cSetup = compiled5.methods[0].code;
        var cLoop  = compiled5.methods[1].code;
        // Setup has no body words; its compiled code may be empty or minimal
        check('T-ER05d: Loop code = [RETURN_WORD]',
            cLoop && cLoop.length === 1 && cLoop[0] === RETURN_WORD,
            cLoop ? '0x' + cLoop[0].toString(16) : 'undefined');
    }
}

// ── T-ER06: Re-assembled binary has BRANCH-encoded table ──────────────────────
// After re-compiling the reconstructed source, re-assembling with assembleLump()
// must produce a BRANCH-encoded method table (opcode 23), not bare addresses.
// This is the regression gate from test_catalog_lump.js extended to the editor
// round-trip path.
console.log('\n--- T-ER06: Re-assembled binary uses BRANCH-encoded method table ---');
{
    var METHOD_NAMES6 = ['First', 'Second'];
    var bodyF = [RETURN_WORD, RETURN_WORD];
    var bodyS = [RETURN_WORD];

    var asm6 = assembleLump([bodyF, bodyS]);
    var trimmed6 = trimmedCodeWords(asm6.buf, asm6.totalWords);
    var src6 = reconstructSource('BranchCheck', trimmed6, METHOD_NAMES6);

    var compiler6 = new CLOOMCCompiler();
    var compiled6 = compiler6.compile(src6 || '', []);
    check('T-ER06a: recompile succeeds',
        compiled6.errors.length === 0,
        compiled6.errors.map(function(e) { return e.message; }).join('; '));

    if (compiled6.errors.length === 0 && compiled6.methods.length === 2) {
        var cF6 = compiled6.methods[0].code;
        var cS6 = compiled6.methods[1].code;
        var asm6b = assembleLump([cF6, cS6]);

        // Table entry 0 (buf[1]): opcode must be BRANCH (23)
        var entry0 = asm6b.buf[1];
        var entry1 = asm6b.buf[2];
        check('T-ER06b: re-assembled table entry 0 has BRANCH opcode',
            ((entry0 >>> 27) & 0x1F) === BRANCH_OPCODE,
            'opcode=' + ((entry0 >>> 27) & 0x1F));
        check('T-ER06c: re-assembled table entry 1 has BRANCH opcode',
            ((entry1 >>> 27) & 0x1F) === BRANCH_OPCODE,
            'opcode=' + ((entry1 >>> 27) & 0x1F));

        // Verify dispatch decodes lead to correct body offsets
        var bo6 = asm6b.bodyOffsets;
        var decoded0 = decodeBranchEntry(entry0, 1);
        var decoded1 = decodeBranchEntry(entry1, 2);
        check('T-ER06d: decoded bodyOffset[0] matches assembleLump output',
            decoded0 === bo6[0], decoded0 + ' vs ' + bo6[0]);
        check('T-ER06e: decoded bodyOffset[1] matches assembleLump output',
            decoded1 === bo6[1], decoded1 + ' vs ' + bo6[1]);

        // Body words in re-assembled binary must match original
        var bodyF2 = Array.from(asm6b.buf).slice(1 + bo6[0], 1 + bo6[1]);
        var bodyS2 = Array.from(asm6b.buf).slice(1 + bo6[1], 1 + bo6[1] + cS6.length);
        check('T-ER06f: First method body matches original',
            bodyF2.length === bodyF.length &&
            bodyF2.every(function(w, i) { return w === bodyF[i]; }));
        check('T-ER06g: Second method body matches original',
            bodyS2.length === bodyS.length &&
            bodyS2.every(function(w, i) { return w === bodyS[i]; }));
    }
}

// ── T-ER07: stale Post-Flash SelfTest editor snapshot migration ──────────────
// The retired self-test used `TPERM CR0, X` before strict same-domain TPERM
// was enforced. It must migrate to the current built-in test, while an
// arbitrary user DOMAIN_PURITY probe remains untouched.
console.log('\n--- T-ER07: legacy SelfTest editor-state migration ---');
{
    const appRunSrc = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const _LEGACY_SELFTEST_TPERM_MIGRATION_KEY = 'church_editor_legacy_selftest_tperm_migrated_v1';
    const _LEGACY_SELFTEST_TPERM_BACKUP_KEY = 'church_editor_legacy_selftest_tperm_backup_v1';
    const _isLegacyPostFlashSelftestTpermSource =
        eval('(' + extractFunction(appRunSrc, '_isLegacyPostFlashSelftestTpermSource') + ')');
    const _readEditorDocumentState =
        eval('(' + extractFunction(appRunSrc, '_readEditorDocumentState') + ')');
    const _clearEditorOwnerMarkers =
        eval('(' + extractFunction(appRunSrc, '_clearEditorOwnerMarkers') + ')');
    const loadEditorState =
        eval('(' + extractFunction(appRunSrc, 'loadEditorState') + ')');

    const stored = Object.create(null);
    global.localStorage = {
        getItem: function(key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
        setItem: function(key, value) { stored[key] = String(value); },
        removeItem: function(key) { delete stored[key]; },
    };
    const editor = { value: '' };
    global.document = {
        getElementById: function(id) { return id === 'asmEditor' ? editor : null; },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
    };
    global.window = {};
    global.activeUserTabId = null;
    global._updateEditorCodeName = function() {};
    global.updateSavePseudoBtn = function() {};
    let selectedExample = null;
    global.loadExample = function(name) {
        selectedExample = name;
        editor.value = '; Church Machine Post-Flash Exhaustive Self-Test v1.1\nTPERM CR0, E\n';
    };

    const legacy = '; Church Machine Post-Flash Exhaustive Self-Test v1.0\nTPERM CR0, X\n';
    stored.church_editor_code = legacy;
    loadEditorState();
    check('T-ER07a: recognizes only the retired Post-Flash SelfTest signature',
        _isLegacyPostFlashSelftestTpermSource(legacy) === true);
    check('T-ER07b: stale SelfTest loads the current built-in example',
        selectedExample === 'post_flash_selftest');
    check('T-ER07c: stale SelfTest is backed up before replacement',
        stored.church_editor_legacy_selftest_tperm_backup_v1 === legacy);
    check('T-ER07d: migrated editor snapshot contains same-domain TPERM',
        editor.value.includes('TPERM CR0, E') && !editor.value.includes('TPERM CR0, X'));
    check('T-ER07e: migration is marked and persisted',
        stored.church_editor_legacy_selftest_tperm_migrated_v1 === '1' &&
        stored.church_editor_code === editor.value);

    // A user-authored program must never be rewritten merely because it probes X.
    selectedExample = null;
    editor.value = '';
    stored.church_editor_code = '; User experiment\nTPERM CR0, X\n';
    delete stored.church_editor_legacy_selftest_tperm_migrated_v1;
    delete stored.church_editor_legacy_selftest_tperm_backup_v1;
    loadEditorState();
    check('T-ER07f: ordinary user TPERM-X source is not recognized as legacy SelfTest',
        _isLegacyPostFlashSelftestTpermSource(stored.church_editor_code) === false);
    check('T-ER07g: ordinary user TPERM-X source is restored unchanged',
        selectedExample === null && editor.value === '; User experiment\nTPERM CR0, X\n');
}

// ── T-ER08: explicit personal owner wins over generic editor snapshot ─────────
console.log('\n--- T-ER08: personal-tab owner restore ordering ---');
{
    const appRunSrc = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const _EDITOR_DOCUMENT_STATE_KEY = 'church_editor_document_v1';
    const _readEditorDocumentState =
        eval('(' + extractFunction(appRunSrc, '_readEditorDocumentState') + ')');
    const _clearEditorOwnerMarkers =
        eval('(' + extractFunction(appRunSrc, '_clearEditorOwnerMarkers') + ')');
    const _currentEditorOwner =
        eval('(' + extractFunction(appRunSrc, '_currentEditorOwner') + ')');
    const saveEditorState =
        eval('(' + extractFunction(appRunSrc, 'saveEditorState') + ')');
    const loadEditorState =
        eval('(' + extractFunction(appRunSrc, 'loadEditorState') + ')');
    const appLumpsSrc = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
    const _restoreSavedLumpEditorOwnership =
        eval('(' + extractFunction(appLumpsSrc, '_restoreSavedLumpEditorOwnership') + ')');

    const stored = Object.create(null);
    const personal = { id: 'ut_personal', name: 'My Program', lang: 'assembly', code: '; personal owner\nRETURN\n' };
    stored.church_user_tabs = JSON.stringify([personal]);
    stored.church_editor_code = '; stale generic buffer\nHALT\n';
    stored.church_editor_lang = 'cloomc';
    stored[_EDITOR_DOCUMENT_STATE_KEY] = JSON.stringify({
        owner: { type: 'personal', id: personal.id },
        code: personal.code,
        lang: 'personal'
    });
    global.localStorage = {
        getItem: function(key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
        setItem: function(key, value) { stored[key] = String(value); },
        removeItem: function(key) { delete stored[key]; },
    };
    const editor = { value: '', readOnly: true, classList: { remove: function() {} } };
    const selector = { value: '' };
    const personalMarker = { classList: { active: false, remove: function() { this.active = false; } } };
    const exampleMarker = { classList: { active: true, remove: function() { this.active = false; } } };
    global.document = {
        getElementById: function(id) {
            if (id === 'asmEditor') return editor;
            if (id === 'langSelector') return selector;
            return null;
        },
        querySelectorAll: function(q) {
            return q === '.example-tab' ? [personalMarker, exampleMarker] : [];
        },
        querySelector: function() { return null; },
    };
    global.window = {};
    global.userTabs = [personal];
    global.activeUserTabId = null;
    global.userTabDirty = true;
    global.onLangChange = function() {};
    global.updateSavePseudoBtn = function() {};
    global.updateSaveUserTabBtn = function() {};
    global.renderUserTabs = function() { personalMarker.classList.active = activeUserTabId === personal.id; };
    global._updateEditorCodeName = function(name) { global.__restoredCodeName = name; };
    global._isLegacyPostFlashSelftestTpermSource = function() { return false; };

    loadEditorState();
    check('T-ER08a: saved personal owner restores tab content instead of generic buffer',
        editor.value === personal.code);
    check('T-ER08b: saved personal owner restores identity and personal selector',
        activeUserTabId === personal.id && selector.value === 'personal');
    check('T-ER08c: restored personal owner clears conflicting built-in marker',
        personalMarker.classList.active === true && exampleMarker.classList.active === false);
    check('T-ER08d: restored personal owner restores its label and clean state',
        global.__restoredCodeName === personal.name && userTabDirty === false);

    const lumpToken = 'deadbeef';
    let lumpDraft = null;
    let lumpInputListener = null;
    stored[_EDITOR_DOCUMENT_STATE_KEY] = JSON.stringify({
        owner: { type: 'lump', id: lumpToken },
        code: '; restored LUMP source\nRETURN\n',
        lang: 'assembly'
    });
    editor.value = '';
    editor.addEventListener = function(type, listener) {
        if (type === 'input') lumpInputListener = listener;
    };
    editor.removeEventListener = function() {};
    global._draftLsSet = function(token, code) { lumpDraft = { token: token, code: code }; };
    global.window = {
        LumpRegistry: {
            current: null,
            setCurrent: function(token) { this.current = token; }
        }
    };
    window._restoreSavedLumpEditorOwnership = _restoreSavedLumpEditorOwnership;
    loadEditorState();
    check('T-ER08e: saved LUMP owner restores its token and registry context',
        window._editorOpenLumpToken === lumpToken &&
        window.LumpRegistry.current === lumpToken &&
        window._editorLumpDirtyToken === lumpToken &&
        window._savedLumpEditorMode === true);
    editor.value = '; edited after reload\nRETURN\n';
    if (lumpInputListener) lumpInputListener();
    saveEditorState();
    const resavedLumpState = JSON.parse(stored[_EDITOR_DOCUMENT_STATE_KEY]);
    check('T-ER08f: editing after reload keeps the atomic snapshot LUMP-owned',
        resavedLumpState.owner.type === 'lump' &&
        resavedLumpState.owner.id === lumpToken &&
        resavedLumpState.code === editor.value);
    check('T-ER08g: restored LUMP context keeps draft autosave active',
        lumpDraft && lumpDraft.token === lumpToken && lumpDraft.code === editor.value);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED');
}

// Headless unit-test harness for the fuzzyScore() function in
// asm-instruction-picker.js.
//
// Loads the real production file (simulator/asm-instruction-picker.js) by
// providing a minimal browser-environment shim so the IIFE can run in Node.js
// without a full DOM.  fuzzyScore() is accessed via the public API object
// (window.AsmInstructionPicker.fuzzyScore) that the IIFE exports.
//
// Coverage:
//   1. No match returns null
//   2. Single character matched at position 0 gets a word-boundary bonus
//   3. Single character matched mid-word (no preceding space) gets no bonus
//   4. Single character matched immediately after a space gets a boundary bonus
//   5. Two boundary matches accumulate two bonus deductions
//   6. Boundary bonus causes a two-boundary match to beat a one-boundary match
//      when both start at the same first position
//   7. Positions array reflects each matched index
//   8. Case-insensitive label matching: mixed-case label, lowercase query
//
// fuzzyScore() expects a pre-lowercased query (matching how renderFiltered
// calls it), but lowercases the label internally.
//
// Exits 0 on success, 1 on any failure (failures also written to stderr).

'use strict';

// ── Minimal browser shim ─────────────────────────────────────────────────────
// Provide just enough for the IIFE to load without errors.  autoAttach() is
// called at the end of the IIFE; getElementById returning null means no
// textarea is attached and no further DOM work is done.

global.window = {};
global.document = {
    getElementById:    function () { return null; },
    addEventListener:  function () {},
    readyState:        'complete',
};

require('../../simulator/asm-instruction-picker.js');

var fuzzyScore = global.window.AsmInstructionPicker.fuzzyScore;
if (typeof fuzzyScore !== 'function') {
    process.stderr.write('[FATAL] fuzzyScore not found on AsmInstructionPicker public API\n');
    process.exit(1);
}

// ── Tiny test harness ────────────────────────────────────────────────────────

var ERRORS = [];
function fail(label, msg) {
    ERRORS.push('[FAIL] ' + label + ': ' + msg);
    process.stderr.write('[FAIL] ' + label + ': ' + msg + '\n');
}
function pass(label) {
    process.stdout.write('[PASS] ' + label + '\n');
}
function check(label, got, expected) {
    if (got !== expected) {
        fail(label, 'got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(expected));
    } else {
        pass(label);
    }
}
function checkNull(label, got) {
    if (got !== null) {
        fail(label, 'expected null, got ' + JSON.stringify(got));
    } else {
        pass(label);
    }
}
function checkNotNull(label, got) {
    if (got === null || got === undefined) {
        fail(label, 'expected non-null result');
    } else {
        pass(label);
    }
}
function checkLt(label, a, b) {
    if (!(a < b)) {
        fail(label, a + ' is not < ' + b);
    } else {
        pass(label);
    }
}

// ── 1. No match returns null ─────────────────────────────────────────────────

(function testNoMatch() {
    checkNull('no match returns null', fuzzyScore('ADD dest src', 'z'));
    checkNull('partial no match returns null', fuzzyScore('ADD dest src', 'adz'));
})();

// ── 2. Position-0 match gets word-boundary bonus ─────────────────────────────
// "ADD dest src" lowercase "add dest src"
// 'a' at 0 (index 0 → boundary) → score = 0*1000 + 0 + (-200) = -200

(function testBoundaryAtZero() {
    var r = fuzzyScore('ADD dest src', 'a');
    checkNotNull('position-0 match is not null', r);
    check('position-0 match positions[0]', r.positions[0], 0);
    check('position-0 match score', r.score, -200);
})();

// ── 3. Mid-word match (no preceding space) gets no bonus ────────────────────
// "ADD dest src" lowercase "add dest src": a(0) d(1) d(2) ' '(3) d(4) ...
// First 'd' at index 1; lLower[0]='a' (not space) → no bonus
// score = 1*1000 + 0 + 0 = 1000

(function testNoBonusMidWord() {
    var r = fuzzyScore('ADD dest src', 'd');
    checkNotNull('mid-word match is not null', r);
    check('mid-word match positions[0]', r.positions[0], 1);
    check('mid-word match score (no bonus)', r.score, 1000);
})();

// ── 4. Match immediately after a space gets boundary bonus ──────────────────
// "B offset" lowercase "b offset": b(0) ' '(1) o(2) f(3) f(4) s(5) e(6) t(7)
// 'o' at index 2; lLower[1]=' ' → boundary bonus -200
// score = 2*1000 + 0 + (-200) = 1800

(function testBoundaryAfterSpace() {
    var r = fuzzyScore('B offset', 'o');
    checkNotNull('after-space match is not null', r);
    check('after-space match positions[0]', r.positions[0], 2);
    check('after-space match score', r.score, 1800);
})();

// ── 5. Two boundary matches accumulate two bonus deductions ──────────────────
// Label "ab da sb" lowercase "ab da sb": a(0) b(1) ' '(2) d(3) a(4) ' '(5) s(6) b(7)
// query "ds":
//   'd' at 3 (lLower[2]=' ' → boundary, -200)
//   's' at 6 (lLower[5]=' ' → boundary, -200)
// score = 3*1000 + (6-3) + (-400) = 3000 + 3 - 400 = 2603

(function testTwoBoundaryMatches() {
    var r = fuzzyScore('ab da sb', 'ds');
    checkNotNull('two-boundary match is not null', r);
    check('two-boundary positions[0]', r.positions[0], 3);
    check('two-boundary positions[1]', r.positions[1], 6);
    check('two-boundary score', r.score, 2603);
})();

// ── 6. Two boundary hits beat one boundary hit at the same first position ────
// Both labels start the first matched character at position 3.
//
// Label A "ab da sb", query "ds": two boundary hits → score 2603  (test 5)
// Label B "xb dost",  query "ds":
//   "xb dost": x(0) b(1) ' '(2) d(3) o(4) s(5) t(6)
//   'd' at 3 (lLower[2]=' ' → boundary, -200)
//   's' at 5 (lLower[4]='o' → not boundary)
//   score = 3*1000 + (5-3) + (-200) = 3000 + 2 - 200 = 2802
//
// Label A wins: 2603 < 2802

(function testTwoBoundaryBeatsOneBoundary() {
    var a = fuzzyScore('ab da sb', 'ds');  // two boundary hits, score 2603
    var b = fuzzyScore('xb dost',  'ds');  // one boundary hit, score 2802
    checkNotNull('label A (two boundary) is not null', a);
    checkNotNull('label B (one boundary) is not null', b);
    check('label B score', b.score, 2802);
    checkLt('two boundary hits beats one boundary hit (lower score wins)', a.score, b.score);
})();

// ── 7. Positions array reflects each matched index ───────────────────────────
// "CALL cr" lowercase "call cr": c(0) a(1) l(2) l(3) ' '(4) c(5) r(6)
// query "cr": 'c' at 0, 'r' at 6

(function testPositionsArray() {
    var r = fuzzyScore('CALL cr', 'cr');
    checkNotNull('positions array test not null', r);
    check('positions[0] for "cr" in "CALL cr"', r.positions[0], 0);
    check('positions[1] for "cr" in "CALL cr"', r.positions[1], 6);
})();

// ── 8. Case-insensitive: mixed-case label with lowercase query ───────────────
// fuzzyScore() lowercases the label internally; callers pass a pre-lowercased
// query.  "AB DA SB" (uppercase label), query "ds" → same result as test 5.
// score = 2603

(function testCaseInsensitiveLabelMatching() {
    var r = fuzzyScore('AB DA SB', 'ds');
    checkNotNull('case-insensitive label match is not null', r);
    check('case-insensitive label match score', r.score, 2603);
})();

// ── Report ────────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.stderr.write('\n' + ERRORS.length + ' test(s) failed.\n');
    process.exit(1);
}
process.exit(0);

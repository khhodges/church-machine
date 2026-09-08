// Headless harness for Task #472.
//
// Verifies that the BRANCH label round-trip is correct:
//   encode BRANCH word  →  ChurchAssembler.decompileWords() emits assembly
//   text with label definitions and "BRANCHcond  Ln" references
//   →  ChurchAssembler.assemble() re-assembles the text
//   →  output word matches the original binary exactly.
//
// The label-emission logic lives in ChurchAssembler.decompileWords()
// (simulator/assembler.js) which is also called by editCRCodeInEditor() in
// simulator/app-cr-display.js, so these tests exercise the shared production
// code path directly.
//
// Exits 0 on success, 1 on any failure.

'use strict';

global.window = { bootConfig: {} };

const ChurchAssembler = require('../../simulator/assembler.js');

const ERRORS = [];
function fail(label, msg) {
    ERRORS.push(`[FAIL] ${label}: ${msg}`);
    process.stderr.write(`[FAIL] ${label}: ${msg}\n`);
}
function pass(label) {
    process.stdout.write(`[PASS] ${label}\n`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Encode a raw BRANCH word (mirrors assembler._assembleLine for opcode 23).
//   condCode in [0,15], signedOffset in [-16384, 16383]
function encodeBranch(condCode, signedOffset) {
    return (
        ((23 & 0x1F) << 27) |
        ((condCode & 0xF) << 23) |
        (signedOffset & 0x7FFF)
    ) >>> 0;
}

// Re-assemble the given lines and return the words array (or null on error).
function reassemble(lines, testLabel) {
    const asm = new ChurchAssembler();
    const source = lines.join('\n');
    const result = asm.assemble(source);
    if (result.errors.length > 0) {
        result.errors.forEach(e => {
            fail(testLabel, `Assembler error at line ${e.line}: ${e.message}`);
        });
        return null;
    }
    return result.words;
}

// ─── Test cases ───────────────────────────────────────────────────────────────

// Test 1: backward BRANCHNE -1 (tight loop back to word 0).
//
//   Word 0: NOP   ← label L0 inserted here
//   Word 1: BRANCHNE -1  (target = 1 + (-1) = 0)
//
// Expected lines from decompileWords():
//   L0:
//   NOP
//   BRANCHNE  L0
//
// Re-assembled word 1 must equal the original BRANCHNE word.
(function testBackwardBranchNE() {
    const label = 'BRANCH round-trip: BRANCHNE -1 (backward loop)';

    const NE = 1;
    const branchWord = encodeBranch(NE, -1);
    const trimmedWords = [0 /* NOP */, branchWord];

    const lines = ChurchAssembler.decompileWords(trimmedWords);

    const hasLabelDef = lines.some(l => l.trim() === 'L0:');
    if (!hasLabelDef) {
        fail(label, `Expected "L0:" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }
    const hasBranchRef = lines.some(l => /^BRANCHNE\s+L0$/.test(l.trim()));
    if (!hasBranchRef) {
        fail(label, `Expected "BRANCHNE  L0" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }

    const words = reassemble(lines, label);
    if (!words) return;

    if (words.length !== 2) {
        fail(label, `Expected 2 words after re-assembly, got ${words.length}`);
        return;
    }
    const roundTripped = words[1] >>> 0;
    if (roundTripped !== branchWord) {
        fail(label, `Word mismatch: original=0x${branchWord.toString(16).padStart(8,'0')} re-assembled=0x${roundTripped.toString(16).padStart(8,'0')}`);
        return;
    }
    pass(label);
})();

// Test 2: forward BRANCHEQ +1 (conditional skip-ahead).
//
//   Word 0: BRANCHEQ +1  (target = 0 + 1 = 1)  ← emitted as "BRANCHEQ  L0"
//   Word 1: NOP          ← label L0 inserted before it
//
// Re-assembled word 0 must equal the original BRANCHEQ word.
(function testForwardBranchEQ() {
    const label = 'BRANCH round-trip: BRANCHEQ +1 (forward skip)';

    const EQ = 0;
    const branchWord = encodeBranch(EQ, 1);
    const trimmedWords = [branchWord, 0 /* NOP */];

    const lines = ChurchAssembler.decompileWords(trimmedWords);

    const hasLabelDef = lines.some(l => l.trim() === 'L0:');
    if (!hasLabelDef) {
        fail(label, `Expected "L0:" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }
    const hasBranchRef = lines.some(l => /^BRANCHEQ\s+L0$/.test(l.trim()));
    if (!hasBranchRef) {
        fail(label, `Expected "BRANCHEQ  L0" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }

    const words = reassemble(lines, label);
    if (!words) return;

    if (words.length !== 2) {
        fail(label, `Expected 2 words after re-assembly, got ${words.length}`);
        return;
    }
    const roundTripped = words[0] >>> 0;
    if (roundTripped !== branchWord) {
        fail(label, `Word mismatch: original=0x${branchWord.toString(16).padStart(8,'0')} re-assembled=0x${roundTripped.toString(16).padStart(8,'0')}`);
        return;
    }
    pass(label);
})();

// Test 3: unconditional BRANCH -2 (AL suffix is dropped → "BRANCH  L0").
//
//   Word 0: NOP           ← label L0
//   Word 1: NOP
//   Word 2: BRANCHAL -2   (target = 2 + (-2) = 0)
//
// The mnemonic for AL is "BRANCH" (empty suffix).
(function testBranchAL() {
    const label = 'BRANCH round-trip: BRANCH -2 (AL unconditional)';

    const AL = 14;
    const branchWord = encodeBranch(AL, -2);
    const trimmedWords = [0 /* NOP */, 0 /* NOP */, branchWord];

    const lines = ChurchAssembler.decompileWords(trimmedWords);

    const hasLabelDef = lines.some(l => l.trim() === 'L0:');
    if (!hasLabelDef) {
        fail(label, `Expected "L0:" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }
    const hasBranchRef = lines.some(l => /^BRANCH\s+L0$/.test(l.trim()));
    if (!hasBranchRef) {
        fail(label, `Expected "BRANCH  L0" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }

    const words = reassemble(lines, label);
    if (!words) return;

    if (words.length !== 3) {
        fail(label, `Expected 3 words after re-assembly, got ${words.length}`);
        return;
    }
    const roundTripped = words[2] >>> 0;
    if (roundTripped !== branchWord) {
        fail(label, `Word mismatch: original=0x${branchWord.toString(16).padStart(8,'0')} re-assembled=0x${roundTripped.toString(16).padStart(8,'0')}`);
        return;
    }
    pass(label);
})();

// Test 4: two BRANCH instructions targeting two distinct labels (L0, L1).
//
//   Word 0: NOP   ← L0 (target of word 3)
//   Word 1: NOP   ← L1 (target of word 4)
//   Word 2: NOP
//   Word 3: BRANCHNE -3  (target = 3 + (-3) = 0 → L0)
//   Word 4: BRANCHEQ -3  (target = 4 + (-3) = 1 → L1)
(function testTwoLabels() {
    const label = 'BRANCH round-trip: two branches → two labels (L0, L1)';

    const NE = 1, EQ = 0;
    const branchNE = encodeBranch(NE, -3);
    const branchEQ = encodeBranch(EQ, -3);

    const trimmedWords = [0, 0, 0, branchNE, branchEQ];

    const lines = ChurchAssembler.decompileWords(trimmedWords);

    const hasL0 = lines.some(l => l.trim() === 'L0:');
    const hasL1 = lines.some(l => l.trim() === 'L1:');
    if (!hasL0 || !hasL1) {
        fail(label, `Expected both "L0:" and "L1:" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }
    const hasBranchNE = lines.some(l => /^BRANCHNE\s+L0$/.test(l.trim()));
    const hasBranchEQ = lines.some(l => /^BRANCHEQ\s+L1$/.test(l.trim()));
    if (!hasBranchNE || !hasBranchEQ) {
        fail(label, `Expected "BRANCHNE  L0" and "BRANCHEQ  L1" in decompileWords output but got:\n  ${lines.join('\n  ')}`);
        return;
    }

    const words = reassemble(lines, label);
    if (!words) return;

    if (words.length !== 5) {
        fail(label, `Expected 5 words after re-assembly, got ${words.length}`);
        return;
    }
    const rt3 = words[3] >>> 0;
    const rt4 = words[4] >>> 0;
    if (rt3 !== branchNE) {
        fail(label, `Word 3 mismatch: original=0x${branchNE.toString(16).padStart(8,'0')} re-assembled=0x${rt3.toString(16).padStart(8,'0')}`);
        return;
    }
    if (rt4 !== branchEQ) {
        fail(label, `Word 4 mismatch: original=0x${branchEQ.toString(16).padStart(8,'0')} re-assembled=0x${rt4.toString(16).padStart(8,'0')}`);
        return;
    }
    pass(label);
})();

// Test 5: maximum-magnitude backward offset (-16384, the most negative 15-bit
//         signed value).  Confirms sign-extension arithmetic is correct at the
//         extreme edge of the field.
(function testMaxNegativeOffset() {
    const label = 'BRANCH round-trip: maximum negative offset (-16384)';

    const AL = 14;
    const OFFSET = -16384;

    const trimmedWords = new Array(16385).fill(0);
    const branchWord = encodeBranch(AL, OFFSET);
    trimmedWords[16384] = branchWord;

    const lines = ChurchAssembler.decompileWords(trimmedWords);

    const hasLabelDef = lines.some(l => l.trim() === 'L0:');
    if (!hasLabelDef) {
        fail(label, `Expected "L0:" for word 0 but not found`);
        return;
    }
    const hasBranchRef = lines.some(l => /^BRANCH\s+L0$/.test(l.trim()));
    if (!hasBranchRef) {
        fail(label, `Expected "BRANCH  L0" but not found`);
        return;
    }

    const words = reassemble(lines, label);
    if (!words) return;

    const roundTripped = words[16384] >>> 0;
    if (roundTripped !== branchWord) {
        fail(label, `Word mismatch: original=0x${branchWord.toString(16).padStart(8,'0')} re-assembled=0x${roundTripped.toString(16).padStart(8,'0')}`);
        return;
    }
    pass(label);
})();

// ─── Bounds-check error tests ─────────────────────────────────────────────────

// Helper: assemble source and expect exactly one error whose message matches
// the bounds-check pattern.  Returns true on success, false on failure.
function assembleExpectBoundsError(source, testLabel) {
    const asm = new ChurchAssembler();
    const result = asm.assemble(source);

    if (result.errors.length === 0) {
        fail(testLabel, 'Expected a bounds-check error but assemble() reported no errors');
        return false;
    }
    if (result.errors.length !== 1) {
        fail(testLabel, `Expected exactly 1 error, got ${result.errors.length}: ${JSON.stringify(result.errors)}`);
        return false;
    }
    const msg = result.errors[0].message;
    if (!/outside the code lump/.test(msg)) {
        fail(testLabel, `Error message does not mention "outside the code lump": "${msg}"`);
        return false;
    }
    return true;
}

// Test 6: BRANCH with a negative offset that escapes below address 0.
//
//   Single-word lump:
//     Word 0: BRANCH -1  →  target = 0 + (-1) = -1 < 0  ← out of range
//
// Pass 3 must reject this with exactly one bounds-check error.
(function testNegativeOffsetEscapesBelow() {
    const label = 'BRANCH bounds-check: negative offset escapes below 0 (single-word lump)';
    const source = 'BRANCH -1';
    if (assembleExpectBoundsError(source, label)) {
        pass(label);
    }
})();

// Test 7: BRANCH with a positive offset that escapes at or past totalWords.
//
//   Two-word lump:
//     Word 0: NOP
//     Word 1: BRANCH +2  →  target = 1 + 2 = 3 >= 2 (totalWords)  ← out of range
//
// Pass 3 must reject this with exactly one bounds-check error.
(function testPositiveOffsetEscapesAbove() {
    const label = 'BRANCH bounds-check: positive offset escapes past end of lump';
    const source = 'NOP\nBRANCH +2';
    if (assembleExpectBoundsError(source, label)) {
        pass(label);
    }
})();

// ─── Report ───────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.stderr.write(`\n${ERRORS.length} test(s) failed.\n`);
    process.exit(1);
}
process.exit(0);

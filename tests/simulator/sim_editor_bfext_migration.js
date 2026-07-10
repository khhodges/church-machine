// tests/simulator/sim_editor_bfext_migration.js
//
// Regression test: the main code editor's own session-persistence path
// (`church_editor_code`, saved/restored via saveEditorState()/loadEditorState()
// in simulator/app-run.js) was NOT covered by the original BFEXT/BFINS
// `pos=<N>, w=<N>` -> `#<N>, #<N>` migration (added for the lump-editor drafts
// and custom user tabs only). Any browser holding a stale `church_editor_code`
// snapshot — written back when the disassembler still emitted the old,
// never-valid `pos=/w=` syntax — kept re-surfacing the "COMPILE FAILED" bug on
// every reload, indistinguishable from the original bug "coming back", even
// though the disassembler and the other two migration call sites were already
// fixed.
//
// This test asserts:
//   1. `_migrateBfextBfinsSyntax` (simulator/app-lumps.js) still rewrites the
//      exact stale syntax shown in the regression report
//      (`BFEXT DR3, DR1, pos=0, w=4`) to the current re-parseable form.
//   2. `loadEditorState()` (simulator/app-run.js) calls that migration helper
//      on the value it reads back from `church_editor_code` BEFORE assigning
//      it into the editor textarea — closing the gap statically, since the
//      function is DOM-bound and not practical to unit-test end-to-end here.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(cond, msg) {
    if (cond) {
        console.log(`PASS ${msg}`);
    } else {
        failures++;
        console.log(`FAIL ${msg}`);
    }
}

// ---------------------------------------------------------------------------
// 1. Functional check: extract and exercise _migrateBfextBfinsSyntax in
//    isolation (it has no external dependencies).
// ---------------------------------------------------------------------------
const lumpsSrc = fs.readFileSync(path.join(ROOT, 'simulator', 'app-lumps.js'), 'utf8');
const fnMatch = lumpsSrc.match(/function _migrateBfextBfinsSyntax\([\s\S]*?\n}\n/);
check(!!fnMatch, '_migrateBfextBfinsSyntax function found in app-lumps.js');

if (fnMatch) {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fnMatch[0] + '\nthis._migrateBfextBfinsSyntax = _migrateBfextBfinsSyntax;', sandbox);
    const migrate = sandbox._migrateBfextBfinsSyntax;

    const staleLine = 'BFEXT DR3, DR1, pos=0, w=4';
    const migrated  = migrate(staleLine);
    check(migrated === 'BFEXT DR3, DR1, #0, #4',
        `stale operand syntax rewritten correctly (got: ${migrated})`);

    const staleProgram = [
        '; System Patterns example',
        '        BFEXT DR3, DR1, pos=0, w=4',
        '        BFINS DR2, DR3, pos=4, w=8',
        '        RETURN',
    ].join('\n');
    const migratedProgram = migrate(staleProgram);
    check(!/pos\s*=\s*\d+\s*,\s*w\s*=\s*\d+/i.test(migratedProgram),
        'no stale pos=/w= syntax remains after migrating a multi-line program');
    check(migratedProgram.includes('BFEXT DR3, DR1, #0, #4') &&
          migratedProgram.includes('BFINS DR2, DR3, #4, #8'),
        'both BFEXT and BFINS lines migrated to #N, #N syntax');

    const cleanLine = 'BFEXT DR3, DR1, #0, #4';
    check(migrate(cleanLine) === cleanLine,
        'already-correct syntax is left unchanged (no-op safety)');
}

// ---------------------------------------------------------------------------
// 2. Static wiring check: loadEditorState() must run the restored
//    church_editor_code text through the migration helper before use.
// ---------------------------------------------------------------------------
const runSrc = fs.readFileSync(path.join(ROOT, 'simulator', 'app-run.js'), 'utf8');
const loadFnMatch = runSrc.match(/function loadEditorState\(\)[\s\S]*?\n}\n/);
check(!!loadFnMatch, 'loadEditorState() function found in app-run.js');

if (loadFnMatch) {
    const body = loadFnMatch[0];
    check(/getItem\(\s*['"]church_editor_code['"]\s*\)/.test(body),
        'loadEditorState() reads church_editor_code from localStorage');
    check(/_migrateBfextBfinsSyntax/.test(body),
        'loadEditorState() invokes _migrateBfextBfinsSyntax on the restored text');

    // Order matters: migration must run before the migrated/raw text is
    // assigned into editor.value, not after.
    const getIdx     = body.search(/getItem\(\s*['"]church_editor_code['"]\s*\)/);
    const migrateIdx = body.search(/_migrateBfextBfinsSyntax/);
    const assignIdx  = body.search(/editor\.value\s*=\s*saved/);
    check(getIdx >= 0 && migrateIdx > getIdx, 'migration call comes after reading the stored value');
    check(assignIdx >= 0 && assignIdx > migrateIdx, 'editor.value assignment comes after the migration call');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

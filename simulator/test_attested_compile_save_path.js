'use strict';

// Regression guard for task #3488: trusted compiler bytes must bypass the
// approval/localization final_binary path, while untrusted bytes retain it.
const fs = require('fs');
const source = fs.readFileSync(__dirname + '/app-compile.js', 'utf8');

let passed = 0;
function check(name, condition) {
    if (!condition) {
        console.error('FAIL ' + name);
        process.exitCode = 1;
    } else {
        passed++;
        console.log('PASS ' + name);
    }
}

const approvalCalls = [...source.matchAll(/_confirmLumpSavePlan\s*\(/g)];
check('three approval call sites remain (WIP, release, direct legacy)',
      approvalCalls.length === 3);

// Every approval call must be guarded by the negative attestation predicate,
// and final_binary localization must occur only inside that guarded branch.
for (const [index, match] of approvalCalls.entries()) {
    const before = source.slice(Math.max(0, match.index - 1200), match.index);
    check(`approval call ${index + 1} has an attestation bypass guard`,
          (/if\s*\(\s*!\s*\(/.test(before) ||
           /if\s*\(\s*!_attestedCompilerRecord\s*\)/.test(before)) &&
          (/compiler_record/.test(before) || /_attestedCompilerRecord/.test(before)) &&
          (/attestation/.test(before) || /_attestedCompilerRecord/.test(before)));
}

const finalBinaryAssignments = [...source.matchAll(
    /savePayload\.binary\s*=\s*[^;]*final_binary\.slice\(\)/g)];
check('legacy final_binary localization remains only for approval output',
      finalBinaryAssignments.length === 3);
check('attestation endpoint is used to reproduce browser bytes',
      source.includes("'/api/compile/attest'") &&
      source.includes('compiler_record.attestation'));
check('trusted record is carried in save metadata',
      source.includes('compiler_record: _attestedCompilerRecord'));
check('normal Save LUMP recompiles with candidateOnly=false',
      source.includes('candidateOnly: _smartOptions.candidateOnly !== false'));

console.log(`\n${passed} attested compile-save checks passed`);
if (process.exitCode) process.exit(1);
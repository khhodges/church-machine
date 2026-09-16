'use strict';
// Regression checks against the browser entry points (not only the helper
// module): an upload response is gated before showLumpDetail, and compiler
// evidence is carried in the save payload.
const assert = require('assert');
const fs = require('fs');

const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const compile = fs.readFileSync(__dirname + '/app-compile.js', 'utf8');
const abstractions = fs.readFileSync(__dirname + '/app-abstractions.js', 'utf8');

assert(lumps.includes('admitUploadPhaseTwo'));
assert(lumps.includes("action: 'import-approval'"));
const gatePos = lumps.indexOf('const phase = await window.LumpAdmission.admitUploadPhaseTwo');
const derivativePos = lumps.indexOf('detailToken = phase.token', gatePos);
const detailPos = lumps.indexOf('showLumpDetail(detailToken)', gatePos);
assert(gatePos >= 0 && detailPos > gatePos,
    'upload must admit before it can open the imported artifact');
assert(derivativePos > gatePos && derivativePos < detailPos,
    'upload must open the admitted derivative token, not the quarantine token');
assert(lumps.indexOf('LumpRegistry.evictMemory(result.token)', gatePos) < detailPos,
    'rejected uploads must be evicted before any detail/open transition');
assert(compile.includes("fetch('/api/compile'"));
assert(compile.includes("_serverCompile.trust_origin !== 'trusted-home-ide'"));
assert(compile.includes('savePayload.metadata.compiler_record = _buildApproval.compiler_record'));
assert(abstractions.includes('selectArtifactForPreparation'));
assert(abstractions.includes('Choose the exact artifact revision and destination'));
assert(abstractions.includes('revision: _preparedArtifactSelection.selection.revision'));
console.log('PASS Task 3488 real browser admission flow tests');
'use strict';

// Static regression coverage for the saved-LUMP execution trust boundary.
// Runtime facts must come from exact words; user/security fields must come
// from an approval view bound to the same SHA-256.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
let passed = 0;
let failed = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? passed++ : failed++;
}

const loaderStart = src.indexOf('async function _loadLumpBinaryIntoSim(');
const loaderEnd = src.indexOf('\nasync function _lumpGTNameCommit', loaderStart);
const loader = src.slice(loaderStart, loaderEnd);

check('SLCG-1: saved-LUMP loader is present', loaderStart >= 0 && loaderEnd > loaderStart);
check('SLCG-2: loader fetches exact immutable words',
    loader.includes('/api/lump/${token}/words'));
check('SLCG-3: loader obtains hash-bound approval view',
    loader.includes('_loadSavedLumpCapabilities(token, data)'));
const confirmPos = loader.indexOf('if (!confirm(`Deploy "');
const deployIntentPos = loader.indexOf("_requestLumpApprovalIntent(rawWords, 'deploy'");
const deployAuthorizePos = loader.indexOf("fetch('/api/lumps/deploy-authorize'");
const authorizeSuccessPos = loader.indexOf('if (!_deployAuth.ok || !_deployResult.ok)');
const instantBootPos = loader.indexOf('if (!sim.bootComplete && typeof instantBoot');
const simulatorLoadPos = loader.indexOf('sim.loadLumpBinary(');
check('SLCG-4: deploy intent is requested only after explicit confirmation',
    confirmPos >= 0 && deployIntentPos > confirmPos);
check('SLCG-5: loader validates C-List before simulator mutation',
    loader.indexOf('_validateSavedLumpClist(rawWords') < simulatorLoadPos);
check('SLCG-6: no metadata endpoint is used as runtime authority',
    !loader.includes('/' + ['me', 'ta'].join('')));
check('SLCG-7: missing approval fails closed',
    src.includes('matching user approval record is unavailable'));
check('SLCG-8: mismatched approval digest fails closed',
    src.includes('user approval record is not bound to the fetched LUMP binary hash'));
check('SLCG-9: legacy synthetic self-seal bypass is absent',
    !src.includes('legacySelfSeal'));
check('SLCG-10: deploy intent is submitted to the authorization endpoint before load',
    deployAuthorizePos > deployIntentPos && simulatorLoadPos > deployAuthorizePos);
check('SLCG-11: simulator load occurs only after successful authorization check',
    authorizeSuccessPos > deployAuthorizePos && simulatorLoadPos > authorizeSuccessPos);
check('SLCG-12: cancellation and authorization failure precede simulator mutation',
    instantBootPos > authorizeSuccessPos && simulatorLoadPos > authorizeSuccessPos);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
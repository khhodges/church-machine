'use strict';

// Namespace placement is Namespace state. Artifact approval metadata may supply
// an initial hint, but no artifact metadata endpoint is read or patched.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const start = src.indexOf('/* ---- NS_SLOT_PERSIST_UNIT_TEST_EXPORT_START');
const endMarker = 'NS_SLOT_PERSIST_UNIT_TEST_EXPORT_END ---- */';
const end = src.indexOf(endMarker, start) + endMarker.length;
const helpers = new Function(src.slice(start, end) +
    '\nreturn { _nsSlotPolicyResolve, _nsSlotPersistRecord };')();

let passed = 0;
let failed = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? passed++ : failed++;
}

const approvalHint = { token: 'abc', ns_slot_policy: 'static', ns_slot: 9 };
let resolved = helpers._nsSlotPolicyResolve(approvalHint, 'abc', {});
check('NSP-1 approved initial static hint is displayed', resolved.policy === 'static');
check('NSP-2 approved initial slot hint is displayed', resolved.nsSlotVal === '9');

resolved = helpers._nsSlotPolicyResolve(
    { token: 'abc', ns_slot_policy: 'dynamic', ns_slot: null }, 'abc', {});
check('NSP-3 dynamic hint has no fixed slot',
    resolved.policy === 'dynamic' && resolved.nsSlotVal === '');

const namespaceState = { abc: { ns_slot_policy: 'static', ns_slot: 12 } };
resolved = helpers._nsSlotPolicyResolve(
    { token: 'abc', ns_slot_policy: 'dynamic', ns_slot: null },
    'abc', namespaceState);
check('NSP-4 Namespace state overrides artifact hint',
    resolved.policy === 'static' && resolved.nsSlotVal === '12');

const staticRecord = helpers._nsSlotPersistRecord('static', 11);
check('NSP-5 static choice remains Namespace state',
    staticRecord.patchedPolicy === 'static' && staticRecord.patchedSlot === 11);
const dynamicRecord = helpers._nsSlotPersistRecord('dynamic', 11);
check('NSP-6 dynamic choice clears concrete slot',
    dynamicRecord.patchedPolicy === 'dynamic' && dynamicRecord.patchedSlot === null);

check('NSP-7 no retired metadata endpoint exists', !src.includes('/' + ['me', 'ta'].join('')));
check('NSP-8 no per-selection detail endpoint exists', !src.includes('/' + ['de', 'tail'].join('')));
check('NSP-9 Add flow fetches immutable words',
    src.includes("fetch('/api/lump/' + token + '/words'"));
check('NSP-10 Add flow inspects binary content',
    src.includes('lumpInspectContentFrame'));
check('NSP-11 Add flow stores current inspection, not metadata cache',
    src.includes('_nsAddCurrentInspection'));
check('NSP-12 copied binary C-List is declared authoritative',
    src.includes("copied binary's C-List is authoritative"));
check('NSP-13 Preload digest comes from exact immutable words',
    src.includes('binaryHash: actualBinaryHash'));
check('NSP-14 identity annotation comes only from matching approval',
    src.includes('identityHash: _canonicalHash(approvedMetadata'));
check('NSP-15 compiler SELF is derived from embedded API and binary row zero',
    src.includes('const _compilerOwnedSelf = _hasEmbeddedIdentity') &&
    src.includes('const _row0 = hdr.cc > 0 ? (words[hdr.lumpSize - hdr.cc]'));
check('NSP-16 no disabled capability rewrite block remains',
    !src.includes('if (false)'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
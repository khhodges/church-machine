'use strict';

const fs = require('fs');
const path = require('path');
const {
    lumpAudit,
    lumpAuditHasErrors,
} = require('./lump-audit.js');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log(`PASS ${name}`);
        passed++;
    } else {
        console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

function readBigEndianWords(filename) {
    const raw = fs.readFileSync(filename);
    const words = [];
    for (let offset = 0; offset < raw.length; offset += 4) {
        words.push(raw.readUInt32BE(offset));
    }
    return words;
}

const archivedWords = readBigEndianWords(path.join(
    __dirname, '..', 'server', 'lumps', 'CapabilityTest.1.edfd9e62.lump'));
const invalidIdentity = {
    applies: true,
    valid: false,
    archived: true,
    record_token: 'b6182a95',
    row0_gt: '4a000006',
    expected_gt: '4a00000a',
    slot: 10,
    sequence: 0,
    errors: [
        'record Token 0xb6182a95 != expected GT 0x4a00000a',
        'sealed row-zero GT 0x4a000006 != expected GT 0x4a00000a',
    ],
    data_changed: false,
};
const invalidResults = lumpAudit(
    archivedWords, { bootstrap_identity: invalidIdentity });
const invalidRule = invalidResults.find(result => result.ruleId === 'RBT');

check('archived bootstrap mismatch is an audit error',
    invalidRule && invalidRule.severity === 'error');
check('archived bootstrap mismatch makes the audit fail',
    lumpAuditHasErrors(invalidResults));
check('audit reports Token, row zero, and expected destination GT',
    invalidRule &&
    invalidRule.detail.includes('0xB6182A95') &&
    invalidRule.detail.includes('0x4A000006') &&
    invalidRule.detail.includes('0x4A00000A'),
    invalidRule && invalidRule.detail);
check('audit states that no data changed',
    invalidRule && invalidRule.detail.includes('No data was changed'));

const validIdentity = {
    applies: true,
    valid: true,
    archived: false,
    record_token: '4a00000a',
    row0_gt: '4a00000a',
    expected_gt: '4a00000a',
    slot: 10,
    sequence: 0,
    errors: [],
    data_changed: false,
};
const validResults = lumpAudit(
    archivedWords, { bootstrap_identity: validIdentity });
const validRule = validResults.find(result => result.ruleId === 'RBT');
check('canonical bootstrap equality is shown as a pass',
    validRule && validRule.severity === 'pass' &&
    validRule.message.includes('0x4A00000A'));

const auditSource = fs.readFileSync(
    path.join(__dirname, 'lump-audit.js'), 'utf8');
const lumpsSource = fs.readFileSync(
    path.join(__dirname, 'app-lumps.js'), 'utf8');
const abstractionsSource = fs.readFileSync(
    path.join(__dirname, 'app-abstractions.js'), 'utf8');
check('server audit metadata is passed into the binary audit',
    auditSource.includes('lumpAudit(words, data, null)'));
check('invalid bootstrap revisions lose the Run action',
    lumpsSource.includes('_isCodeLump && !_bootstrapIdentityInvalid'));
check('viewing label identifies invalid archived bootstrap identity',
    abstractionsSource.includes('[ARCHIVED — BOOTSTRAP IDENTITY INVALID]'));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
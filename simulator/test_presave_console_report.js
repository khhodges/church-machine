'use strict';
// Exercise the actual console formatter without a browser, server or writes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const start = source.indexOf('    let listing = `══');
const end = source.indexOf('    // Candidate publication', start);
assert(start >= 0 && end > start);
const referenceFormatter = source.slice(source.indexOf('function _formatCandidateReferenceReport('),
    source.indexOf('\nasync function compileAndBuild('));
const names = ['SELF', 'SelfTest', 'LED_DEV', 'UART_DEV', 'BTN_DEV',
    'TIMER_DEV', 'M_BIT_DEV', 'WukongCallHome', 'Thread.2', 'Thread.3', 'Boot.Thread'];
const rights = ['E', 'E', 'RW', 'RW', 'R', 'RW', 'RW', 'E', '', '', ''];
const words = Array(2048).fill(0);
words[0] = 0xfa80880b;
const context = {
    absName: 'RunAbstraction', langLabel: 'JavaScript', header: words[0],
    lumpSize: 2048, cw: 34, cc: 11, numMethods: 1, freespace: 2002,
    profile: 'Full', _portableStatus: 'legacy-unpinned',
    _savePetname: '', _saveIssueNumber: 1, _portableOwner: 'example.Owner#1',
    source: 'method Run { RETURN }', drPetNames: {}, crPetNames: {},
    resolvedCaps: names.map((name, i) => ({name, rights: [...rights[i]], nsIndex: i ? i + 2 : null})),
    lumpWordsArray: words, clistStart: 2037, sizeBytes: 8192,
    methodMeta: [{name: 'Run', offset: 0, length: 33}],
    _auditResults: [{ruleId: 'RPN', severity: 'pass', message: 'All capabilities named', detail: '11 names'},
        {ruleId: 'RNC', severity: 'warn', message: 'NULL GT', detail: 'legacy deployment assumption',
            violations: [{slot: 3}, {slot: 1}, {slot: 3}]}],
    _referenceVerificationSnapshot: null,
    _auditWarns: [{}],
    _getLumpFieldSizeLayout: () => ({api: 200, source: 1101, empty: 701}),
};
function render(overrides = {}) {
    return vm.runInNewContext(referenceFormatter + '\n' + source.slice(start, end) + '\nlisting;',
        {...context, ...overrides});
}
const before = words.slice();
const report = render();
assert.match(report, /UNSAVED COMPILE CANDIDATE/);
assert.match(report, /Unused:\s+701 words/);
assert.match(report, /200 API\/frame words \+ 1101 source words/);
assert.match(report, /body-relative offset=\s*0/);
for (let i = 0; i < names.length; i++) {
    assert(report.includes(`[${i}] ${names[i]}`));
}
assert.match(report, /word=0x00000000 — unresolved numeric placeholder/);
assert.match(report, /\[RNC\].*unresolved/);
const audit = report.slice(report.indexOf('  Pre-build Audit:'));
assert.match(audit, /\[1\] SelfTest — word=0x00000000/);
assert.match(audit, /\[3\] UART_DEV — word=0x00000000/);
assert.equal((audit.match(/\[3\] UART_DEV/g) || []).length, 1, 'deduplicate referenced rows');
assert(!audit.includes('[2] LED_DEV'), 'do not report unused zero rows as referenced');
assert(audit.indexOf('[1] SelfTest') < audit.indexOf('[3] UART_DEV'));
const passing = render({_auditResults: [{ruleId: 'RNC', severity: 'pass',
    message: 'No NULL GTs', detail: 'Accessed rows are non-zero'}], _auditWarns: []});
assert.match(passing, /✓ \[RNC\] No NULL GTs/);
assert.doesNotMatch(passing, /⚠ \[RNC\]|remain unresolved|Candidate audit:.*warning/);
const failing = render({_auditResults: [{ruleId: 'RNC', severity: 'error',
    message: 'Audit failed', detail: 'Diagnostic evidence'}], _auditWarns: []});
assert.match(failing, /✗ \[RNC\] Audit failed — Diagnostic evidence/);
assert.doesNotMatch(failing, /⚠ \[RNC\]/);
const noRows = render({_auditResults: [{ruleId: 'RNC', severity: 'warn', violations: []}]});
assert.match(noRows, /Affected rows were not supplied/);
const unnamedCaps = context.resolvedCaps.map((cap, row) => row === 3 ? {...cap, name: ''} : cap);
assert.match(render({resolvedCaps: unnamedCaps}), /\[3\] \(no declared PetName\) — word=0x00000000/);
assert.match(report, /INFORM\/OUTSFORM/);
assert.doesNotMatch(report, /NS\[|No petname|Target Board|MTBF|deployment-ready|all checks OK|legacy deployment assumption/);
assert.deepEqual(words, before, 'report never modifies candidate bytes');
assert.match(render({_getLumpFieldSizeLayout: () => null}), /Unused:\s+not established/);
assert.match(render({_savePetname: 'example'}), /Proposed owner: example.Owner#1 \(not a saved artifact identity\)/);
assert(source.includes('Neither installs it or changes Namespace assignments.'));
assert(!source.includes('use Save LUMP, Export LUMP, or Run to install it.'));
console.log('Pre-save console report tests passed');
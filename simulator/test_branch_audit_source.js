'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.ChurchAssembler = require('./assembler');
global.METHOD_REGISTER_CONVENTIONS = {};
const Compiler = require('./cloomc_compiler');
const { buildLump } = require('./lump_builder');
const { lumpAudit } = require('./lump-audit');
const { buildAuditSourceLines, mapRciAuditErrorsToShowErrs } = require('./rci-show-errs');

const source = `; Original editor comments
; Not a branch location
abstraction ide.BranchAudit {
capabilities { SELF E }
method Run {
again:
IADD DR1, DR0, #1
BRANCH again
}
method Other {
BRANCH #0
}
}`;
const result = new Compiler().compile(source, []);
assert.deepEqual(result.errors, []);
const authoredError = new Compiler().compile(source.replace('BRANCH #0', 'BRANCH #100'), []);
assert.equal(authoredError.errors[0].line, 11, 'assembler error retains editor line too');
// Inject a malformed emitted branch to exercise the post-assembly audit.
// A directly authored out-of-range numeric branch is rejected earlier.
result.methods[1].code[0] = ((23 << 27) | (14 << 23) | 100) >>> 0;
const { words } = buildLump(result);
const lines = buildAuditSourceLines(result, words);
assert.deepEqual(lines.slice(0, 3), [null, null, null]);
const branches = words.map((w, i) => (w >>> 27) === 23 ? i : -1).filter(i => i >= 0);
assert.equal(lines[branches[0]], 8);
assert.equal(lines[branches[1]], 11);
const errors = lumpAudit(words, null, lines).filter(r => r.ruleId === 'RCI' && r.severity === 'error');
assert.equal(errors.length, 1);
assert.equal(errors[0].violations.length, 1, 'backward branch must not false-fail');
const shown = mapRciAuditErrorsToShowErrs(errors);
assert.equal(shown[0].line, 11);

// The reported geometry: instruction 27 (PC 26), backward 25 -> PC 1,
// not the old decoder's forward target 51.
function auditBranch(word, pc = 26) {
    const binary = new Array(64).fill(0);
    binary[0] = ((31 << 27) | (28 << 10)) >>> 0;
    binary[pc + 1] = word >>> 0;
    return lumpAudit(binary).filter(r => r.ruleId === 'RCI' && r.severity === 'error');
}
const branch = (disp, reg = 0) => ((23 << 27) | (14 << 23) |
    (reg << 19) | (disp < 0 ? 0x40000 : 0) | Math.abs(disp)) >>> 0;
assert.equal(auditBranch(branch(-25)).length, 0);
assert.equal(auditBranch(branch(-27)).length, 1);
assert.equal(auditBranch(branch(2)).length, 1);
assert.equal(auditBranch(branch(-26)).length, 0);
assert.equal(auditBranch(branch(1)).length, 0);
assert.equal(auditBranch(branch(32768)).length, 1);
assert.equal(auditBranch(branch(-262143)).length, 1);
assert.equal(auditBranch(branch(100, 1)).length, 0, 'indexed target is runtime-dependent');
const changed = words.slice();
changed[branches[1]] ^= 1;
assert.equal(buildAuditSourceLines(result, changed)[branches[1]], null);
assert.ok(buildAuditSourceLines(result, [words[0] ^ (1 << 10)]).every(x => x === null));
const aliased = {
    methods: [{name: 'Run', code: [0, 0], lineNums: [12, 12]},
        {name: 'Again', aliasOf: 'Run'}, {name: 'Private', visibility: 'private', code: [0], lineNums: [24]}],
};
assert.deepEqual(buildAuditSourceLines(aliased, buildLump({
    ...aliased, abstractionName: 'ide.AliasFixture', capabilities: [],
}).words), [null, null, null, null, 12, 12, 24]);

// Exercise the real overlay/gutter highlighter without modifying an editor.
const elements = {};
function element() {
    return {style: {}, children: [], appendChild(child) { this.children.push(child); },
        classList: { add(name) { this.added = name; }, remove() {} }};
}
elements.asmEditor = Object.assign(element(), { value: source, scrollTop: 0, scrollLeft: 0, clientHeight: 100 });
elements.asmErrorOverlay = element();
elements['ln-11'] = element();
const context = {
    document: { querySelectorAll: () => [], getElementById: id => elements[id] || null,
        createElement: tag => tag === 'canvas' ? {getContext: () => null} : element() },
    getComputedStyle: () => ({lineHeight: '20', paddingTop: '0', paddingLeft: '0'}),
};
vm.createContext(context);
const ui = fs.readFileSync(__dirname + '/app-cr-detail.js', 'utf8');
vm.runInContext(ui.slice(ui.indexOf('function _highlightAsmErrorLines('),
    ui.indexOf('function _highlightAsmWarningLines(')), context);
context._highlightAsmErrorLines(shown);
assert.equal(elements['ln-11'].classList.added, 'line-num-error');
assert.equal(elements.asmErrorOverlay.children[0].children[0].style.top, '200px');
assert.ok(elements.asmEditor.scrollTop > 0);
console.log('PASS branch audit: signed magnitude, runtime index, source mapping and editor highlighting');

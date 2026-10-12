'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const runSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const catalogStart = runSource.indexOf('const INSTRUCTION_DATA = [');
const catalogEnd = runSource.indexOf('\n];', catalogStart) + 3;
const compileSource = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const renderEnd = compileSource.indexOf('// Walk text nodes');
function element() {
    return { innerHTML: '', children: [], appendChild(child) { this.children.push(child); } };
}
const lists = { instrListChurch: element(), instrListTuring: element() };
const context = vm.createContext({
    document: {
        getElementById(id) { return lists[id] || null; },
        createElement: element,
    },
    selectedInstr: null,
    _mStateBadgeText() { return ''; },
    _attachRefTip() {},
});
vm.runInContext(runSource.slice(catalogStart, catalogEnd) + '\n' +
    compileSource.slice(0, renderEnd) + '\nrenderReference();', context);
const html = Object.values(lists).flatMap(list => list.children).map(c => c.innerHTML).join('\n');
for (const mnemonic of ['ELOADCALL', 'XLOADLAMBDA']) {
    assert(!html.includes(mnemonic), `${mnemonic} must not appear in the visible list`);
}
const supported = vm.runInContext(
    'INSTRUCTION_DATA.filter(i => !["ELOADCALL", "XLOADLAMBDA"].includes(i.mnemonic)).map(i => i.mnemonic)',
    context,
);
for (const mnemonic of supported) {
    assert(html.includes(`>${mnemonic}</span>`), `${mnemonic} remains visible`);
}
console.log('Visible Instruction Set hides retired fused instructions and preserves all other entries.');

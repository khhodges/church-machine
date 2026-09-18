#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
    if (ok) {
        passed++;
        console.log('PASS ' + name);
    } else {
        failed++;
        console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
    }
}

const dom = new JSDOM(
    '<!doctype html><html><body><textarea id="asmEditor"></textarea></body></html>',
    { runScripts: 'outside-only', url: 'http://localhost/' }
);
const { window } = dom;
window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 20, top: 20, right: 620, bottom: 420, width: 600, height: 400 };
};
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => 580 });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get: () => 360 });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 600 });

let clistShows = 0;
let clistHides = 0;
window.CListViewer = {
    show() { clistShows++; },
    hide() { clistHides++; },
};

const src = fs.readFileSync('simulator/asm-instruction-picker.js', 'utf8');
vm.runInContext(src, dom.getInternalVMContext(), { filename: 'asm-instruction-picker.js' });

const editor = window.document.getElementById('asmEditor');
editor.value =
    '; capabilities { in a comment must be ignored }\n' +
    'capabilities {\n' +
    '    Boot.Thread S,\n' +
    '    SelfTest E\n' +
    '}\n' +
    'SWITCH CR12, CR6[Boot.Thread]\n';
window.AsmInstructionPicker.attach(editor);

const capPos = editor.value.indexOf('Boot.Thread S') + 2;
editor.setSelectionRange(capPos, capPos);
editor.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('capabilities click opens C-List', clistShows === 1, 'shows=' + clistShows);
check('capabilities click does not open Instructions',
    !window.AsmInstructionPicker.isVisible());

const instrPos = editor.value.indexOf('SWITCH');
editor.setSelectionRange(instrPos, instrPos);
editor.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('instruction click closes C-List', clistHides === 1, 'hides=' + clistHides);
check('instruction click opens Instructions', window.AsmInstructionPicker.isVisible());

window.AsmInstructionPicker.hide();
editor.setSelectionRange(instrPos, instrPos + 6);
editor.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('selected text does not open either popup',
    !window.AsmInstructionPicker.isVisible() && clistShows === 1);

window.AsmInstructionPicker.hide();
editor.readOnly = true;
editor.setSelectionRange(instrPos, instrPos);
editor.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('read-only editor does not open either popup',
    !window.AsmInstructionPicker.isVisible() && clistShows === 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
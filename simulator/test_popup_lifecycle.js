'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, 'app-popup-lifecycle.js'), 'utf8');
const dom = new JSDOM(`<!doctype html><body>
  <button id="open">Open</button>
  <div id="sample" class="modal-overlay" style="display:none">
    <div class="modal-dialog"><h2>Sample dialog</h2><button title="Close" id="close">×</button></div>
  </div>
  <button id="toolBreakBtn"></button>
  <div id="stepSettingsPopover" style="display:none"><button title="Close">×</button></div>
  <button id="btnRunSim"></button><div id="runPopover" style="display:none"></div>
  <button id="helpMenuBtn"></button><div id="helpDropdown" style="display:none"><button>Guide</button></div>
</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });

dom.window.eval(source);
dom.window._popupLifecycleEnhanceAll();
const doc = dom.window.document;
let passed = 0;
function check(message, condition) {
    if (!condition) throw new Error(message);
    passed++;
}

const dialog = doc.querySelector('#sample .modal-dialog');
check('modal has dialog role', dialog.getAttribute('role') === 'dialog');
check('modal is marked modal', dialog.getAttribute('aria-modal') === 'true');
check('modal title is associated', dialog.getAttribute('aria-labelledby') === dialog.querySelector('h2').id);
check('icon close has accessible name', doc.getElementById('close').getAttribute('aria-label') === 'Close dialog');

const step = doc.getElementById('stepSettingsPopover');
const trigger = doc.getElementById('toolBreakBtn');
check('popover has dialog role', step.getAttribute('role') === 'dialog');
check('trigger controls popover', trigger.getAttribute('aria-controls') === 'stepSettingsPopover');
check('trigger exposes popup type', trigger.getAttribute('aria-haspopup') === 'dialog');

const help = doc.getElementById('helpDropdown');
check('help uses menu role', help.getAttribute('role') === 'menu');
check('help items use menuitem role', help.querySelector('button').getAttribute('role') === 'menuitem');

console.log('PASS: ' + passed + ' popup lifecycle checks');
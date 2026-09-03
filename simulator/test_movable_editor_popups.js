const fs = require('fs');

const picker = fs.readFileSync('simulator/asm-instruction-picker.js', 'utf8');
const clist = fs.readFileSync('simulator/clist-viewer.js', 'utf8');
const css = fs.readFileSync('simulator/styles-editor.css', 'utf8');

const checks = [
  ['instruction picker uses measured height', picker.includes('picker.offsetHeight || 360')],
  ['instruction picker clamps to viewport', picker.includes('clampPanelToViewport')],
  ['instruction picker header drags', picker.includes("closest('.asm-picker-header')")],
  ['C-List uses measured height', clist.includes('popup.offsetHeight || 320')],
  ['C-List clamps to viewport', clist.includes('_clampPopupToViewport')],
  ['C-List header drags', clist.includes("closest('.clist-viewer-header')")],
  ['instruction picker is viewport-height bounded', css.includes('max-height: min(360px, calc(100vh - 16px))')],
  ['C-List is viewport-height bounded', css.includes('max-height: min(320px, calc(100vh - 16px))')],
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  failures.forEach(([name]) => console.error('FAIL:', name));
  process.exit(1);
}
console.log('Movable editor popups regression: PASS');
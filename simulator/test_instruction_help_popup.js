const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, 'asm-instruction-picker.js'),
  'utf8'
);
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function expect(ok, message) {
  if (!ok) throw new Error(`Instruction help popup regression: ${message}`);
}

expect(
  source.includes('if (activeCatName === null) renderGrouped();'),
  'the initial All tab must render grouped instructions'
);
expect(
  source.includes('else renderByCategory(activeCatName);'),
  'named tabs must still render their category'
);
expect(
  index.includes('window.AsmInstructionPicker.show(ed)'),
  'the editor Instructions button must open the picker'
);
expect(
  index.includes('asm-instruction-picker.js?v=20260903-movable1'),
  'the editor must request the fixed script instead of a cached copy'
);

console.log('Instruction help popup regression: PASS');
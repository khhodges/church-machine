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
  index.includes('asm-instruction-picker.js?v=20260903-isa-sync1'),
  'the editor must request the fixed script instead of a cached copy'
);
expect(
  !source.includes("instr: 'MOV'") && !source.includes("instr: 'MVN'"),
  'the picker must not offer unencoded MOV/MVN instructions'
);
expect(
  source.includes("instr: 'IADD', ops: 'dr DR0 #imm'"),
  'the picker must show the ISA load-immediate idiom'
);
expect(
  source.includes("instr: 'SWITCH', ops: 'CR13 CR6 #row'"),
  'the picker must show all three SWITCH operands'
);

console.log('Instruction help popup regression: PASS');
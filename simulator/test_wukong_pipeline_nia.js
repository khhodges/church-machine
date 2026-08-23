// Regression guard for hardware trace events keeping the Execution Workspace
// last/this/next instruction rows live.
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
let failures = 0;
function check(name, condition) {
    if (condition) console.log('  PASS  ' + name);
    else { failures++; console.log('  FAIL  ' + name); }
}

const helperStart = src.indexOf('function _wukongSetPipelineHwNIA(');
const traceStart = src.indexOf('function _wukongAppendTrace(');
check('hardware pipeline NIA helper exists', helperStart !== -1);
check('helper builds rows from previous/current hardware NIA',
      helperStart !== -1 &&
      src.slice(helperStart, helperStart + 900).includes(
          'pipelineViz.setNIA(_buildNIARows(previous, current))'));
check('helper re-renders the pipeline visualizer',
      helperStart !== -1 &&
      src.slice(helperStart, helperStart + 900).includes('pipelineViz.render()'));
check('trace path updates pipeline NIA after moving hardware cursor',
      traceStart !== -1 &&
      src.slice(traceStart).includes('_wukongSetHwCursor(niaInt);') &&
      src.slice(traceStart).includes('_wukongSetPipelineHwNIA(niaInt);'));

console.log(failures === 0
    ? '\nAll wukong-pipeline-nia tests passed.'
    : '\n' + failures + ' test(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
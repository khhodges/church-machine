// Regression guard for the labels that distinguish the IDE HW Trace panel
// from the Testing page's server-backed Live event log.
//
// Run: node simulator/test_hw_trace_surfaces.js
'use strict';

const fs = require('fs');
const path = require('path');

const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const status = fs.readFileSync(path.join(__dirname, '..', 'server', 'fpga_status.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'app.py'), 'utf8');
let failures = 0;

function check(label, condition) {
  if (condition) console.log('  PASS  ' + label);
  else { failures++; console.log('  FAIL  ' + label); }
}

check('IDE panel remains HW Trace', appRun.includes('⚡ HW Trace'));
check('IDE identifies shared Wukong feed', /same Wukong hardware trace\/console feed/.test(appRun));
check('IDE identifies session-local execution context', /Execution view for this IDE session/.test(appRun));
check('IDE explains decoded events, cursor, and faults', /decoded events, NIA cursor, and fault context/.test(appRun));
check('IDE clear is local only', /server event history is unchanged/.test(appRun));

check('Testing page remains Live event log', status.includes('>Live event log<'));
check('Testing labels latest snapshot separately', /status cards are the latest bridge\/board snapshot/.test(status));
check('Testing includes UART and bridge messages', /UART and bridge messages/.test(status));
check('Testing describes arrival ordering', /server's arrival-ordered history/.test(status) &&
      /server arrival order/.test(status));
check('Testing explains retention and restart divergence', /queue retention\/overflow, or a server restart/.test(status));
check('Simulator does not expose HW run control', !fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').includes('id="toolHWRunBtn"'));
check('Simulator does not expose HW stop control', !fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').includes('id="toolHWStopBtn"'));
check('Simulator does not expose HW load control', !fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').includes('id="toolHWLoadBtn"'));
check('Simulator Step is software-only', !/Wukong hardware step: mirror/.test(appRun));
check('Simulator has no active HW stop shortcut', !/document\.addEventListener\('keydown', _hwStopShortcutHandler\)/.test(appRun));
check('Simulator boot-entry selection never pushes hardware', !/if \(_isCmdClick\)/.test(
      fs.readFileSync(path.join(__dirname, 'app-abstractions.js'), 'utf8')));
check('Simulator Wukong status opens Testing', /id="toolbarWukongBtn"[^>]*switchBuilderViewTab\('testing'\)/.test(
      fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')));
check('Testing exposes Step HW control', /id="btnStep"[^>]*>Step HW ▶<\/button>/.test(status));
check('Testing exposes HW run control', /id="btnRun"[^>]*>▶ HW<\/button>/.test(status));
check('Testing exposes immediate Stop HW control', /id="btnStop"[^>]*>⏹ HW<\/button>/.test(status) &&
      /sendCmd\(\{ cmd: 'h' \}, 'STOP'/.test(status));
check('Testing locks Run until a Step retirement',
      /Run remains locked/.test(status) && /latest_trace/.test(status));
check('Testing STOP can cancel queued Run or Step',
      /cancelled undelivered/.test(status) && /pendingExecutionCmd/.test(status));
check('IDE upload path remains step-first',
      /Never auto-run a newly uploaded image/.test(appRun) &&
      /_wukongLastRetirementSeq/.test(appRun));
check('Testing exposes Load control', /id="btnUpload"[^>]*>⚡ Load<\/button>/.test(status));
check('Testing exposes live HW call depth', /id="toolbarCallDepth"/.test(status));
check('Testing owns Shift+H emergency stop', /e\.shiftKey/.test(status) && /e\.key !== 'H'/.test(status));
check('Testing uses the simplified Show trace button', /id="btnWorkspace"[^>]*>Show trace<\/button>/.test(status));
check('console endpoint shares ordered queue', /same server-side ordered event queue as trace packets/.test(server));

if (failures) process.exit(1);
console.log('All HW trace surface checks passed.');
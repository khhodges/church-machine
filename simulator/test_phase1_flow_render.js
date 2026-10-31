const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync('server/fpga_status.html', 'utf8');
const src = html.slice(html.indexOf('  function renderEvent(e) {'),
                      html.indexOf('  function renderLastAcceptedFault(s)'));
const lines = [];
const c = {Date, Number, FAULT_NAMES: {8:'BOUNDS'},
  addLine: (s) => lines.push(s), hex: n => '0x' + n.toString(16),
  setCurrentNia: n => {c.currentNia = n;}};
vm.createContext(c);
vm.runInContext(src, c);
c.renderEvent({gt_label:'@phase1 part Boot.NS / Boot.Thread / ide.AmoebaStartup'});
assert.equal(lines.length, 0);
c.renderEvent({seq:1,ts:1,nia:8,
  gt_label:'@phase1 event CALL Boot.NS / Boot.Thread / Boot ROM -> Boot.NS / Boot.Thread / ide.AmoebaStartup'});
assert(lines[0].includes('CALL Boot.NS / Boot.Thread'));
assert(!lines[0].includes('SelfTest'));
c.renderEvent({seq:2,ts:2,nia:0x3a08,fault_valid:true,fault_code:8,
  gt_label:'@phase1 event FAULT Boot.NS / Thread.3 / ide.Mallory'});
assert(lines[1].includes('fault=BOUNDS'));
assert.equal(c.currentNia, 0x3a08);
console.log('PASS: compact named events render; intermediate packets hidden; faults retained');

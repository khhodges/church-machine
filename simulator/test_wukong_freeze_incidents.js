'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

function body(name, args) {
    const sig = 'function ' + name + '(' + args + ') {';
    const at = src.indexOf(sig);
    if (at < 0) throw new Error('missing ' + name);
    let depth = 0, start = 0;
    for (let i = at + sig.length - 1; i < src.length; i++) {
        if (src[i] === '{') { if (!depth) start = i + 1; depth++; }
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i);
    }
    throw new Error('unterminated ' + name);
}

const classify = new Function(
    'status', 'expectedRunning', 'pendingExecution', 'lastRetirementSeq',
    '_WUKONG_FREEZE_SECONDS', body('_wukongClassifyFreeze',
        'status, expectedRunning, pendingExecution, lastRetirementSeq'));
let pass = 0, fail = 0;
function check(name, value) {
    if (value) { console.log('PASS ' + name); pass++; }
    else { console.log('FAIL ' + name); fail++; }
}
function c(s, running=true, pending=null, seq=7) {
    return classify(s, running, pending, seq, 8);
}
const trace = {nia: 0x120c, instr_word: 0x8F098000, disasm: 'DWRITE DR1, CR3, #0, DR0',
    pet_name: 'WukongCallHome', offset: 3, source_map: 'reference-bitstream', ts: 100};

const realisticStall = {bridge_connected:true,last_trace_age:9,latest_trace:trace,
    halt:{state:'intentional halt',reason:'no newer trace; a missing trace alone is not treated as a fault'}};
check('non-retiring DWRITE is a stall', c(realisticStall).classification === 'no_retirement_stall');
check('server stale-trace heuristic cannot mask running stall', c(realisticStall).classification !== 'explicit_halt');
check('DWRITE identity retained', c(realisticStall).evidence.decoded === 'DWRITE DR1, CR3, #0, DR0');
check('fault classified without losing exact code', c({bridge_connected:true,last_trace_age:1,latest_trace:{...trace,fault_valid:true,fault_code:8}}).faultCode === 8);
check('breakpoint is expected pause', c({bridge_connected:true,last_trace_age:20,latest_trace:{...trace,bp_hit:true}}).classification === 'breakpoint_pause');
check('explicit halt is classified', c({bridge_connected:true,last_trace_age:20,latest_trace:trace,halt:{state:'halt confirmed'}}, false).classification === 'explicit_halt');
check('transport loss while running classified', c({bridge_connected:false,last_trace_age:20,latest_trace:trace}).classification === 'transport_disconnect');
check('deliberate pause produces no incident', c({bridge_connected:true,last_trace_age:20,latest_trace:trace}, false) === null);
check('single-step delivery delay produces no stall', c({bridge_connected:true,last_trace_age:20,latest_trace:trace}, true, 's') === null);
check('fresh retirement produces no incident', c({bridge_connected:true,last_trace_age:2,latest_trace:trace}) === null);
check('stable key deduplicates sustained polls', c({bridge_connected:true,last_trace_age:9,latest_trace:trace}).key === c({bridge_connected:true,last_trace_age:30,latest_trace:trace}).key);
check('new retirement creates new incident key', c({bridge_connected:true,last_trace_age:9,latest_trace:trace}, true, null, 8).key !== c({bridge_connected:true,last_trace_age:9,latest_trace:trace}, true, null, 9).key);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
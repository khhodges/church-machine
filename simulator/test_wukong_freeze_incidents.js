'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

function body(name, args) {
    const sig = 'function ' + name + '(';
    const at = src.indexOf(sig);
    if (at < 0) throw new Error('missing ' + name);
    let depth = 0, start = 0;
    for (let i = at + sig.length; i < src.length; i++) {
        if (src[i] === '{') { if (!depth) start = i + 1; depth++; }
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i);
    }
    throw new Error('unterminated ' + name);
}

const classify = new Function(
    'status', 'expectedRunning', 'pendingExecution', 'lastRetirementSeq',
    'stepExpectation', 'nowMs',
    '_WUKONG_FREEZE_SECONDS', body('_wukongClassifyFreeze',
        'status, expectedRunning, pendingExecution, lastRetirementSeq, stepExpectation, nowMs'));
let pass = 0, fail = 0;
function check(name, value) {
    if (value) { console.log('PASS ' + name); pass++; }
    else { console.log('FAIL ' + name); fail++; }
}
function c(s, running=true, pending=null, seq=7) {
    return classify(s, running, pending, seq, null, 9000, 8);
}
const trace = {nia: 0x120c, instr_word: 0x8F098000, disasm: 'DWRITE DR1, CR3, #0, DR0',
    pet_name: 'WukongCallHome', offset: 3, source_map: 'reference-bitstream', ts: 100};

const realisticStall = {bridge_connected:true,last_trace_age:9,latest_trace:trace,
    halt:{state:'intentional halt',reason:'no newer trace; a missing trace alone is not treated as a fault'}};
check('quiet running loop is not inferred to be stalled', c(realisticStall) === null);
check('server stale-trace heuristic does not invent an explicit halt', c(realisticStall) === null);
check('fault classified without losing exact code', c({bridge_connected:true,last_trace_age:1,latest_trace:{...trace,fault_valid:true,fault_code:8}}).faultCode === 8);
check('breakpoint is expected pause', c({bridge_connected:true,last_trace_age:20,latest_trace:{...trace,bp_hit:true}}).classification === 'breakpoint_pause');
check('explicit halt is classified', c({bridge_connected:true,last_trace_age:20,latest_trace:trace,halt:{state:'halt confirmed'}}, false).classification === 'explicit_halt');
check('transport loss while running classified', c({bridge_connected:false,last_trace_age:20,latest_trace:trace}).classification === 'transport_disconnect');
check('deliberate pause produces no incident', c({bridge_connected:true,last_trace_age:20,latest_trace:trace}, false) === null);
check('single-step delivery delay produces no stall', c({bridge_connected:true,last_trace_age:20,latest_trace:trace}, true, 's') === null);
check('fresh retirement produces no incident', c({bridge_connected:true,last_trace_age:2,latest_trace:trace}) === null);
check('sustained quiet running remains incident-free', c({bridge_connected:true,last_trace_age:30,latest_trace:trace}) === null);

const normalize = new Function('e', '_WUKONG_EV_TRACE_NAMES',
    '_WUKONG_EV_HAS_GT_PAYLOAD', '_wukongHex', '_wukongFlagsStr',
    '_decodeGtLabel', '_WUKONG_FAULT_NAMES',
    body('_wukongNormalizeEvent', 'e'));
const mismatch = normalize({
    nia: 0x0114, instr: 0x8F098000,
    disasm: 'DWRITE DR1, CR3, #0, DR0',
    source_map: 'instruction-word',
    metadata_status: 'address metadata unavailable',
    ev_type: 0, flags: 0
}, {}, new Set(), v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'),
() => '-', () => null, {});
check('0x0114 raw DWRITE stays explicitly uncorrelated from address metadata',
    mismatch.decoded.startsWith('DWRITE') &&
    mismatch.metadata === 'address metadata unavailable' &&
    mismatch.lump === 'unavailable');

const lifecycle = new Function('_WUKONG_FREEZE_SECONDS', `
let _wukongStepProgressExpectation = null;
let _wukongFreezeIncidentKey = null;
let _wukongFreezeRecoverySeq = 0;
let _wukongLastRetirementSeq = 7;
let _wukongHWRunning = false;
let _wukongPendingExecutionCmd = null;
let shown = [];
let removed = 0;
const document = {getElementById: () => shown.length ? {remove: () => { removed++; }} : null};
const Date = {now: () => clock};
let clock = 1000;
function _wukongClassifyFreeze(status, expectedRunning, pendingExecution, lastRetirementSeq,
                               stepExpectation, nowMs) {
${body('_wukongClassifyFreeze',
    'status, expectedRunning, pendingExecution, lastRetirementSeq, stepExpectation, nowMs')}
}
function _wukongShowFreezeDiagnostic(incident) { shown.push(incident); }
function _wukongArmStepProgressExpectation(delivery, nowMs) {
${body('_wukongArmStepProgressExpectation', 'delivery, nowMs')}
}
function _wukongHandleFreezeStatus(status) {
${body('_wukongHandleFreezeStatus', 'status')}
}
return {
 arm: d => _wukongArmStepProgressExpectation(d, clock),
 poll: s => _wukongHandleFreezeStatus(s),
 advance: ms => { clock += ms; },
 shown: () => shown,
 removed: () => removed,
 expectation: () => _wukongStepProgressExpectation
};`)(8);
const delivery = {id:41,cmd:'s',write_ok:true,bridge_session:'bridge-a',
    bridge_trace_counter_at_write:10};
const stalledStatus = {bridge_connected:true,run_unlocked:false,last_trace_age:30,
    bridge:{session_id:'bridge-a'},command_delivery:delivery,latest_trace:trace,halt:{}};
lifecycle.arm(delivery);
check('confirmed Step remains awaiting retirement after delivery watch', lifecycle.expectation().commandId === 41);
check('bounded wait does not report Step early', lifecycle.poll(stalledStatus) === null);
lifecycle.advance(8000);
const stalled = lifecycle.poll(stalledStatus);
check('expired confirmed Step opens execution-stalled incident', stalled.classification === 'no_retirement_stall');
check('stalled Step popup identifies exact command', lifecycle.shown()[0].evidence.commandId === 41);
check('stalled Step preserves bridge counter baseline', lifecycle.shown()[0].evidence.traceCounterBaseline === 10);
lifecycle.poll(stalledStatus);
check('repeated status polls deduplicate popup', lifecycle.shown().length === 1);
const staleStatus = {...stalledStatus, run_unlocked:false,
    latest_trace:{...trace,bridge_session:'bridge-a',bridge_trace_counter:10}};
check('delayed baseline event does not clear expectation', lifecycle.poll(staleStatus).classification === 'no_retirement_stall');
const recoveredStatus = {...stalledStatus,run_unlocked:true};
check('causally newer retirement clears Step incident', lifecycle.poll(recoveredStatus) === null && lifecycle.expectation() === null);
check('causally newer retirement clears the stale popup', lifecycle.removed() === 1);

const disconnected = new Function(
    'status','expectedRunning','pendingExecution','lastRetirementSeq',
    'stepExpectation','nowMs','_WUKONG_FREEZE_SECONDS',
    body('_wukongClassifyFreeze',
      'status, expectedRunning, pendingExecution, lastRetirementSeq, stepExpectation, nowMs')
)({...stalledStatus,bridge_connected:false},false,null,7,
  {commandId:42,bridgeSession:'bridge-a',traceCounterBaseline:10,deadlineMs:2000},9000,8);
check('transport loss overrides stalled Step popup', disconnected.classification === 'transport_disconnect');
const halted = classify({...stalledStatus,halt:{state:'halt confirmed'}},false,null,7,
  {commandId:42,bridgeSession:'bridge-a',traceCounterBaseline:10,deadlineMs:2000},9000,8);
check('explicit halt overrides stalled Step popup', halted.classification === 'explicit_halt');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
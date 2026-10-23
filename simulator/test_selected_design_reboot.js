'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const Simulator = require('./simulator');
const source = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const functions = source.slice(source.indexOf('function faultModalReboot()'),
    source.indexOf('function faultModalInvestigate()')) +
    source.slice(source.indexOf('function resetAndStep()'),
        source.indexOf('function runGC()'));

(async () => {
    const calls = [], evidence = [];
    const scope = {
        window: {NamespaceDesignV1: {state: {active: true}},
            DesignSimulation: {command: async action => {calls.push(action); return true;}}},
        sim: {faultLog: [{message: 'old fault'}], callStack: [], ledBits: 0},
        faultModalDismiss() {}, faultAlertOff() {},
        _onSimFaultSnapshot: value => evidence.push(value),
        _lastFault: {}, _FAULT_LOG_LS_KEY: 'test',
        localStorage: {removeItem() {}},
        pipelineViz: {setNIA() {}, reset() {calls.push('pipeline-reset');}},
        _bootAuditAccum: ['old'], _bootAnimTimer: 1, bootAnimating: true,
        clearTimeout() {calls.push('cancel-animation');},
        document: {getElementById: () => null},
        _ensureCommittedImageForBoot() {throw Error('Legacy boot path reached');},
    };
    vm.createContext(scope);
    vm.runInContext(functions, scope);
    assert.equal(await scope.faultModalReboot(), true);
    assert.equal(evidence.length, 1, 'retain historical evidence before reset');
    assert.deepEqual(calls, ['pipeline-reset', 'cancel-animation', 'reset']);
    assert.equal(scope.bootAnimating, false);
    assert.equal(scope._lastFault, null);
    calls.length = 0;
    await scope.resetAndStep();
    assert.deepEqual(calls, ['reset', 'step']);
    calls.length = 0;
    scope.window.DesignSimulation.command = async action => {calls.push(action); return false;};
    await scope.resetAndStep();
    assert.deepEqual(calls, ['reset'], 'failed reset cannot execute');
    // Exercise the real selected-design reset with three real Thread bodies.
    // Build only in memory: no shared Namespace, catalog or binding writes.
    const words = JSON.parse(execFileSync('python3', ['-c', `
import sys,json,struct,hashlib
sys.path.insert(0,'tests/server')
from test_namespace_ascending_image import fixture
from server.namespace_ascending_image import generate_image,build_fresh_thread_lump,FORMAT
state,cfg,artifacts=fixture()
state['abstractions'][2]['name']='CapabilityTest'
for slot,ordinal in [(11,2),(12,3)]:
 raw=build_fresh_thread_lump(allocation_words=256,stack_words=32,entry_slot=3,entry_sequence=0)
 filename=f'thread-{slot}.lump'
 artifacts[filename]=raw
 sha=hashlib.sha256(raw).hexdigest()
 state['abstractions'].append(dict(slot=slot,name=f'Thread.{ordinal}',seq=0,type='Thread',
  filename=filename,binary_hash=sha,allocationWords=256,stackWords=32,limit=255,
  freshThreadImage=dict(format='fresh-thread-continuation-v1',destinationSlot=slot,
   destinationSequence=0,entryName='CapabilityTest',entrySlot=3,entrySequence=0,sha256=sha)))
image,_=generate_image(state,cfg,None,image_format=FORMAT,artifacts=artifacts)
print(json.dumps(list(struct.unpack(f'<{len(image)//4}I',image))))
`], {cwd: __dirname + '/..', encoding: 'utf8'}));
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
    const review = {imageFormat:'ascending-nst-metadata-slot0-v1',
        designProfile:'ascending', sourceNamespaceFingerprint:'saved',
        hardwareCertified:false, configurationHash:'configuration',
        imageHash:crypto.createHash('sha256').update(bytes).digest('hex'),
        slotCount:64, artifactBindings:[], preparationId:'preparation'};
    const runtime = {
        NamespaceDesignV1:{state:{active:true,profile:'ascending',dirty:false,
            fingerprint:'saved',document:{rows:[{slot:3,boot:true,selection:{}}]}}},
        ChurchSimulator:Simulator, Uint32Array, ArrayBuffer, DataView,
        crypto:crypto.webcrypto, sim:{},
        document:{getElementById:()=>null},
        fetch:async url=>({ok:true,json:async()=>url.endsWith('/prepare') ? review :
            url.endsWith('/approve') ? {...review,approved:true,approvedRevisionId:'revision'} :
                {...review,activated:true,words}}),
    };
    runtime.window=runtime;
    vm.createContext(runtime);
    vm.runInContext(fs.readFileSync(__dirname+'/design-simulation.js','utf8'),runtime);
    await runtime.DesignSimulation.prepare(true);
    const expected = words.slice();
    for (const slot of [11,12]) {
        const base = words[slot*4];
        expected.fill(0, base+1, base+256);
    }
    assert.deepEqual(Array.from(runtime.sim.memory),expected,
        'initial IDE boot clears non-boot starting contexts too');
    const old = runtime.sim;
    for(const slot of [2,11,12]) {
        const base=words[slot*4];
        old.memory.fill(0xdeadbeef,base,base+256);
    }
    old.dr.fill(731);
    old.cr[1].word0=0x4a000011;
    old.pc=99; old.callStack.push({old:true});
    old.faultLog.push({message:'previous run'}); old.halted=true;
    assert.equal(await runtime.DesignSimulation.command('reset'),true);
    const fresh=runtime.sim;
    assert.notEqual(fresh,old);
    assert.deepEqual(Array.from(fresh.memory),expected,'reboot clears non-boot starting contexts too');
    assert(fresh.dr.every(value=>value===0));
    assert(fresh.cr.every(cap=>cap.word0===0));
    assert.equal(fresh.callStack.length,0);
    assert.equal(fresh.faultLog.length,0);
    assert.equal(fresh.pc,0);
    assert.equal(fresh.halted,false);
    assert.equal(fresh.bootComplete,false);
    const rows = fresh.threadStatusRows(10);
    for (const slot of [11,12]) {
        const row = rows.find(row => row.slot === slot);
        assert.equal(row.lifecycleStatus,'uninitialized');
        assert.equal(fresh._threadDisplayGT(slot,null),0);
        assert.equal(fresh.resetThreadToBaseline(slot).ok,true);
        assert.deepEqual(Array.from(fresh.memory),expected,'individual reset cannot revive an actor context');
    }
    for(let i=0;i<3;i++) assert(fresh._bootStep());
    assert.equal(fresh.cr[14].word0 & 65535,3,'Lightning Bolt entry remains authoritative');
    assert.equal(fresh._activateChangeThread(0x0200000c,{crDst:12},0,true),null);
    assert(fresh.halted,'CHANGE to an uninitialized Thread must fault');
    const fault = fresh.faultLog[fresh.faultLog.length - 1];
    assert.deepEqual(fault.threadResumeFailure, {
        targetSlot:12, sto:0, sz:0, reason:'empty-context',
    });
    const descriptionScope = {};
    vm.createContext(descriptionScope);
    vm.runInContext(source.slice(source.indexOf('const _FAULT_DESCRIPTIONS ='),
        source.indexOf('// ── Fault-note localStorage persistence')), descriptionScope);
    const explain = descriptionScope._faultDescription;
    assert.match(explain(fault), /NS\[12\].*no initialized execution context/);
    assert.match(explain(fault), /Rebooting alone will not fix/);
    assert.match(explain({type:'BOUNDS', message:fault.message}), /does not capture enough/);
    assert.match(explain({type:'BOUNDS', threadResumeFailure:{
        targetSlot:12,sto:4,sz:1,reason:'invalid-frame',
    }}), /invalid CHURCH entry\/resume frame/);
    assert.match(explain({type:'BOUNDS',message:'unrelated'}), /c-list or memory scope/);
    assert(source.includes('const descText = _faultDescription(f);'));
    assert.equal(fresh.cr[14].word0 & 65535,3,'failed CHANGE cannot enter saved actor code');
    console.log('PASS selected-design fault reboot and reset-and-step routing');
})().catch(error => {console.error(error); process.exitCode = 1;});

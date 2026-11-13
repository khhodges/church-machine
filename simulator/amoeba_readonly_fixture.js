'use strict';
// Offline provisioning and a byte-source device model only. Every lifecycle
// action, comparison, NS write, clear and pool allocation executes native code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {compile} = require('./native_memory_queue_fixture');
const Simulator = require('./simulator');
const Thread = require('./thread_design');
const sourcePath = __dirname + '/examples/amoeba_readonly_lifecycle.cloomc';
const S = {amoeba:20, config:21, state:22, pool:23, entries:24, roots:25,
    receiver:26, control:27, system:28, user:29, systemRead:30, userRead:31,
    entryA:32, entryB:33, results:34, calls:35, a:40, b:41};
const B = {code:0x2000, config:0x3000, state:0x3100, pool:0x3200,
    entries:0x3400, roots:0x3500, receiver:0x3600, control:0x3610,
    results:0x3700, calls:0x3800, absentA:0x3900, absentB:0x3a00,
    system:0x4000, user:0x4200};

function action(method, slot = S.a) {
    return `IADD DR1, DR0, #${slot}
    LOAD CR0, CR6, #0
    CALL CR0, #${method}
    LOAD CR9, CR6, #10
    DREAD DR15, CR9, #62
    DWRITE DR1, CR9, #0, DR15
    IADD DR15, DR15, #1
    DWRITE DR15, CR9, #62`;
}
function executeTarget(row = 0) {
    return `LOAD CR2, CR6, #11
    LOAD CR1, CR2, #${row+1}
    CALL CR1, #0
    LOAD CR9, CR6, #10
    DREAD DR15, CR9, #62
    DWRITE DR1, CR9, #0, DR15
    IADD DR15, DR15, #1
    DWRITE DR15, CR9, #62`;
}
const cycle = [action(0), executeTarget(), action(1), action(2),
    action(0, S.b), executeTarget(1), action(1, S.b), action(2, S.b),
    action(0), executeTarget()].join('\n');

function fixture({body = cycle, readonly = true, pin = null, targetBody,
    transform = x => x, tamper = -1, badDescriptor = false, badThread = false,
    delay = 0, corruptDelivery = false} = {}) {
    const s = new Simulator();
    const baseSource = fs.readFileSync(sourcePath, 'utf8');
    const source = transform(baseSource)
        .replace('ide.AmoebaUserThread, ide.AmoebaSystemThread',
            'ide.AmoebaUserThread, ide.AmoebaSystemThread, ide.Results RW, ide.TargetCalls L')
        .replace(/\}\s*$/, `main method Trial() {
            IADD DR15, DR0, #0
            ${body}
            LOAD CR9, CR6, #10
            IADD DR1, DR0, #1
            DWRITE DR1, CR9, #63
        finish:
            CHANGE CR12
            BRANCH finish
        }\n}`);
    const program = compile(source);
    const a = compile(`abstraction ide.ReadOnlyA {
        capabilities { SELF E, ide.AmoebaReadOnly E }
        method Run() { ${targetBody || 'IADD DR1, DR0, #17\nRETURN'} }
    }`);
    const b = compile(`abstraction ide.ReadOnlyB {
        capabilities { SELF E, ide.AmoebaReadOnly E }
        method Run() { IADD DR1, DR0, #29\nRETURN }
    }`);
    assert.equal(a.lump.words.length, b.lump.words.length);
    const size = a.lump.words.length;
    assert(size <= 256);
    const gt = (slot, rights = '', version = 0) => s.createGT(version, slot,
        Object.fromEntries([...rights].map(r => [r, 1])), 1) >>> 0;
    const targetGT = [gt(S.a, 'E', 7), gt(S.b, 'E', 11)];
    const serviceGT = gt(S.amoeba, 'E');
    const entry = (slot, base, length, version = 0, token = 0) =>
        s.writeNSEntry(slot, base, length-1, 0, 0, 1, version, 0, token);
    const descriptor = (base, version, token) => {
        const w1 = s.packNSWord1(size-1, version, 0, 0);
        return [base, w1, s._integrity32(base,w1), token >>> 0];
    };
    const absent = [descriptor(B.absentA,7,0xabc123), descriptor(B.absentB,11,0xdef456)];
    const resident = [descriptor(B.pool,7,0xabc123), descriptor(B.pool,11,0xdef456)];
    s.withNamespaceWrite('disposable read-only lifecycle fixture', () => {
        entry(S.amoeba, B.code, program.lump.words.length);
        for (const [slot,base,length] of [
            [S.config,B.config,64], [S.state,B.state,64], [S.pool,B.pool,size],
            [S.entries,B.entries,64], [S.roots,B.roots,64],
            [S.receiver,B.receiver,7], [S.control,B.control,3],
            [S.system,B.system,256], [S.user,B.user,256],
            [S.systemRead,B.system,256], [S.userRead,B.user,256],
            [S.entryA,s._nsSlotBase(S.a),4], [S.entryB,s._nsSlotBase(S.b),4],
            [S.results,B.results,64], [S.calls,B.calls,64],
        ]) entry(slot,base,length);
        entry(S.a,B.absentA,size,7,0xabc123);
        entry(S.b,B.absentB,size,11,0xdef456);
    });
    const bindings = [serviceGT,gt(S.config,'R'),gt(S.state,'RW'),
        gt(S.pool,'RW'),gt(S.entries,'L'),gt(S.roots,'L'),
        gt(S.receiver,'R'),gt(S.control,'W'),gt(S.user),gt(S.system),
        gt(S.results,'RW'),gt(S.calls,'L')];
    program.lump.words.splice(-bindings.length, bindings.length, ...bindings);
    assert(B.code + program.lump.words.length < B.config);
    s.memory.set(program.lump.words,B.code);
    s.registerNativeFaultDiagnostics(program.lump.words.slice(1,1+program.lump.cw),B.code+1,true);
    a.lump.words.splice(-2,2,targetGT[0],serviceGT);
    b.lump.words.splice(-2,2,targetGT[1],serviceGT);
    const records = new Map([[S.a,Array.from(a.lump.words)], [S.b,Array.from(b.lump.words)]]);
    const table = (base,slot,rows) => {
        s.memory[base] = s.packLumpHeader(0,0,rows.length+1,0);
        s.memory.set([gt(slot,'E'),...rows],base+63-rows.length);
    };
    // Select uses zero-based records; row zero remains SELF and is not a grant.
    table(B.entries,S.entries,[gt(S.entryA,'RW'),gt(S.entryB,'RW')]);
    table(B.roots,S.roots,[gt(S.systemRead,'R'),gt(S.userRead,'R')]);
    table(B.calls,S.calls,targetGT);
    s.memory.fill(0,B.state,B.state+64);
    s.memory.fill(0,B.pool,B.pool+size);
    s.memory.fill(0,B.results,B.results+64);
    s.memory.set([size,2,2,S.a,readonly?1:0,...absent[0],...resident[0],
        S.b,1,...absent[1],...resident[1]],B.config);
    s.memory[B.absentA] = a.lump.words[0] & ~(8191<<10);
    s.memory[B.absentB] = b.lump.words[0] & ~(8191<<10);
    const layout = Thread.layout(256,64);
    for (const base of [B.system,B.user]) {
        s.memory.fill(0,base,base+256);
        s.memory[base] = s.packLumpHeader(2,64,12,2);
        s.memory[base+layout.capsStart] = serviceGT;
        assert(s._formatThreadRootSentinel(base,layout,serviceGT,{image:true}));
    }
    if (pin === 'home') s.memory[B.user+layout.capsStart+1] = targetGT[0];
    if (pin === 'return' || pin === 'suspended') {
        const frame = layout.stackEnd-2;
        s.memory[B.user+frame-1] = targetGT[0];
        s.memory[B.user+frame] = s._packFrameWordRaw(0,1,frame);
        s.memory[B.user+17] = s._packProtectedIndicator(frame-2,1,{},0);
    }
    if (badThread) s.memory[B.user+17] &= ~(1<<12);
    if (badDescriptor) s.memory[s._nsSlotBase(S.a)+3] ^= 1;
    s.bootComplete=true;
    s.mElevation=false;
    s.petNameMemory.clear();
    s.programCapabilities=null;
    s.cr=Array.from({length:16},()=>({word0:0,word1:0,word2:0,word3:0,m:0}));
    const systemEntry=s.readNSEntry(S.system);
    s.cr[12]={word0:gt(S.system),word1:B.system,word2:systemEntry.word1_limit,word3:0,m:0};
    s._installLumpHeaderContext(s.parseGT(serviceGT),S.amoeba,
        s.readNSEntry(S.amoeba),s.parseLumpHeader(program.lump.words[0]));
    s._currentThreadSlot=S.system;
    s._liveThreadOwned=true;
    s.pc=program.lump.words[12]-1;
    s.sto=layout.stackEnd-2;
    s.halted=false;
    s.writeNSEntry=()=>{throw Error('host Namespace publication is forbidden');};
    s.runGC=()=>{throw Error('host GC is forbidden');};
    // Device model supplies only the admitted artifact stream and status.
    // This is not UART/SHA evidence; the real receiver has its own RTL suite.
    let stream, consumed=0, transaction=0, countdown=0, fault, tampered=false;
    const requests=[], writes=[];
    s.on('fault',event=>{fault=event;});
    function run(limit=100000) {
        for(let i=0; i<limit && !fault && !s.halted; i++) {
            const instruction=s.decodeInstruction(s.memory[s.cr[14].word1+1+s.pc]);
            const address=(instruction.opcode===16 || instruction.opcode===17)
                ? s.cr[instruction.crSrc].word1+s._dataOffset(instruction) : -1;
            // Test-only fault injection occurs on delivery, never inside GC logic.
            if (stream && countdown>0 && --countdown===0)
                s.memory[B.receiver+1]=corruptDelivery?7:4;
            if (address===B.receiver && instruction.opcode===16) {
                assert(stream && consumed<stream.length,'invalid device read');
                s.memory[B.receiver]=stream[consumed];
            }
            const result=s.step();
            if (!result || fault) break;
            if(instruction.opcode===16 && address===B.receiver) consumed++;
            if(instruction.opcode===17) {
                const value=s.memory[address]>>>0;
                writes.push({address,value,owner:s.memory[B.state],phase:s.memory[B.state+1]});
                if(address===B.control+2) {
                    assert(!stream || consumed===stream.length,'overlapping request');
                    stream=records.get(value);
                    assert(stream,'unknown delivery selection');
                    consumed=0; transaction++; countdown=delay;
                    requests.push(value);
                    s.memory.set([0,delay?8:(corruptDelivery?7:4),value,transaction,size,0,stream[0]],B.receiver);
                    if(tamper>=0 && transaction===2 && !tampered) {
                        s.memory[B.pool+tamper]^=1;
                        tampered=true;
                    }
                }
                if(address===B.control) assert.equal(value,transaction);
            }
            if(s.memory[B.results+63]===1) return {fault,requests,writes,steps:i};
        }
        if(!fault) throw Error('native lifecycle did not complete');
        return {fault,requests,writes};
    }
    return {s,run,size,records,absent,resident,program,targetGT,S,B};
}
module.exports={fixture,action,executeTarget,cycle,S,B};

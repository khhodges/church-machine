'use strict';
// Disposable provisioning and exact instruction execution only.
// No host allocator, version advance, queue operation, cleaner or scheduler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
const Simulator = require('./simulator');
const Thread = require('./thread_design');

const SLOT = Object.freeze({
    monitor:20, word:21, block0:22, block1:23, mControl:24, state:25,
    entries:26, handler:27, mint0:28, mint1:29, cleanerCode:30, namespace:31,
    schedulerCode:32, schedule:33, driver0:34, driver1:35, producer0:36,
    producer1:37, cleaner:38, scheduler:39, config0:40, config1:41,
    configCleaner:42, control0:43, control1:44, results:45, old:46, ready:47,
});
const BASE = Object.freeze({
    word:0x4000, state:0x4100, entries:0x4200, schedule:0x4300,
    configs:0x4400, results:0x4500, old:0x4600, blocks:0x5000,
    threads:0x8000,
});
const file = name => fs.readFileSync(__dirname + '/cloomc/' + name + '.cloomc', 'utf8');
function compile(source) {
    const result = new Compiler().compile(source, []);
    assert.deepEqual(result.errors, []);
    const lump = builder.buildLump(result);
    return {result, lump, source};
}
function driver(actor, {mode = 'cycle'} = {}) {
    const reserveRow = actor + 1;
    let body = `
    IADD DR2, DR0, #8
    LOAD CR0, CR6, #1
    CALL CR0, #0
    LOAD CR7, CR6, #5
    SAVE CR1, CR7, #${reserveRow}
    IADD DR6, DR0, #0
    IADD DR4, DR0, #${123 + actor}
dirty:
    DWRITE DR4, CR1, #0, DR6
    IADD DR6, DR6, #1
    MCMP DR6, #8
    BRANCHLO dirty
    LOAD CR2, CR6, #2
    CHANGE CR2
    LOAD CR7, CR6, #5
    LOAD CR2, CR7, #${reserveRow}
    LOAD CR0, CR6, #1
    CALL CR0, #1
`;
    if (mode === 'exhaust') body = `
    IADD DR2, DR0, #8
    LOAD CR0, CR6, #1
    CALL CR0, #0
    IADD DR2, DR0, #8
    LOAD CR0, CR6, #1
    CALL CR0, #0
    IADD DR2, DR0, #8
    LOAD CR0, CR6, #1
    CALL CR0, #0
`;
    if (mode === 'duplicate') body += `
    LOAD CR7, CR6, #5
    LOAD CR2, CR7, #${reserveRow}
    LOAD CR0, CR6, #1
    CALL CR0, #1
`;
    if (mode === 'stale-write') body += `
    LOAD CR7, CR6, #5
    LOAD CR2, CR7, #${reserveRow}
    DWRITE DR0, CR2, #0, DR0
`;
    if (mode === 'cycle') body += `
wait_clean:
    LOAD CR7, CR6, #6
    DREAD DR2, CR7, #0, DR0
    MCMP DR2, #0
    BRANCHNE allocate_again
    LOAD CR2, CR6, #2
    CHANGE CR2
    BRANCH wait_clean
allocate_again:
    IADD DR2, DR0, #8
    LOAD CR0, CR6, #1
    CALL CR0, #0
    IADD DR6, DR0, #0
verify_zero:
    DREAD DR4, CR1, #0, DR6
    MCMP DR4, #0
    BRANCHNE not_zero
    IADD DR6, DR6, #1
    MCMP DR6, #8
    BRANCHLO verify_zero
    LOAD CR7, CR6, #4
    SAVE CR1, CR7, #${reserveRow}
`;
    return `abstraction ide.QueueProducer${actor}Driver {
passkey required;
capabilities {
 SELF E, ide.MemoryQueueMint E, ide.QueueScheduler.Thread,
 ide.OwnControl RW, ide.Results S, ide.OldReferences LS, ide.CleanReady R
}
method Run() -> Void {
${body}
    LOAD CR7, CR6, #3
    IADD DR4, DR0, #1
    DWRITE DR4, CR7, #1, DR0
    DWRITE DR0, CR7, #0, DR0
    LOAD CR2, CR6, #2
    CHANGE CR2
    HARDFAULT "Completed producer was scheduled again"
not_zero:
    HARDFAULT "Reallocated DATA block was published before complete zeroing"
}
}`;
}

function fixture({versions = [7,13], modes = ['cycle','cycle'], active = [true,true],
    yieldAfterReserve = [1,0], cleanerInitiallyReady = false, initialCursor = 0, transform = {}} = {}) {
    const s = new Simulator();
    const sources = {
        monitor:file('security_monitor_create_data'),
        handler:file('memory_queue_free_handler'),
        mint0:file('memory_queue_mint'), mint1:file('memory_queue_mint'),
        cleanerCode:file('memory_queue_cleaner'), schedulerCode:file('memory_queue_scheduler'),
        driver0:driver(0, {mode:modes[0]}), driver1:driver(1, {mode:modes[1]}),
    };
    for (const [name, change] of Object.entries(transform))
        sources[name] = change(sources[name]);
    const programs = Object.fromEntries(Object.entries(sources).map(([name,text]) => [name,compile(text)]));
    const gt = (slot, rights = '', version = 0) => s.createGT(version, slot,
        Object.fromEntries([...rights].map(r => [r, 1])), 1) >>> 0;
    const entry = (slot, base, limit, version = 0) =>
        s.writeNSEntry(slot, base, limit, 0, 0, 1, version, 0, 0);
    let codeBase = 0x2000;
    s.withNamespaceWrite('disposable native queue provisioning', () => {
        for (const [name, program] of Object.entries(programs)) {
            program.base = codeBase;
            program.slot = SLOT[name];
            entry(program.slot, codeBase, program.lump.words.length - 1);
            s.memory.set(program.lump.words, codeBase);
            s.registerNativeFaultDiagnostics(
                program.lump.words.slice(1, 1 + program.lump.cw), codeBase + 1, true);
            codeBase += program.lump.words.length + 64;
        }
        assert(codeBase < BASE.word, 'code must not alias queue or data storage');
        entry(SLOT.word, BASE.word, 0);
        entry(SLOT.block0, BASE.blocks, 7, versions[0]);
        entry(SLOT.block1, BASE.blocks + 8, 7, versions[1]);
        entry(SLOT.mControl, 0xFFFFFF1C, 0);
        entry(SLOT.state, BASE.state, 63);
        entry(SLOT.entries, BASE.entries, 63);
        entry(SLOT.schedule, BASE.schedule, 7);
        entry(SLOT.config0, BASE.configs, 7);
        entry(SLOT.config1, BASE.configs + 8, 7);
        entry(SLOT.configCleaner, BASE.configs + 16, 7);
        entry(SLOT.control0, BASE.schedule, 1);
        entry(SLOT.control1, BASE.schedule + 2, 1);
        entry(SLOT.results, BASE.results, 63);
        entry(SLOT.old, BASE.old, 63);
        entry(SLOT.ready, BASE.state + 4, 0);
        for (const [i,slot] of [SLOT.producer0,SLOT.producer1,SLOT.cleaner,SLOT.scheduler].entries())
            entry(slot, BASE.threads + i * 512, 511);
        entry(SLOT.namespace, s.NS_TABLE_BASE, s.memory.length - s.NS_TABLE_BASE - 1);
    });
    // Shared transport and lifecycle start fully provisioned and zeroed.
    s.memory.fill(0, BASE.blocks, BASE.blocks + 16);
    s.memory[BASE.entries] = s.packLumpHeader(0, 0, 8, 0);
    s.memory[BASE.entries + 56] = gt(SLOT.entries, 'E');
    s.memory[BASE.entries + 57] = gt(SLOT.block0, 'RW', versions[0]);
    s.memory[BASE.entries + 58] = gt(SLOT.block1, 'RW', versions[1]);
    for (const [base,slot] of [[BASE.results,SLOT.results],[BASE.old,SLOT.old]]) {
        s.memory[base] = s.packLumpHeader(0, 0, 3, 0);
        s.memory[base + 61] = gt(slot, 'E');
    }
    s.memory[BASE.state + 4] = 2;
    s.memory.set([0,1], BASE.state + 16);
    s.memory.set([3,3], BASE.state + 20);
    s.memory.set(versions, BASE.state + 32);
    s.memory.set([active[0]?1:0, active[0]?0:1, active[1]?1:0, active[1]?0:1,
        cleanerInitiallyReady?1:0,0,initialCursor], BASE.schedule);
    for (const actor of [0,1,2])
        s.memory.set([actor,yieldAfterReserve[actor] || 0,BASE.blocks,8,22,2,
            s.memory.length - s.NS_TABLE_BASE],
            BASE.configs + actor * 8);
    function bind(name, caps) {
        const p = programs[name], count = p.result.capabilities.length;
        assert.equal(count, caps.length + 1, name);
        p.gt = gt(p.slot, 'E');
        s.memory.set([p.gt,...caps], p.base + p.lump.words.length - count);
        p.header = s.parseLumpHeader(p.lump.words[0]);
        p.entryPC = p.lump.words[1] - 1;
    }
    bind('monitor', [gt(SLOT.word,'W'),gt(SLOT.mControl,'W')]);
    bind('handler', [gt(SLOT.state,'RW'),gt(SLOT.entries,'LS'),gt(SLOT.entries,'R'),
        gt(SLOT.namespace,'R'),gt(SLOT.schedule,'RW'),
        gt(SLOT.config0,'R'),gt(SLOT.config1,'R'),gt(SLOT.configCleaner,'R'),gt(SLOT.scheduler)]);
    for (const actor of [0,1]) {
        bind('mint'+actor, [gt(SLOT.handler,'E'),gt(SLOT.namespace,'RW'),
            gt(SLOT['config'+actor],'R'),gt(SLOT.scheduler),gt(SLOT.monitor,'E')]);
        bind('driver'+actor, [gt(SLOT['mint'+actor],'E'),gt(SLOT.scheduler),
            gt(SLOT['control'+actor],'RW'),gt(SLOT.results,'S'),gt(SLOT.old,'LS'),gt(SLOT.ready,'R')]);
    }
    bind('cleanerCode', [gt(SLOT.handler,'E'),gt(SLOT.configCleaner,'R'),gt(SLOT.scheduler)]);
    bind('schedulerCode', [gt(SLOT.schedule,'RW'),gt(SLOT.producer0),gt(SLOT.producer1),gt(SLOT.cleaner)]);
    const layout = Thread.layout(512,64);
    const threads = {};
    for (const [i,[slot,name]] of [
        [SLOT.producer0,'driver0'],[SLOT.producer1,'driver1'],
        [SLOT.cleaner,'cleanerCode'],[SLOT.scheduler,'schedulerCode'],
    ].entries()) {
        const base = BASE.threads + i * 512, p = programs[name];
        s.memory[base] = s.packLumpHeader(3,64,12,2);
        s.memory[base + layout.capsStart] = p.gt;
        s.memory[base + layout.capsStart + 1] = p.gt;
        const root = s._formatThreadRootSentinel(base, layout, p.gt, {image:true});
        assert(root);
        if (slot !== SLOT.scheduler) {
            const frame = root.frameAddress - 2;
            s.memory[base + frame - 1] = p.gt;
            s.memory[base + frame] = s._packFrameWordRaw(p.entryPC,1,frame);
            s.memory[base + layout.protectedStoOffset] = s._packProtectedIndicator(frame - 2,1,{},0);
        }
        threads[slot] = {base,layout};
    }
    // Initial machine context only. Every subsequent context transition is a
    // compiled CHANGE instruction, with real Thread homes and protected frames.
    const scheduler = programs.schedulerCode;
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.cr = Array.from({length:16}, () => ({word0:0,word1:0,word2:0,word3:0,m:0}));
    const schedulerEntry = s.readNSEntry(SLOT.scheduler);
    s.cr[12] = {word0:gt(SLOT.scheduler),word1:schedulerEntry.word0_location,
        word2:schedulerEntry.word1_limit,word3:0,m:0};
    s._installLumpHeaderContext(s.parseGT(scheduler.gt),scheduler.slot,
        s.readNSEntry(scheduler.slot),scheduler.header);
    s._currentThreadSlot = SLOT.scheduler;
    s._liveThreadOwned = true;
    s.pc = scheduler.entryPC;
    s.sto = layout.stackEnd - 2;
    s.halted = false;
    assert.equal(s.irqState.timerArmed,false);
    const codeSlots = new Set(Object.values(programs).map(p => p.slot));
    const threadSlots = new Set([SLOT.producer0,SLOT.producer1,SLOT.cleaner,SLOT.scheduler]);
    const machineCreate = s.createGT.bind(s);
    s.createGT = (version,slot,permissions,type) => {
        const codeContext = codeSlots.has(slot) && !permissions.W &&
            !permissions.L && !permissions.S && !permissions.B &&
            (permissions.X || permissions.E);
        // CHANGE's existing microcode establishes the Thread identity and
        // its bounded CR5 heap view; these are not pool DATA results.
        const threadContext = threadSlots.has(slot) && !permissions.X &&
            !permissions.L && !permissions.S && !permissions.E && !permissions.B &&
            ((!permissions.R && !permissions.W) || (permissions.R === 1 && permissions.W === 1));
        assert(version === 0 && type === 1 && (codeContext || threadContext),
        `host manufacture outside code-context microcode: slot ${slot}`);
        return machineCreate(version,slot,permissions,type);
    };
    let fault;
    s.on('fault', event => {fault = event;});
    const events = [], executedThreads = new Set();
    let stable = Array.from(s.memory.slice(BASE.state,BASE.state+40));
    function run(limit = 30000, observe) {
        for (let steps = 0; !s.halted && !fault && steps < limit; steps++) {
            const thread = s.parseGT(s.cr[12].word0).index;
            executedThreads.add(thread);
            const before = Array.from(s.memory.slice(BASE.state, BASE.state + 40));
            const result = s.step();
            const after = Array.from(s.memory.slice(BASE.state, BASE.state + 40));
            if (after[0] === 0) {
                for(const [ready,reserved,staged,phase] of [[4,5,6,20],[9,10,11,22]]) {
                    const entries=after.slice(phase,phase+2);
                    assert.equal(after[ready],entries.filter(v=>v===3).length);
                    assert.equal(after[reserved],entries.filter(v=>v===1).length);
                    assert.equal(after[staged],entries.filter(v=>v===2).length);
                    assert(after[ready]+after[reserved]+after[staged]<=2);
                }
                for (const [kind,count,tail,ring,entry] of [
                    ['released',9,13,18,3],['clean',4,8,16,1],
                ]) if (after[count] > stable[count]) {
                    const index = after[ring + stable[tail]];
                    const token = s.memory[BASE.entries + 56 + entry + index];
                    events.push({kind,thread,token});
                    assert.equal(s.memory[BASE.word],0,'construction scratch was cleared');
                    for(let cell=61;cell<=63;cell++)
                        assert.notEqual(s.memory[BASE.entries+cell],token,
                            'publication has no remaining validation-cell copy');
                    for (const cr of s.cr) assert.notEqual(cr.word0 >>> 0, token,
                        'publication has no remaining live working copy');
                    for (const body of Object.values(threads))
                        for (let reg=0;reg<12;reg++)
                            assert.notEqual(s.memory[body.base+body.layout.capsStart+reg],token,
                                'publication has no saved Thread working copy');
                }
                if (after[9] > 0) assert.equal(s.memory[BASE.schedule+4],1,
                    'published work cannot lose the Cleaner wakeup');
                stable = after;
            }
            if (observe) observe({s,thread,before,after,result,steps});
            if (steps === limit - 1) throw Error('native queue instruction budget exhausted');
        }
        return {fault,events,executedThreads,steps:s.stepCount};
    }
    return {s,run,programs,threads,versions,SLOT,BASE};
}
module.exports = {fixture,compile,driver,SLOT,BASE};

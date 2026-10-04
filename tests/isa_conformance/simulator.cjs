'use strict';
if (!process.argv[2]) {
// Disposable in-memory objects only. Real step()/fetch/decode dispatch.
const fs = require('node:fs');
global.window = {};
const S = require('../../simulator/simulator');
const A = require('../../simulator/assembler');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = {vectors: [], conditions: []};
function fixture(v) {
    const s = new S();
    s.bootComplete = false;
    for (const [slot, addr] of [[20, 0x200], [21, 0x300], [22, 0x400]])
        s.writeNSEntry(slot, addr, 63, 0, 0, 1, 0, slot === 20 ? 4 : 0, 0);
    s.bootComplete = true;
    for (const slot of [20, 21, 22]) s.markLive(slot);
    const cr = (word0, word1, word2 = 0) => ({word0, word1, word2, word3: 0, m: 0});
    s.cr[6] = cr(s.createGT(0, 20, v.opcode === 1 ? {S: 1} : {L: 1}, 1), 0x200, 4 << 17);
    s.cr[14] = cr(s.createGT(0, 22, {R: 1, X: 1}, 1), 0x400);
    s.cr[12] = cr(0, 0);
    const gt = s.createGT(0, 21, {E: 1, B: v.opcode === 1 ? 1 : 0}, 1) >>> 0;
    s.cr[2] = v.opcode === 0 ? cr(0, 0) : cr(gt, 0x300);
    for (let i = 0; i < 4; i++) s.memory[0x200+i] = v.opcode === 1 ? 0 : gt;
    s.memory[0x400] = ((31 << 27) | (1 << 10)) >>> 0;
    s.memory[0x401] = v.word;
    s.pc = 0;
    const faults = [];
    // Only fault routing is contained: no boot recovery can conceal the observation.
    s.fault = (type, message) => faults.push({type, message});
    return {s, faults, gt};
}
const snapshot = s => ({pc: s.pc, dr: Array.from(s.dr),
    cr: JSON.parse(JSON.stringify(s.cr)), flags: {...s.flags}});
for (const v of input) {
    const {s, faults, gt} = fixture(v);
    if (v.kind === 'mcmp') {s.dr[2] = v.left; s.dr[1] = v.right;}
    else if (v.register) s.dr[v.register] = v.base;
    const before = snapshot(s), mem = s.memory.slice(), reads = [];
    let executingOperand = false;
    for (const name of ['_execLoad', '_execSave']) {
        const execute = s[name];
        s[name] = function(...args) {
            executingOperand = true;
            try { return execute.apply(this, args); }
            finally { executingOperand = false; }
        };
    }
    const capRead = s._capRead;
    s._capRead = function(cr, address, ...rest) {
        if (executingOperand) reads.push({cr, address});
        return capRead.call(this, cr, address, ...rest);
    };
    const mload = s.mLoad;
    s.mLoad = function(gt, permission, cr, address, ...rest) {
        if (executingOperand && Number.isInteger(address))
            reads.push({cr, address, stage: 'mLoad access validation'});
        return mload.call(this, gt, permission, cr, address, ...rest);
    };
    let arithmetic;
    const resolve = s._resolveCompactIndex;
    s._resolveCompactIndex = function(d) {
        const resolved = resolve.call(this, d);
        arithmetic = {index: resolved?.imm ?? null, arithmetic_fault: !resolved};
        return resolved;
    };
    const retired = !!s.step();
    const writes = [];
    for (let i = 0; i < mem.length; i++)
        if (mem[i] !== s.memory[i]) writes.push({address: i, before: mem[i], after: s.memory[i]});
    const compiled = new A().assemble(v.source);
    result.vectors.push({id: v.id, before, after: snapshot(s), reads, writes,
        retired, fault: faults[0]?.type ?? null, faults, z: Number(s.flags.Z),
        ...arithmetic, gt,
        assembler: {errors: compiled.errors, words: compiled.words}});
}
const s = Object.create(S.prototype);
for (let c = 0; c < 16; c++) for (let f = 0; f < 16; f++) {
    s.flags = {N: !!(f&1), Z: !!(f&2), C: !!(f&4), V: !!(f&8)};
    result.conditions.push([c, f, Number(s.checkCondition(c))]);
}
process.stdout.write(JSON.stringify(result));
} else {
// Real constructor, memory fetch, decoder and step. No instruction replacement.
const fs = require('fs');
global.window = {};
const Simulator = require('../../simulator/simulator.js');
const vectors = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const results = [];
for (const v of vectors) {
    const s = new Simulator();
    s.bootComplete = false;
    s.writeNSEntry(30, 1024, 63, 0, 0, 1, 0, 0, 0);
    s.cr = Array.from({length:16}, () => ({word0:0,word1:0,word2:0,word3:0,m:0}));
    s.cr[14] = {word0:0x5200001e,word1:1024,word2:0,word3:0,m:0};
    s.memory[1024] = ((31 << 27) | (4 << 10)) >>> 0;
    s.memory[1025] = v.word;
    s.dr = v.dr.slice();
    s.flags = Object.fromEntries(['N','Z','C','V'].map((k,i)=>[k,!!(v.flags & (1<<i))]));
    s.pc = 0;
    s.bootComplete = true;
    s.halted = false;
    const snapshot = () => ({
        pc_word:s.pc, dr:Array.from(s.dr),
        flags:['N','Z','C','V'].reduce((f,k,i)=>f | (Number(s.flags[k])<<i),0),
        cr:s.cr.map(c=>[c.word0>>>0,c.word1>>>0,c.word2>>>0,c.word3>>>0]),
        m:s.cr.map(c=>c.m||0)
    });
    const initial = snapshot();
    let fault = null, faultState = null, index = null, observing = false;
    for (const method of ['_execLoad','_execSave','_execMcmp','_execShl','_execBfext','_execBfins']) {
        const original = s[method];
        s[method] = function(...args) {
            observing = true;
            try { return original.apply(this,args); }
            finally { observing = false; }
        };
    }
    const resolve = s._resolveCompactIndex;
    s._resolveCompactIndex = function(d) {
        const result = resolve.call(this,d);
        index = result ? result.imm : null;
        return result;
    };
    // Capture the architectural fault boundary before host recovery can erase it.
    const originalFault = s.fault;
    s.fault = function(code,...args) {
        fault = code; faultState = snapshot(); observing = false;
        return originalFault.call(this,code,...args);
    };
    const reads = [], writes = [];
    const memory = s.memory;
    s.memory = new Proxy(memory, {
        get(target,key) {
            if (observing && /^\d+$/.test(String(key))) reads.push(Number(key));
            const value = Reflect.get(target,key,target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target,key,value) {
            if (observing && /^\d+$/.test(String(key))) writes.push({word:Number(key),value:value>>>0});
            return Reflect.set(target,key,value,target);
        }
    });
    const result = s.step();
    // Snapshot scans emitted by getState are not bus reads. Keep only execution
    // reads up to fault entry / result, excluding code/header/Namespace metadata.
    results.push({id:v.id,initial,final:faultState || snapshot(),fault,index,
        terminal:fault ? 'fault' : result ? 'retire' : 'timeout',
        data_reads:reads,
        writes, read_observation:'memory proxy during instruction body, before fault recovery',
        raw_result:result && {opName:result.opName,skipped:result.skipped}});
}
process.stdout.write(JSON.stringify(results));
}

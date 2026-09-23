'use strict';

// The live Code view must decode the indexed operand, not CR0's earlier alias.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
global.window = {};
const Simulator = require('./simulator.js');
const CapabilityTokens = require('./capability_tokens.js');
const {lumpDecodeContentFrameApi} = require('./lump-content-frame.js');
const source = fs.readFileSync(__dirname + '/app-cr-detail.js', 'utf8');
const sim = new Simulator();
const base = 0x590, size = 1024, cc = 11;
sim.nsLabels[1] = 'SelfTest';
sim.nsLabels[7] = 'WukongCallHome';
sim.writeNSEntry(1, 0xA00, 60, 0, 0, 1, 0, 3, 0);
sim.writeNSEntry(7, 0xB00, 60, 0, 0, 1, 0, 3, 0);
sim.memory[base] = ((0x1F << 27) | (4 << 23) | (34 << 10) | cc) >>> 0;
sim.memory[0x5AF] = 0x17030001;
sim.memory[0x5B0] = 0x17030007;
const caps = Array.from({length: cc}, () => ({name: 'Unused', rights: ['E']}));
caps[1].name = 'SelfTest';
caps[7].name = 'WukongCallHome';
const bytes = Buffer.from(JSON.stringify({capabilities: caps}));
sim.memory[base + 35] = (0xAB000000 | bytes.length) >>> 0;
const packed = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
bytes.copy(packed);
for (let i = 0; i < packed.length / 4; i++) sim.memory[base + 36 + i] = packed.readUInt32BE(i * 4);
const clistBase = base + size - cc;
sim.memory[clistBase + 1] = sim.createGT(0, 1, {E: 1}, 1);
sim.memory[clistBase + 7] = sim.createGT(0, 7, {E: 1}, 1);
const stale = {10: {_caps: Array(cc).fill({name: 'SelfTest', rights: ['E']})}};
const ctx = vm.createContext({
    sim, CapabilityTokens, lumpDecodeContentFrameApi, _lumpManifests: stale,
    _lumpsCache: [], _escDecomp: s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
});
vm.runInContext(source.slice(source.indexOf('function _codeViewCallContext(')), ctx);
const header = sim.parseLumpHeader(sim.memory[base]);
const ownedSource = 'CALL CR6[7] ; my original source comment';
const before = Array.from(sim.memory.slice(base, base + size));
const snapshot = ctx._codeViewCallContext(base, header);
function annotation(word, context = snapshot) {
    return ctx._decompileWord(word, 0x5B0, 10, clistBase, {0: 'SelfTest'}, context).desc;
}
assert.equal(annotation(0x17030007), 'call WukongCallHome via CR6[0x0007]');
assert.equal(annotation(0x17030001), 'call SelfTest via CR6[0x0001]');
assert(!annotation(0x17030007).includes('selftest(CR0)'));
assert(annotation(0x17030007, null).includes('unresolved'));
const missing = {...snapshot, caps: []};
assert(annotation(0x17030007, missing).includes('GT 0x'));
assert(!annotation(0x17030007, missing).includes('SelfTest'));
const mismatched = {...snapshot, caps: Array(cc).fill({name: 'SelfTest', rights: ['E']})};
assert(annotation(0x17030007, mismatched).includes('metadata/GT mismatch'));
assert(!annotation(0x17030007, mismatched).includes('call SelfTest'));
assert(annotation(0x1703000B).includes('unresolved'));
assert.equal(ctx._codeViewCallContext(base, {valid: false}), null);
assert.deepEqual(Array.from(sim.memory.slice(base, base + size)), before);
assert.equal(ownedSource, 'CALL CR6[7] ; my original source comment');

// Production row path receives the exact loaded allocation, not a slot manifest.
const ui = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
assert(ui.includes('_codeViewCallContext(baseLoc, lumpHdr)'));
assert(ui.includes('_decompileWord(word, addr, nsIdx, _lumpClistBase, _crPets3, _callContext)'));
const detailUI = fs.readFileSync(__dirname + '/app-cr-display.js', 'utf8');
assert(detailUI.includes('_codeViewCallContext(loc, sim.parseLumpHeader(sim.memory[loc] >>> 0))'));
assert(detailUI.includes('_decompileWord(word, addr, nsIdx, _clBase, _crPets1, _callContext1)'));
const Assembler = require('./assembler.js');
const render = vm.createContext({
    decomp: ctx._decompileWord(0x17030007, 0x5B0, 10, clistBase, {0: 'SelfTest'}, snapshot),
    addr: 0x5B0, word: 0x17030007, nsIdx: 10, w: 31,
    isCompiler: false, rowClass: 'code-pc-row', codeHtml: '',
    _controlFlowButton: '', bpDot: '', _clobberIcon: '', _clobberOriginIcon: '',
    decoded: new Assembler().disassemble(0x17030007), _brArrows: {hasBranches: false},
});
const rowStart = ui.indexOf('            const _openSource =');
const rowEnd = ui.indexOf("            codeHtml += '</tr>';", rowStart) + "            codeHtml += '</tr>';".length;
vm.runInContext(ui.slice(rowStart, rowEnd), render);
assert(render.codeHtml.includes('0x05B0'));
assert(render.codeHtml.includes('0x17030007'));
assert(/CALL\s+CR6\[0x0007\]/.test(render.codeHtml));
assert(render.codeHtml.includes('call WukongCallHome via CR6[0x0007]'));
assert(!render.codeHtml.includes('SelfTest') && !render.codeHtml.includes('selftest'));
console.log('PASS indexed CALL annotations: exact loaded C-list, row 1 vs 7, stale/missing metadata, unchanged words/source');
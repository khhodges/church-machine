'use strict';
// Focused regressions: symbolic dot-name CALL relocation
// (church.symbolic-lump-binding/v1). Run: node simulator/test_symbolic_call_binding.js
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
global.ChurchAssembler = require('./assembler.js');
const ChurchAssembler = global.ChurchAssembler;
const CLOOMCCompiler = require('./cloomc_compiler.js');
const ChurchSimulator = require('./simulator.js');
const { buildLump, buildApiDefinition, embedSelfDefinition } = require('./lump_builder.js');
const codec = require('./lump-api-codec.js');
const contract = require('./lump-api-contract.js');
const guard = require('./symbolic-lump-guard.js');
const ph = cond => guard.placeholder(cond);
const { lumpDecodeContentFrameApi } = require('./lump-content-frame.js');

const PLACEHOLDER = 0xF7000000;
const NATIVE = 'abstraction ide.Probe {\n capabilities {\n  SELF E\n  ide.SelfTest E\n  ide.WukongCallHome E\n }\n' +
    ' method Run() {\n  CALL ide.SelfTest.Run\n  CALL ide.WukongCallHome.Run\n }\n}';
const ASM = 'abstraction ide.Probe {\ncapabilities {\n SELF E,\n ide.SelfTest E,\n ide.WukongCallHome E\n}\nmethod Run() {\n' +
    'CALLEQ ide.SelfTest.Run\nCALL ide.WukongCallHome\nRETURN\n}\n}';

function artifact(src) {
    const r = new CLOOMCCompiler().compile(src, []);
    assert.deepStrictEqual(r.errors, [], 'no destination API/method convention needed');
    assert.deepStrictEqual(r.warnings || [], [], 'no unresolved-only warnings');
    const L = buildLump(r);
    let api = buildApiDefinition(r, L.words);
    api = codec.encode(api, { cw: L.cw, cc: L.cc });
    return { r, api, words: embedSelfDefinition(L.words, api, src, 2, r.language) };
}

// 1. Compile with missing targets/API: both frontends, placeholder words, metadata.
const native = artifact(NATIVE);
const asm = artifact(ASM);
for (const [label, a, expect] of [
    ['native', native, [['ide.SelfTest.Run', 1, 14], ['ide.WukongCallHome.Run', 2, 14]]],
    ['assembly', asm, [['ide.SelfTest.Run', 1, 0], ['ide.WukongCallHome', 2, 14]]]]) {
    const sb = a.api.symbolic_binding;
    assert.strictEqual(sb.schema, 'church.symbolic-lump-binding/v1', label);
    assert.strictEqual(sb.owner, 'ide.Probe');
    assert.deepStrictEqual(sb.calls.map(c => [c.full_name, c.row, c.condition]), expect, label);
    for (const c of sb.calls) assert.strictEqual(a.words[c.word_offset] >>> 0, ph(c.condition), label + ' conditional placeholder');
    assert.deepStrictEqual(sb.dependencies.map(d => [d.name, d.relocation_row, d.symbolic_self]),
        [['SELF', 0, true], ['ide.SelfTest', 1, false], ['ide.WukongCallHome', 2, false]]);
    const cc = a.words[0] & 255;
    assert.strictEqual(a.words[a.words.length - cc] >>> 0, 0xFEED5E1F, 'canonical SELF placeholder');
    for (let i = 1; i < cc; i++) assert.strictEqual(a.words[a.words.length - cc + i], 0, 'external rows zero');
    // Integrity-covered: decoded from exact bytes, strict contract, compact round trip.
    const decoded = lumpDecodeContentFrameApi(a.words);
    assert.deepStrictEqual(decoded.symbolic_binding, sb, label + ' survives frame decode');
    assert.deepStrictEqual(codec.expand(decoded, a.words).symbolic_binding, sb);
    assert.deepStrictEqual(codec.encode(codec.expand(decoded, a.words), { cw: (a.words[0] >>> 10) & 8191, cc })
        .symbolic_binding, sb);
}
// No numeric selector or default entry is guessed for any symbolic site.
assert(!native.r.methods[0].code.some(w => (w >>> 27) === 2), 'no guessed CALL words');

// 2. Strict contract rejects malformed metadata.
{
    const hdr = { cw: (native.words[0] >>> 10) & 8191, cc: native.words[0] & 255 };
    const bad = JSON.parse(JSON.stringify(native.api));
    bad.symbolic_binding.calls[0].row = 0;
    assert.throws(() => contract.validate(bad, hdr), /call row/);
    const extra = JSON.parse(JSON.stringify(native.api));
    extra.symbolic_binding.calls[0].selector = 1;
    assert.throws(() => contract.validate(extra, hdr), /unknown field/);
}

// 3. Server worker path produces identical canonical bytes and no warnings.
{
    const out = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'compile_worker.js')],
        { input: JSON.stringify({ source: NATIVE, language: 'javascript' }), encoding: 'utf8', timeout: 30000 });
    const res = JSON.parse(out.stdout);
    assert.strictEqual(res.ok, true, res.error);
    assert.deepStrictEqual(res.warnings, []);
    const api = lumpDecodeContentFrameApi(res.words);
    assert.deepStrictEqual(api.symbolic_binding.calls.map(c => c.full_name),
        ['ide.SelfTest.Run', 'ide.WukongCallHome.Run']);
    for (const c of api.symbolic_binding.calls) assert.strictEqual(res.words[c.word_offset] >>> 0, ph(c.condition));
}

// 4. Runtime: unused unresolved site does not fault; executed one HardFaults
//    (existing INVALID_OP path) with no rebind/halt-by-sentinel.
function run(words, steps) {
    const sim = new ChurchSimulator();
    const image = [0xF8000000, ...words];
    sim.loadProgram(image, 0x0100);
    sim.bootComplete = true;
    sim.cr[14] = { word0: sim.createGT(0, 0, { R: 1, X: 1 }, 1), word1: 0x0100,
        word2: image.length - 1, word3: 0, m: 0 };
    sim.pc = 0; sim.physicalPC = 0x0101; sim.halted = false;
    sim.faultLog = [];
    for (let i = 0; i < steps && !sim.halted; i++) sim.step();
    return sim;
}
{
    const nop = new ChurchAssembler().assemble('NOP').words[0];
    // BRANCH +2 skips the placeholder; HALT afterwards.
    const skip = new ChurchAssembler().assemble('BRANCH 2').words[0];
    const unused = run([skip, PLACEHOLDER, nop, 0], 3);
    assert.strictEqual(unused.faultLog.length, 0, 'unused unresolved reference does not fault');
    const used = run([nop, PLACEHOLDER, nop], 2);
    assert.strictEqual(used.faultLog.length, 1, 'executed unresolved reference faults');
    assert.strictEqual(used.faultLog[0].faultCode, ChurchSimulator.FAULT_CODES.INVALID_OP);
    assert(/unresolved symbolic CALL/.test(used.faultLog[0].message || JSON.stringify(used.faultLog[0])));
    // Execution never patched the placeholder (no runtime rebind).
    assert.strictEqual(used.memory[0x0102] >>> 0, PLACEHOLDER);
}

// 4b. Conditional placeholder: false condition is skipped (no fault),
{
    const sim = Object.create(ChurchSimulator.prototype);
    const base = 256, cc = native.words[0] & 255;
    sim.memory = new Uint32Array(base + native.words.length + 1);
    sim.memory.set(native.words, base);
    sim.nsCount = 1;
    sim.readNSEntry = () => ({word0_location: base});
    sim.programCapabilities = native.r.capabilities;
    sim.resolveCapabilityName = () => { throw Error('Runtime must not bind a saved symbolic row'); };
    let fault;
    sim.fault = (code, message) => { fault = {code, message}; };
    const address = base + native.words.length - cc + 1;
    assert.strictEqual(sim._resolveDeclaredSlot(0, 1, address, 'LOAD'), null);
    assert.strictEqual(fault.code, 'NULL_CAP');
    assert.strictEqual(sim.memory[address], 0, 'unresolved saved row was not mutated');
}

// Conditional placeholder: false condition is skipped (no fault),
//     true condition HardFaults. Uses the existing condition check.
{
    const nop = new ChurchAssembler().assemble('NOP').words[0];
    for (const [z, faults] of [[0, 0], [1, 1]]) {
        const sim = new ChurchSimulator();
        const image = [0xF8000000, ph(0), nop];
        sim.loadProgram(image, 0x0100);
        sim.bootComplete = true;
        sim.cr[14] = { word0: sim.createGT(0, 0, { R: 1, X: 1 }, 1), word1: 0x0100,
            word2: image.length - 1, word3: 0, m: 0 };
        sim.pc = 0; sim.physicalPC = 0x0101; sim.halted = false; sim.faultLog = [];
        sim.flags.Z = z;
        sim.step();
        assert.strictEqual(sim.faultLog.length, faults, `CALLEQ placeholder with Z=${z}`);
    }
}

// 4c. Explicit "CALL obj, Method" and named LOAD->CALL defer identically,
//     without destination method information; numeric CR calls unchanged.
{
    const src = 'abstraction ide.Probe {\ncapabilities {\n SELF E,\n ide.Target E\n}\nmethod Run() {\n' +
        'CALL ide.Target, Run\nLOAD CR3, ide.Target\nCALL ide.Target.Run\nCALLNE ide.Target, Stop\nCALL CR3, 2\nRETURN\n}\n}';
    const r = new CLOOMCCompiler().compile(src, []);
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.warnings || [], []);
    const m = r.methods[0];
    assert.deepStrictEqual(m.symbolicCalls.map(c => [c.addr, c.full_name, c.row, c.condition]),
        [[0, 'ide.Target.Run', 1, 14], [2, 'ide.Target.Run', 1, 14], [3, 'ide.Target.Stop', 1, 1]]);
    assert.strictEqual(m.code[4] >>> 27, 2, 'numeric CR CALL keeps real CALL encoding');
    assert.strictEqual(m.code[4], new ChurchAssembler().assemble('CALL CR3, 2').words[0]);
    const nat = new CLOOMCCompiler().compile('abstraction ide.Probe {\n capabilities {\n  SELF E\n  ide.Target E\n }\n' +
        ' method Run() {\n  CALL ide.Target, Run\n }\n}', []);
    assert.deepStrictEqual(nat.errors, []);
    assert.deepStrictEqual(nat.methods[0].symbolicCalls.map(c => c.full_name), ['ide.Target.Run']);
}

// 4d. Browser save guard: canonical zero/SELF accepted from exact bytes;
//     tampering, local GTs and divergent plan contracts are rejected.
{
    const ok = guard.validate(native.words, { planContract: native.api.symbolic_binding,
        capabilities: native.r.capabilities });
    assert.strictEqual(ok.symbolic, true);
    assert.deepStrictEqual(ok.contract, native.api.symbolic_binding);
    const cc = native.words[0] & 255;
    const local = native.words.slice(); local[local.length - cc + 1] = 0x4A010005;
    assert.throws(() => guard.validate(local), /destination-local/);
    const self = native.words.slice(); self[self.length - cc] = 0;
    assert.throws(() => guard.validate(self), /SELF/);
    const patched = native.words.slice(); patched[native.api.symbolic_binding.calls[0].word_offset] = 0x17030021;
    assert.throws(() => guard.validate(patched), /placeholder/);
    const plan = JSON.parse(JSON.stringify(native.api.symbolic_binding)); plan.calls[0].row = 2;
    assert.throws(() => guard.validate(native.words, { planContract: plan }), /differs/);
    const plain = artifact('abstraction ide.Plain {\ncapabilities {\n SELF E\n}\nmethod Run() {\nRETURN\n}\n}').words;
    assert.strictEqual(guard.validate(plain).symbolic, false);
    assert.throws(() => guard.validate(plain, { planContract: plan }), /absent/);
}

// 5. Canonical bytes are deterministic (recompile → identical words).
assert.deepStrictEqual(artifact(NATIVE).words, native.words);

console.log('symbolic CALL binding regressions passed');

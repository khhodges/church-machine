'use strict';
// Isolated ascending-layout experiment, NOT an installed or approved design.
// All provisioning below is fixture setup before boot, never actor authority.
(function(root) {
    const node = typeof module !== 'undefined' && module.exports;
    const Simulator = node ? require('./simulator') : root.ChurchSimulator;
    const fixtures = node ? require('./test_alice_mallory_thread_setup') : root.AliceMalloryThreadFixture;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const SECRET = 0x2A7;

    function create(binaries, options = {}) {
        if (!binaries && node) binaries = require('./compile_actor_programs').compileActorPrograms();
        check(binaries, 'Current compiled actor programs are required');
        const secret = options.secret === undefined ? SECRET : options.secret;
        check(Number.isInteger(secret) && secret >= 0 && secret <= 16383,
            'Fixture secret must fit the test driver immediate');
        const words = new Uint32Array(16384);
        words[0] = ((31 << 27) | (64 << 10) | (1 << 8)) >>> 0;
        words[2] = 2;
        words.set([0, 255, 0, 0], 4);
        const sim = Simulator.fromAscendingNamespaceImage(words,
            {word0:0x02000001, word1:0, word2:255, word3:0, m:1});
        const descriptor = (slot, base, limit) => {
            sim.memory.set([base, limit, sim._integrity32(base, limit), 0], slot * 4);
        };
        descriptor(1, 0, 255);
        const threadSlots = [2, 11, 12];
        const bodies = threadSlots.map((slot, i) => {
            const base = 256 + i * 256;
            descriptor(slot, base, 255);
            sim.memory[base] = sim.packLumpHeader(2, 32, 12, 2);
            const layout = sim._threadLayoutAtBase(base);
            check(layout && layout.valid, 'Invalid test Thread layout');
            return {slot, base, layout};
        });
        let cursor = 1024;
        function resident(slot, label, raw, privateDataRows = []) {
            const header = sim.parseLumpHeader(raw[0]), base = cursor;
            check(header.valid && header.lumpSize === raw.length, 'Invalid test LUMP');
            cursor += raw.length;
            check(cursor <= sim.memory.length, 'Test image exceeds RAM');
            const minted = sim._mintOrdinaryLumpIdentity(raw, slot, base,
                {compilerOwnedSelf:true, privateDataRows});
            check(minted.ok, label + ': ' + minted.message);
            sim.memory.set(minted.words, base);
            // Provision the disposable image before boot. Runtime has no
            // writable label/catalog maps and actors receive no table writer.
            descriptor(slot, base, sim.packNSWord1(header.cw, minted.entry.seq, 0, 0));
            sim.memory[slot * 4 + 3] = minted.entry.cacheToken;
            return {slot, base, header, gt:minted.selfGT, name:label};
        }
        const roles = ['ide.Alice', 'ide.Mallory'].map((name, i) => {
            check(Array.isArray(binaries[name]), name + ' compiled words missing');
            const raw = binaries[name].slice();
            const header = sim.parseLumpHeader(raw[0]);
            check(header.valid && header.cc === 2, name + ' requires SELF and own RW rows only');
            check(raw[raw.length - 1] === 0,
                name + ' fixture requires an unresolved own-RW binding');
            raw[raw.length - 1] = 0xFEEDDA7A;
            // The actor executable is used exactly as compiled, without
            // historical opcode patches. Only fixture SELF/private RW rows
            // are bound to their destination before boot.
            return {...resident(30 + i, name, raw, [1]),
                sourceFile:'examples/' + name.slice(4).toLowerCase() + '.cloomc'};
        });
        const instr = (op, dst, src, imm, cond = 14) => sim.encodeInstruction(op, cond, dst, src, imm);
        const load = (reg, row) => instr(0, reg, 6, row << 4);
        const change = reg => instr(4, reg, reg, 0);
        const add = (reg, val) => instr(21, reg, 0, 0x4000 | val);
        const threadGT = slot => sim.createGT(0, slot, {}, 1);
        function driver(slot, label, code, caps = []) {
            const raw = Array(64).fill(0), cc = 1 + caps.length;
            raw[0] = sim.packLumpHeader(0, code.length, cc, 0);
            raw.splice(1, code.length, ...code);
            raw[64 - cc] = Simulator.SELF_CAPABILITY_PLACEHOLDER;
            caps.forEach((cap, i) => { raw[65 - cc + i] = cap; });
            return resident(slot, label, raw);
        }
        const manager = driver(32, 'ActorTest.Manager', [
            load(2, 1), change(2), load(3, 2), change(3), 0,
        ], [threadGT(11), threadGT(12)]);
        const alice = driver(33, 'ActorTest.AliceDriver', [
            add(1, secret), instr(2, 1, 0, 1), // Alice.Stash via primed CR1
            load(1, 1), add(1, 0), instr(2, 1, 0, 2), // reload after RETURN, Reveal
            instr(22, 3, 1, 0x4000 | secret), // compare result before handing off
            instr(23, 0, 0, 4, 1), // NE: skip handoff to explicit HALT
            load(2, 2), change(2), 0, 0,
        ], [roles[0].gt, threadGT(2)]);
        const mallory = driver(34, 'ActorTest.MalloryDriver', [
            instr(2, 1, 0, 1), 0, // Mallory.Steal via primed CR1; must not reach HALT
        ]);
        [manager, alice, mallory].forEach((program, i) => {
            const body = bodies[i];
            sim.memory[body.base + body.layout.capsStart] = program.gt;
            sim._formatThreadRootSentinel(body.base, body.layout, program.gt, {image:true});
            if (i) {
                fixtures.prepareThreadContinuation(sim, body, program);
                sim.memory[body.base + body.layout.capsStart + 1] = roles[i - 1].gt;
            }
        });
        const initialImage = sim.memory.slice();
        sim.beginBoot();
        for (let i = 0; i < 3; i++)
            check(sim._bootStep(), 'Ascending test boot failed: ' + JSON.stringify(sim.faultLog));
        check(sim.bootComplete && sim._currentThreadSlot === 2, 'Manager must own boot');
        return {sim, bodies, roles, threadSlots, manager, alice, mallory, initialImage,
            attempts:0, limit:40, retired:[], scenario:'ascending-actors',
            secret, aliceReturned:false, secretBeforeAttack:null, firstFaultEvidence:null, passed:false};
    }

    function step(state) {
        check(!state.passed && state.attempts < state.limit && !state.sim.halted, 'Test is stopped');
        const {sim, bodies, roles} = state;
        // Capture protected data independently of Mallory's own view.
        if (sim._currentThreadSlot === 12 && state.secretBeforeAttack === null) {
            check(state.aliceReturned, 'Mallory must not run before Alice successfully returns');
            state.secretBeforeAttack = Array.from(sim.memory.slice(
                roles[0].base, roles[0].base + roles[0].header.lumpSize));
        }
        const owner = sim._currentThreadSlot, pc = sim.pc, physicalPC = sim._nextPhysicalAddr();
        const opcode = sim.memory[physicalPC] >>> 27;
        sim.step();
        state.attempts++;
        state.retired.push({owner, pc, physicalPC, opcode, outcome:sim.halted ? 'stopped' : 'retired'});
        if (owner === 11 && sim._currentThreadSlot === 2) {
            check(sim.memory[bodies[1].base + bodies[1].layout.drStart + 1] === state.secret,
                'Alice Reveal did not return the stored value');
            check(sim.memory[roles[0].base + 9] === state.secret, 'Alice Stash did not write the secret');
            state.aliceReturned = true;
        }
        if (sim.halted) {
            const evidence = sim.lastStepEvidence;
            check(sim.faultLog.length === 1 && sim.faultLog[0].type === 'NO_CAPABILITY',
                'Expected exactly Mallory NO_CAPABILITY, got ' + JSON.stringify(sim.faultLog));
            check(owner === 12 && sim.parseGT(sim.cr[14].word0).index === roles[1].slot,
                'Expected fault inside Mallory on Thread.3');
            check(state.secretBeforeAttack && state.secretBeforeAttack.every(
                (word, i) => word === sim.memory[roles[0].base + i]), 'Alice LUMP changed during attack');
            check(evidence && evidence.outcome === 'fault', 'Missing fault instruction evidence');
            state.firstFaultEvidence = evidence;
            state.passed = true;
            state.limit = state.attempts;
        }
        check(state.passed || state.attempts < state.limit, 'Test instruction limit reached without expected result');
        return outcome(state);
    }
    function outcome(state) {
        return state.passed
            ? 'PASS: Alice Stash/Reveal returned correctly in Thread.2; Mallory was denied in Thread.3; Alice data unchanged.'
            : 'Ascending fixture ready: separate Threads, own actor E GT in CR1. ' + state.attempts + ' instructions attempted.';
    }
    const api = {create, step, outcome};
    if (node) module.exports = api;
    else root.AliceMalloryAscendingLab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

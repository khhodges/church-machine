'use strict';

// Object-bound software execution support. The canonical slot identity owns
// the envelope; no PC, caller identity, or suspended Thread context is cached.
(function expose(root) {
    const node = typeof module !== 'undefined' && module.exports;
    const codec = node ? require('./idx1.js') : root.ChurchIDX1;
    const Envelope = node ? require('./idx1-execution-envelope.js') : root.ChurchIDX1Envelope;
    const Memory = node ? require('./idx1-memory.js') : root.ChurchIDX1Memory;
    const bindings = new WeakMap();
    const installations = new WeakMap();
    const fail = (code, message) => {
        const error = new Error(message);
        error.code = code;
        error.idx1 = true;
        throw error;
    };
    const requireCheck = check => {
        if (!check.ok) fail(check.fault, 'IDX1 capability authority check failed');
        return check;
    };
    const supportedPackets = new Set([0, 16, 17, 18, 19, 23]);
    function requireSupported(words, starts) {
        for (const at of starts) {
            if (words[at] >>> 27 === 10 && !supportedPackets.has(words[at + 1] >>> 27))
                fail('UNSUPPORTED_PROFILE', 'IDX1 indexed CALL, SAVE, CHANGE and SWITCH are not yet supported by this software runtime');
            if ([1, 4, 5, 7].includes(words[at] >>> 27))
                fail('UNSUPPORTED_PROFILE', 'IDX1 SAVE, CHANGE, SWITCH and LAMBDA transactions are not yet supported');
        }
    }
    async function install(sim, bytes, slot) {
        const identity = sim.getSlotIdentity(slot);
        if (!identity || identity.authorized !== true || !identity.executionDigest)
            fail('UNSUPPORTED_PROFILE', 'IDX1 requires protected whole-envelope execution identity');
        const envelope = await Envelope.parse(bytes);
        if (identity !== sim.getSlotIdentity(slot) || identity.executionDigest !== envelope.executionDigest ||
                identity.binaryHash !== envelope.metadata.payloadSha256)
            fail('SEAL', 'IDX1 protected identity does not bind exact envelope and payload');
        requireSupported(envelope.words, envelope.metadata.layout.instructionStarts);
        const entry = sim.readNSEntry(slot);
        if (!entry || !sim.validateMAC(entry)) fail('SEAL', 'Invalid installation Namespace authority');
        const base = entry.word0_location;
        if (!Number.isInteger(base) || base < 0 || base + envelope.words.length > sim.memory.length)
            fail('BOUNDS', 'IDX1 installation exceeds memory');
        if (envelope.words.some((word, i) => word !== sim.memory[base + i]))
            fail('SEAL', 'Installed payload differs from protected envelope');
        if (identity.gtSeq !== sim.parseNSWord1(entry.word1_limit).gtSeq)
            fail('VERSION', 'Installation sequence differs from protected identity');
        const memory = Memory.protectMemory(sim.memory);
        const nsBase = sim._nsSlotBase(slot);
        const cw = envelope.metadata.layout.codeWords;
        const cc = envelope.words[0] & 255;
        if (!cc) fail('UNSUPPORTED_PROFILE', 'IDX1 execution requires a canonical SELF C-list context; cc=0 is not supported');
        if (envelope.words[envelope.words.length - cc] !==
                sim.createGT(identity.gtSeq, slot, { E: 1 }, 1))
            fail('SEAL', 'IDX1 SELF does not identify its exact installation');
        // Validate all ranges before installing any protection or binding.
        if (!Number.isInteger(nsBase) || nsBase < 0 || nsBase + 4 > memory.memory.length)
            fail('BOUNDS', 'IDX1 Namespace entry exceeds memory');
        memory.protect(base, base + cw + 1); // header, executable code and typed data
        if (cc) memory.protect(base + envelope.words.length - cc, base + envelope.words.length - cc + 1);
        memory.protect(nsBase, nsBase + 1);
        memory.protect(nsBase + 1, nsBase + 2, 0x40000000); // GC G-bit is not authority
        memory.protect(nsBase + 2, nsBase + 4);
        sim.memory = memory.memory;
        const accepted = Object.freeze({ envelope, base, memory, slot });
        bindings.set(identity, accepted);
        const live = (installations.get(sim) || []).filter(item => item.memory.memory === sim.memory);
        live.push(accepted);
        installations.set(sim, live);
        return envelope.executionDigest;
    }
    function binding(sim, slot) {
        const identity = sim.getSlotIdentity(slot);
        const accepted = identity && bindings.get(identity);
        if (!accepted) {
            const entry = sim.readNSEntry(slot);
            if (entry) {
                const start = entry.word0_location;
                const end = start + sim.parseNSWord1(entry.word1_limit).limit + 1;
                if ((installations.get(sim) || []).some(item =>
                    item.memory.memory === sim.memory && start < item.base + item.envelope.words.length &&
                    end > item.base))
                    fail('UNSUPPORTED_PROFILE', 'Namespace alias cannot downgrade installed IDX1 execution');
            }
            if (identity && identity.executionDigest)
                fail('UNSUPPORTED_PROFILE', 'IDX1 identity has no installed executable binding');
            return null;
        }
        if (sim.memory !== accepted.memory.memory) fail('SEAL', 'IDX1 installation memory was replaced');
        const entry = sim.readNSEntry(slot);
        if (!entry || entry.word0_location !== accepted.base || !sim.validateMAC(entry) ||
                sim.parseNSWord1(entry.word1_limit).gtSeq !== identity.gtSeq)
            fail('SEAL', 'IDX1 object binding no longer matches Namespace authority');
        return accepted;
    }
    function requireStart(accepted, word) {
        if (!Number.isInteger(word) ||
                !accepted.envelope.metadata.layout.instructionStarts.includes(word))
            fail('BOUNDS', 'IDX1 target is not an admitted instruction start');
    }
    function preflightDRWrite(sim, register) {
        const installed = (installations.get(sim) || []).find(item => item.memory.memory === sim.memory);
        if (!installed) return;
        const base = sim._activeThreadBase();
        if (base === null) return;
        const layout = sim._threadLayoutAtBase(base);
        if (!layout || !layout.valid) fail('BOUNDS', 'Invalid destination Thread geometry');
        const home = base + 1 + register;
        requireCheck(sim.mLoad(sim.cr[12].word0, null, 12, home));
        installed.memory.requireWritable(home, home + 1);
    }
    function preflightMemoryWrite(sim, start, end) {
        const installed = (installations.get(sim) || []).find(item => item.memory.memory === sim.memory);
        if (installed) installed.memory.requireWritable(start, end);
    }
    function entry(sim, slot, pc) {
        const accepted = binding(sim, slot);
        if (accepted) requireStart(accepted, pc + 1);
        return accepted;
    }
    function resolveSelector(sim, slot, selector) {
        const accepted = binding(sim, slot);
        if (!accepted) return null;
        const layout = accepted.envelope.metadata.layout;
        let target = layout.fastEntry;
        if (selector !== 0) {
            const item = accepted.envelope.dispatch.find(item => item.selector === selector);
            if (!item) fail('BOUNDS', 'IDX1 method selector is absent');
            if (item.kind === 'private') fail('PRIVATE_METHOD', 'IDX1 method selector is private');
            target = item.target;
        }
        requireStart(accepted, target);
        return target - 1;
    }
    function execute(sim, accepted) {
        const pc = sim.pc, at = pc + 1;
        requireStart(accepted, at);
        const words = accepted.envelope.words;
        const prefixed = words[at] >>> 27 === 10;
        const length = prefixed ? (((words[at] >>> 25) & 3) === 3 ? 3 : 2) : 1;
        let packet;
        const d = sim.decodeInstruction(words[at + (prefixed ? 1 : 0)]);
        if (prefixed) packet = codec.decodePacket(words.slice(at, at + length));
        else {
            const imm = words[at] & 0x7fff, op = words[at] >>> 27;
            let register = 0, magnitude = imm, subtract = false;
            if (op === 23 && (imm & 0x4000)) { magnitude = 0x8000 - imm; subtract = true; }
            if (op === 18 || op === 19) magnitude = (imm >>> 5) & 31;
            if (op === 16 || op === 17) {
                if (imm & 0x4000) magnitude = imm & 0x3fff;
                else { register = imm & 15; magnitude = (imm >>> 4) & 1023; }
            }
            packet = { opcode: op, condition: (words[at] >>> 23) & 15,
                a: d.crDst, b: d.crSrc, immediate: imm,
                role0: { register, magnitude, subtract } };
        }
        const result = { pc, physicalPC: sim.physicalPC, instr: d,
            packetWords: words.slice(at, at + length), desc: 'IDX1' };
        // Structure is checked before the sole W1 predicate. False predicates
        // neither inspect source authority nor evaluate arithmetic.
        if (!codec.conditionPasses(packet.condition, sim.flags)) {
            sim.pc += length;
            return { ...result, skipped: true, desc: 'IDX1 condition false' };
        }
        preflightDRWrite(sim, 0); // Retirement must not fail after operand effects.
        if (!supportedPackets.has(packet.opcode))
            fail('UNSUPPORTED_PROFILE', 'Unsupported indexed operation');
        const registers = sim.dr.slice();
        if (packet.opcode === 23) {
            const target = at + codec.evaluateDescriptor(packet.role0, registers, true);
            requireStart(accepted, target);
            sim.pc = target - 1;
            return { ...result, desc: 'IDX1 BRANCH' };
        }
        if (packet.opcode === 18 || packet.opcode === 19) {
            const position = codec.evaluateDescriptor(packet.role0, registers);
            const width = packet.immediate & 31;
            if (position + width > 32) fail('BOUNDS', 'IDX1 bit field exceeds DR width');
            const mask = (2 ** width - 1) >>> 0;
            const source = packet.b === 0 ? 0 : registers[packet.b] >>> 0;
            const old = packet.a === 0 ? 0 : registers[packet.a] >>> 0;
            const value = packet.opcode === 18 ? ((source >>> position) & mask) >>> 0 :
                ((old & ~(mask << position)) | ((source & mask) << position)) >>> 0;
            preflightDRWrite(sim, packet.a);
            sim._writeDR(packet.a, value);
            sim.flags.N = !!(value & 0x80000000);
            sim.flags.Z = value === 0;
            sim.flags.C = false;
            sim.flags.V = false;
            sim.pc += length;
            return { ...result, desc: `IDX1 ${packet.opcode === 18 ? 'BFEXT' : 'BFINS'}` };
        }
        const source = { ...sim.cr[packet.b] };
        if (packet.b >= 12 && !([16, 17].includes(packet.opcode) && packet.b === 14))
            fail('PRIV_REG', 'IDX1 source capability is privileged');
        if (packet.opcode === 0 && packet.a >= 12 && !sim.mElevation)
            fail('PRIV_REG', 'IDX1 LOAD destination is privileged');
        const permission = packet.opcode === 0 ? (packet.b === 6 ? null : 'L') :
            packet.opcode === 16 ? (packet.b === 14 ? 'X' : 'R') : 'W';
        const sourceCheck = requireCheck(sim.mLoad(source.word0, permission, packet.b));
        if (sourceCheck.parsed.type !== 1)
            fail('UNSUPPORTED_PROFILE', 'IDX1 source must be a resident Inform capability');
        const index = codec.evaluateDescriptor(packet.role0, registers);
        if (packet.opcode === 16 || packet.opcode === 17) {
            const objectBase = sourceCheck.entry.word0_location;
            const objectEnd = objectBase + sim.parseNSWord1(sourceCheck.entry.word1_limit).limit;
            const viewEnd = source.word1 + sim.parseNSWord1(source.word2).limit;
            const address = source.word1 + index;
            if (!Number.isSafeInteger(source.word1) || source.word1 < objectBase ||
                    !Number.isSafeInteger(viewEnd) || viewEnd > objectEnd ||
                    !Number.isSafeInteger(address) || address < source.word1 ||
                    address > viewEnd || address > 0xffffffff)
                fail('BOUNDS', 'IDX1 data access exceeds authorized view');
            requireCheck(sim.mLoad(source.word0, permission, packet.b, address));
            preflightDRWrite(sim, packet.a);
            if (packet.opcode === 17) accepted.memory.requireWritable(address, address + 1);
            const operation = { ...d, idx1Offset: index };
            const committed = packet.opcode === 16 ? sim._execDread(operation) : sim._execDwrite(operation);
            if (!committed || sim.halted) return committed;
            sim.pc = pc + length;
            return { ...committed, pc, packetWords: result.packetWords };
        }
        // LOAD: source authority, exact index arithmetic, authorized count,
        // selected GT validation, then destination home validation. No lazy
        // resolution, namespace mutation or CR write can occur during planning.
        let base, count;
        if (packet.b === 6) {
            base = source.word1;
            count = sim._clistCountForCR(6);
            const header = sim.parseLumpHeader(sim.memory[sourceCheck.entry.word0_location]);
            if (!header.valid || base !== sourceCheck.entry.word0_location + header.lumpSize - count ||
                    !(sourceCheck.parsed.permissions.L || sourceCheck.parsed.permissions.E))
                fail('NO_CAPABILITY', 'IDX1 CR6 does not name its authorized C-list view');
        } else {
            const header = sim.parseLumpHeader(sim.memory[sourceCheck.entry.word0_location]);
            if (!header.valid || !header.cc) fail('BOUNDS', 'IDX1 LOAD source has no C-list');
            base = sourceCheck.entry.word0_location + header.lumpSize - header.cc;
            count = header.cc;
        }
        if (index >= count || !Number.isInteger(base) || base < 0 ||
                base + count > sim.memory.length || base + index > 0xffffffff)
            fail('NO_CAPABILITY', 'IDX1 LOAD index exceeds authorized C-list');
        requireCheck(sim.mLoad(source.word0, permission, packet.b, base + index,
            { base, upperBound: base + count - 1 }));
        const selected = sim.memory[base + index] >>> 0;
        const selectedCheck = requireCheck(sim.mLoad(selected, null));
        if (selectedCheck.parsed.type !== 1)
            fail('UNSUPPORTED_PROFILE', 'IDX1 lazy/Abstract capability resolution is not available');
        const homeBase = sim._activeThreadBase();
        if (packet.a <= 11 && packet.a !== 6 && homeBase !== null) {
            const layout = sim._threadLayoutAtBase(homeBase);
            if (!layout || !layout.valid) fail('BOUNDS', 'Invalid destination Thread geometry');
            const home = homeBase + layout.capsStart + packet.a;
            requireCheck(sim.mLoad(sim.cr[12].word0, null, 12, home));
            accepted.memory.requireWritable(home, home + 1);
        }
        if (!sim._writeCR(packet.a, selected, selectedCheck.entry)) return null;
        sim.pc += length;
        return { ...result, desc: `IDX1 LOAD CR${packet.a}, CR${packet.b}, runtime index` };
    }
    const handles = opcode => supportedPackets.has(opcode) || opcode === 10;
    const isInstalled = (sim, slot) => {
        const identity = sim.getSlotIdentity(slot);
        const accepted = identity && bindings.get(identity);
        return !!accepted && accepted.memory.memory === sim.memory;
    };
    const api = Object.freeze({ install, entry, binding, resolveSelector, execute, handles, isInstalled, requireSupported, preflightDRWrite, preflightMemoryWrite });
    if (node) module.exports = api;
    else root.ChurchIDX1Runtime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
'use strict';

// Local trusted-compiler route only. Uploaded envelopes are never vouched for
// merely because they parse or hash correctly.
(function expose(root) {
    const node = typeof module !== 'undefined' && module.exports;
    const Assembler = node ? require('./assembler.js') : root.ChurchAssembler;
    const Envelope = node ? require('./idx1-execution-envelope.js') : root.ChurchIDX1Envelope;
    const Runtime = node ? require('./idx1-runtime.js') : root.ChurchIDX1Runtime;
    const SAVE_MESSAGE = 'IDX1 is currently simulator-only. Save, deployment export, Prepare Boot and hardware delivery are unavailable until those routes preserve the whole execution envelope. Your source remains in the editor.';
    function freezeLayout(layout) {
        const freeze = value => {
            if (value && typeof value === 'object') {
                Object.values(value).forEach(freeze);
                Object.freeze(value);
            }
            return value;
        };
        return freeze(JSON.parse(JSON.stringify(layout)));
    }
    function requiresProfile(source) {
        return source.split('\n').some(raw => {
            const line = raw.replace(/;.*$|\/\/.*$|--.*$/g, '').trim();
            const match = /^(LOAD|SAVE|SWITCH|CHANGE|DREAD|DWRITE|BFEXT|BFINS|BRANCH|CALL)(?:EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|NV)?\b\s*(.*)$/i.exec(line);
            if (!match) return false;
            const op = match[1].toUpperCase(), args = match[2].split(',').map(a => a.trim());
            if (op === 'BRANCH') return args.some(arg => /^DR\d+\b/i.test(arg));
            if (op === 'CALL') return /\[\s*DR\d+\b/i.test(args[0]) ||
                /^(?:selector\s*\(\s*)?DR\d+\b/i.test(args[1] || '');
            return /^DR\d+\b/i.test(args[2] || '') &&
                (!(op === 'DREAD' || op === 'DWRITE') || args.length === 3);
        });
    }
    function compile(assembler, source) {
        if (/^\s*constants\s*\{/im.test(source))
            return { words: [], errors: [{ line: 0, message:
                'IDX1 constants blocks are not yet supported; use explicit WORD data and typed layout.' }] };
        const result = assembler.assemble(source, {
            profile: 'IDX1', sourceLayout: { fastEntry: 1, dispatch: [] },
        });
        if (!result.errors.length) {
            try { Runtime.requireSupported(result.words, result.layout.instructionStarts.map(w => w - 1)); }
            catch (error) { result.errors.push({ line: 0, message: error.message }); }
        }
        return result;
    }
    async function admitLocalCandidate(sim, Simulator, candidate, slot) {
        if (!candidate || candidate.isaProfile !== 'IDX1' || typeof candidate.source !== 'string')
            throw new Error('Missing IDX1 local compiler evidence');
        const assembled = compile(new Assembler(), candidate.source);
        if (assembled.errors.length || JSON.stringify(assembled.words) !== JSON.stringify(candidate.words) ||
                JSON.stringify(assembled.layout) !== JSON.stringify(candidate.executionLayout))
            throw new Error('IDX1 candidate differs from fresh trusted compiler output');
        const entry = sim.readNSEntry(slot), base = entry && entry.word0_location;
        const header = entry && sim.parseLumpHeader(sim.memory[base]);
        if (!header || !header.valid || header.cw !== candidate.words.length ||
                candidate.words.some((word, i) => sim.memory[base + 1 + i] !== word))
            throw new Error('Installed IDX1 code differs from trusted compiler output');
        const payload = new Uint8Array(header.lumpSize * 4), view = new DataView(payload.buffer);
        for (let i = 0; i < header.lumpSize; i++) view.setUint32(i * 4, sim.memory[base + i]);
        const envelope = await Envelope.frame(payload, assembled.layout);
        sim.registerSlotIdentity(slot, {
            dotName: candidate.abstraction || 'LocalIDX1', issueN: 1,
            identityHash: envelope.executionDigest, binaryHash: envelope.metadata.payloadSha256,
            executionDigest: envelope.executionDigest, authorized: true,
            gtSeq: sim.parseNSWord1(entry.word1_limit).gtSeq,
        });
        await Simulator.admitIDX1Execution(sim, envelope.bytes, slot);
        sim.pc = assembled.layout.fastEntry - 1;
        return envelope;
    }
    const api = Object.freeze({ requiresProfile, compile, admitLocalCandidate, freezeLayout, SAVE_MESSAGE });
    if (node) module.exports = api;
    else root.ChurchIDX1IDE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
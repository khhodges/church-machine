'use strict';

// Local trusted-compiler route only. Uploaded envelopes are never vouched for
// merely because they parse or hash correctly.
(function expose(root) {
    const node = typeof module !== 'undefined' && module.exports;
    // assembler.js is a classic script with a top-level class declaration:
    // the constructor lives in the global lexical environment, not window.
    const Assembler = node ? require('./assembler.js') :
        (typeof ChurchAssembler !== 'undefined' ? ChurchAssembler : root.ChurchAssembler);
    const Envelope = node ? require('./idx1-execution-envelope.js') : root.ChurchIDX1Envelope;
    const Runtime = node ? require('./idx1-runtime.js') : root.ChurchIDX1Runtime;
    const SAVE_MESSAGE = 'IDX1 supports Save LUMP and protected simulator reload. Deployment export, Prepare Boot and hardware delivery remain unavailable; they do not support this execution profile.';
    function saveView(candidate) {
        if (!candidate || candidate.isaProfile !== 'IDX1') return null;
        return { abstraction: candidate.abstraction, sources: {
            memory: { words: Array.from(candidate.words), capabilities: Array.from(candidate.capabilities),
                sourceText: candidate.source, registeredAt: candidate.createdAt },
            server: { language: candidate.language },
        } };
    }
    async function savedFields(words, layout) {
        const bytes = new Uint8Array(words.length * 4), view = new DataView(bytes.buffer);
        words.forEach((word, i) => view.setUint32(i * 4, word >>> 0));
        const envelope = await Envelope.frame(bytes, layout);
        const base64 = node ? Buffer.from(envelope.bytes).toString('base64') :
            btoa(Array.from(envelope.bytes, byte => String.fromCharCode(byte)).join(''));
        return { isa_profile: 'IDX1', execution_envelope: base64,
            execution_digest: envelope.executionDigest };
    }
    async function nameSavedCandidate(words, name, source) {
        const frame = node ? require('./lump-content-frame.js') : root.LumpContentFrame;
        const inspected = await frame.lumpInspectContentFrame(words);
        if (!inspected.contentFrameValid || !inspected.apiDefinition ||
                !['full', 'compact'].includes(inspected.profile))
            throw new Error('IDX1 Save requires an intact source-bearing content frame');
        if (inspected.apiDefinition.name === name) return words.slice();
        const built = await frame.lumpBuildContentFrame(
            { ...inspected.apiDefinition, name }, source, { profile: inspected.profile });
        const cw = (words[0] >>> 10) & 8191, cc = words[0] & 255;
        let size = 64;
        while (size < 1 + cw + built.frameWords.length + cc) size *= 2;
        if (size > 2 ** 21) throw new Error('Renamed IDX1 content exceeds LUMP geometry');
        const result = new Array(size).fill(0);
        result[0] = ((words[0] & ~0x07800000) | ((Math.log2(size) - 6) << 23)) >>> 0;
        result.splice(1, cw, ...words.slice(1, cw + 1));
        result.splice(cw + 1, built.frameWords.length, ...built.frameWords);
        if (cc) result.splice(size - cc, cc, ...words.slice(words.length - cc));
        return result;
    }
    async function validateSaved(words, metadata) {
        const marked = metadata && (metadata.isa_profile === 'IDX1' ||
            metadata.compiler_record?.isa_profile === 'IDX1' ||
            metadata.execution_envelope || metadata.execution_digest);
        // A missing sidecar must never reinterpret the reserved IDX1 prefix as
        // legacy code. Limit this scan to code; c-list and content are data.
        const cw = (words[0] >>> 10) & 8191;
        const executable = words[0] >>> 27 === 31 && ((words[0] >>> 8) & 3) === 0;
        const prefixed = executable && words.slice(1, cw + 1).some(word => word >>> 27 === 10);
        if (!marked) {
            if (prefixed) throw new Error('IDX1 executable metadata is missing');
            return null;
        }
        if (metadata.isa_profile !== 'IDX1' || !metadata.execution_envelope ||
                !metadata.execution_digest || !metadata.compiler_record)
            throw new Error('Incomplete IDX1 saved execution metadata');
        const bytes = node ? Buffer.from(metadata.execution_envelope, 'base64') :
            Uint8Array.from(atob(metadata.execution_envelope), c => c.charCodeAt(0));
        const envelope = await Envelope.parse(bytes);
        if (metadata.compiler_record.isa_profile !== 'IDX1' ||
                metadata.compiler_record.execution_digest !== envelope.executionDigest ||
                metadata.compiler_record.binary_hash !== envelope.metadata.payloadSha256)
            throw new Error('IDX1 compiler attestation does not bind the saved envelope');
        if (envelope.executionDigest !== metadata.execution_digest ||
                envelope.words.length !== words.length ||
                envelope.words.some((word, i) => word !== (words[i] >>> 0)))
            throw new Error('IDX1 saved envelope does not bind exact saved bytes');
        const source = metadata.source;
        if (typeof source !== 'string') throw new Error('IDX1 saved compiler source is missing');
        const compiled = compile(new Assembler(), source);
        if (compiled.errors.length || compiled.words.length !== cw ||
                compiled.words.some((word, i) => word !== (words[i + 1] >>> 0)) ||
                !sameLayout(compiled.layout, envelope.metadata.layout))
            throw new Error('IDX1 saved layout/code differs from trusted compiler source');
        return { isaProfile: 'IDX1', source, words: compiled.words,
            executionLayout: compiled.layout, executionDigest: envelope.executionDigest,
            abstraction: metadata.abstraction || 'SavedIDX1' };
    }
    async function applySavedPlan(metadata, plan) {
        if (metadata.isa_profile !== 'IDX1') return;
        const finalized = {
            isa_profile: plan.isa_profile, execution_envelope: plan.execution_envelope,
            execution_digest: plan.execution_digest, compiler_record: plan.compiler_record,
            source: metadata.original_source ?? metadata.source,
        };
        await validateSaved(plan.final_binary, finalized);
        for (const key of ['isa_profile', 'execution_envelope', 'execution_digest'])
            metadata[key] = finalized[key];
    }
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
    function sameLayout(a, b) {
        const canonical = value => Array.isArray(value) ? value.map(canonical) :
            value && typeof value === 'object' ? Object.fromEntries(
                Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
        return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    }
    function requiresProfile(source) {
        return source.split('\n').some(raw => {
            const line = raw.replace(/;.*$|\/\/.*$|--.*$/g, '').trim();
            const match = /^(LOAD|SAVE|SWITCH|CHANGE|DREAD|DWRITE|BFEXT|BFINS|BRANCH|CALL)(?:EQ|NE|CS|CC|MI|PL|VS|VC|HI|LS|GE|LT|GT|LE|NV)?\b\s*(.*)$/i.exec(line);
            if (!match) return false;
            const op = match[1].toUpperCase(), args = match[2].split(',').map(a => a.trim());
            if (op === 'LOAD' || op === 'SAVE') return false;
            if (op === 'BRANCH') return args.some(arg => /^DR\d+\b/i.test(arg));
            if (op === 'CALL') return /\[\s*DR\d+\b/i.test(args[0]) ||
                /^(?:selector\s*\(\s*)?DR\d+\b/i.test(args[1] || '');
            return /^DR\d+\b/i.test(args[2] || '') &&
                (!(op === 'DREAD' || op === 'DWRITE') || args.length === 3);
        });
    }
    function compile(assembler, source) {
        const declaration = source.match(/^\s*;\s*(?:Abstraction:|@abstraction)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*$/im);
        if (!declaration) return {words: [], abstractionName: '', errors: [
            {line: 0, message: 'No abstraction declaration found. Add: ; @abstraction YourName and recompile.'},
        ]};
        if (/^\s*constants\s*\{/im.test(source))
            return { words: [], errors: [{ line: 0, message:
                'IDX1 constants blocks are not yet supported; use explicit WORD data and typed layout.' }] };
        const result = assembler.assemble(source, {
            profile: 'IDX1', sourceLayout: { fastEntry: 1, dispatch: [] },
        });
        result.abstractionName = declaration[1];
        if (!result.errors.length) {
            try { Runtime.requireSupported(result.words, result.layout.instructionStarts.map(w => w - 1)); }
            catch (error) { result.errors.push({ line: 0, message: error.message }); }
        }
        return result;
    }
    async function admitLocalCandidate(sim, Simulator, candidate, slot) {
        if (typeof candidate.abstraction !== 'string' || !candidate.abstraction.trim())
            throw new Error('IDX1 candidate has no declared abstraction name; correct the source and recompile.');
        if (!candidate || candidate.isaProfile !== 'IDX1' || typeof candidate.source !== 'string')
            throw new Error('Missing IDX1 local compiler evidence');
        const assembled = compile(new Assembler(), candidate.source);
        if (assembled.errors.length || JSON.stringify(assembled.words) !== JSON.stringify(candidate.words) ||
                !sameLayout(assembled.layout, candidate.executionLayout))
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
            dotName: candidate.abstraction, issueN: 1,
            identityHash: envelope.executionDigest, binaryHash: envelope.metadata.payloadSha256,
            executionDigest: envelope.executionDigest, authorized: true,
            gtSeq: sim.parseNSWord1(entry.word1_limit).gtSeq,
        });
        await Simulator.admitIDX1Execution(sim, envelope.bytes, slot);
        sim.pc = assembled.layout.fastEntry - 1;
        return envelope;
    }
    const api = Object.freeze({ requiresProfile, compile, admitLocalCandidate, freezeLayout,
        saveView, savedFields, nameSavedCandidate, validateSaved, applySavedPlan, SAVE_MESSAGE });
    if (node) module.exports = api;
    else root.ChurchIDX1IDE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
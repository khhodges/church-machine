'use strict';

// Software demonstration ABI only: this does not change Thread geometry or ISA.
(function(root) {
    const schema = Object.freeze({
        name: 'church.thread.call-record', version: 1, words: 58, magic: 137,
        states: ['new', 'routing', 'connected', 'ended'],
        fields: [
            {name: 'callState', offset: 4, type: 'enum', description: 'new, routing, connected, ended'},
            {name: 'conditions', offset: 5, type: 'uint32', description: 'Application-defined condition bits; not authority'},
            {name: 'callerName', offset: 6, capacity: 64, type: 'utf8', description: 'Caller display name'},
            {name: 'telephoneNumber', offset: 23, capacity: 32, type: 'utf8', description: 'Text, retaining + and leading zeros'},
            {name: 'routingSelection', offset: 32, capacity: 32, type: 'utf8', description: 'Selected route identifier'},
            {name: 'endpoint', offset: 41, capacity: 64, type: 'utf8', description: 'Endpoint identifier, never a GT'},
        ],
    });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const names = schema.fields.map(f => f.name);
    // Ephemeral software ownership, never serialized into a Thread or LUMP.
    const owners = new WeakMap();
    const observed = new WeakSet();
    let nextId = 1;
    function ownership(sim, target) {
        if (!observed.has(sim) && typeof sim.on === 'function') {
            observed.add(sim);
            sim.on('threadReset', ({slot}) => {
                const state = owners.get(sim);
                if (state) for (const [base, thread] of state.threads)
                    if (thread.slot === slot) state.threads.delete(base);
            });
            sim.on('programLoaded', ({addr, length}) => {
                const state = owners.get(sim);
                if (state) for (const [base, thread] of state.threads)
                    if (addr < thread.end && addr + length > base) state.threads.delete(base);
            });
        }
        let state = owners.get(sim);
        const generation = sim._controlFlowDiagnosticResetGeneration;
        if (!state || state.memory !== sim.memory || state.generation !== generation) {
            state = {memory: sim.memory, generation, threads: new Map()};
            owners.set(sim, state);
        }
        const gt = sim.parseGT(sim.cr[12].word0);
        const key = [gt.index, gt.gt_seq, target.threadBase, sim.cr[5].word1,
            sim.cr[5].word2, sim.memory[target.threadBase]].join(':');
        const previous = state.threads.get(target.threadBase);
        if (!previous || previous.key !== key)
            state.threads.set(target.threadBase, {key, slot: gt.index,
                end: sim.cr[5].word1 + target.heapWords, pool: null, records: new Map()});
        return state.threads.get(target.threadBase);
    }
    function object(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Expected a JSON object.');
        return value;
    }
    function uint(value, name) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
            throw new Error(name + ' must be an unsigned 32-bit integer.');
        return value;
    }
    function sample() {
        return {schema: schema.name, version: 1, callerName: 'Example Caller',
            telephoneNumber: '+12025550123', routingSelection: 'local',
            endpoint: '', conditions: 0, callState: 'new'};
    }
    function encode(input, revision = 1) {
        object(input);
        for (const key of Object.keys(input))
            if (![...names, 'schema', 'version', 'revision'].includes(key))
                throw new Error('Unknown field: ' + key + '. No capability or extra fields are imported.');
        if (input.schema !== schema.name || input.version !== 1)
            throw new Error('Expected schema ' + schema.name + ', version 1.');
        if (input.revision !== undefined) uint(input.revision, 'revision');
        const words = new Uint32Array(schema.words);
        words.set([schema.magic, 1, schema.words, uint(revision, 'revision')]);
        for (const field of schema.fields) {
            const value = input[field.name];
            if (field.type === 'uint32') words[field.offset] = uint(value, field.name);
            else if (field.type === 'enum') {
                const state = schema.states.indexOf(value);
                if (state < 0) throw new Error('callState must be new, routing, connected, or ended.');
                words[field.offset] = state;
            } else {
                if (typeof value !== 'string') throw new Error(field.name + ' must be a string.');
                const bytes = encoder.encode(value);
                if (decoder.decode(bytes) !== value) throw new Error(field.name + ' contains invalid Unicode.');
                if (bytes.length > field.capacity)
                    throw new Error(field.name + ' exceeds ' + field.capacity + ' UTF-8 bytes.');
                words[field.offset] = bytes.length;
                bytes.forEach((byte, i) => {
                    words[field.offset + 1 + (i >>> 2)] |= byte << (24 - (i % 4) * 8);
                });
            }
        }
        return words;
    }
    function decode(words) {
        if (words.length !== schema.words || words[0] !== schema.magic ||
                words[1] !== 1 || words[2] !== schema.words)
            throw new Error('No valid version-1 call record at this offset. Nothing was changed.');
        const result = {schema: schema.name, version: 1, revision: words[3]};
        for (const f of schema.fields) {
            if (f.type === 'uint32') result[f.name] = words[f.offset] >>> 0;
            else if (f.type === 'enum') {
                if (words[f.offset] >= schema.states.length) throw new Error('Invalid call state in heap.');
                result[f.name] = schema.states[words[f.offset]];
            } else {
                const length = words[f.offset];
                if (length > f.capacity) throw new Error('Invalid ' + f.name + ' length in heap.');
                const bytes = new Uint8Array(f.capacity);
                for (let i = 0; i < bytes.length; i++)
                    bytes[i] = (words[f.offset + 1 + (i >>> 2)] >>> (24 - (i % 4) * 8)) & 255;
                if (bytes.subarray(length).some(b => b !== 0))
                    throw new Error('Nonzero padding in ' + f.name + '; refusing an ambiguous record.');
                result[f.name] = decoder.decode(bytes.subarray(0, length));
            }
        }
        return result;
    }
    function validateTarget(sim, offset) {
        if (!sim || sim.running || sim.walkActive) throw new Error('Pause the software simulator first.');
        if (!Number.isInteger(offset) || offset < 0) throw new Error('Heap offset must be a nonnegative integer.');
        const threadBase = sim._activeThreadBase();
        const layout = sim._threadLayoutAtBase(threadBase);
        const heap = sim.cr[5];
        if (!layout || !heap || !heap.word0 ||
                heap.word1 !== threadBase + layout.heapStart || heap.word2 !== layout.heapWords - 1)
            throw new Error('No active Thread with its canonical CR5 heap. Prepare/enter a Thread first.');
        if (offset + schema.words > layout.heapWords)
            throw new Error('The complete 58-word record must fit within the Thread heap.');
        const address = heap.word1 + offset;
        if (address + schema.words > sim.memory.length) throw new Error('Heap exceeds simulator memory.');
        const target = {threadBase, address, offset, words: schema.words, heapWords: layout.heapWords};
        preflight(sim, target, 'R');
        const allocation = ownership(sim, target).records.get(offset);
        target.allocationId = allocation ? allocation.id : null;
        target.recognized = !!allocation &&
            sim.memory.slice(address, address + schema.words).some(w => w !== 0);
        return target;
    }
    function ownedTarget(sim, offset) {
        const target = validateTarget(sim, offset);
        if (!target.allocationId)
            throw new Error('No allocation at this offset. Reserve a pool and allocate a record first. Nothing changed.');
        return target;
    }
    function allocations(sim) {
        const target = validateTarget(sim, 0);
        const state = ownership(sim, target);
        return {pool: state.pool && {...state.pool},
            records: Array.from(state.records.values(), r => ({...r})).sort((a,b) => a.offset-b.offset)};
    }
    function reservePool(sim, offset, words) {
        const target = validateTarget(sim, offset);
        const state = ownership(sim, target);
        if (state.pool) throw new Error('A pool is already reserved for this Thread; it cannot be moved during this lifetime.');
        if (!Number.isInteger(words) || words < schema.words || offset + words > target.heapWords)
            throw new Error('Pool must contain at least 58 words and fit in the Thread heap.');
        // Reservation is explicit programmer ownership, not inferred from zeros.
        preflight(sim, {...target, words}, 'W');
        state.pool = {offset, words, id: nextId++};
        return allocations(sim);
    }
    function allocate(sim, offset) {
        const base = validateTarget(sim, 0);
        const state = ownership(sim, base), pool = state.pool;
        if (!pool) throw new Error('Reserve an exclusive demo pool first. Zero words are not proof of ownership.');
        const free = off => !Array.from(state.records.values()).some(r =>
            off < r.offset + schema.words && off + schema.words > r.offset);
        if (offset === undefined) {
            for (let off = pool.offset; off + schema.words <= pool.offset + pool.words; off += schema.words) {
                if (free(off)) {
                    const t = validateTarget(sim, off);
                    if (!sim.memory.slice(t.address, t.address + schema.words).some(w => w !== 0)) {
                        offset = off; break;
                    }
                }
            }
            if (offset === undefined) throw new Error('Pool exhausted or blocked by nonzero data. Release a record or choose a free offset; nothing changed.');
        }
        const target = validateTarget(sim, offset);
        if (offset < pool.offset || offset + schema.words > pool.offset + pool.words)
            throw new Error('Allocation must fit inside the reserved pool.');
        if (!free(offset)) throw new Error('Allocation collision: this range overlaps an owned record.');
        if (sim.memory.slice(target.address, target.address + schema.words).some(w => w !== 0))
            throw new Error('Allocation blocked by nonzero data; nothing changed.');
        preflight(sim, target, 'W');
        const record = {id: nextId++, offset, words: schema.words};
        state.records.set(offset, record);
        return {...record};
    }
    function release(sim, offset) {
        const target = ownedTarget(sim, offset);
        preflight(sim, target, 'W');
        sim.memory.fill(0, target.address, target.address + schema.words);
        ownership(sim, target).records.delete(offset);
    }
    function preflight(sim, target, permission) {
        if (!sim.parseGT(sim.cr[5].word0).permissions[permission])
            throw new Error('Heap ' + permission + ' access denied: CR5 lacks permission.');
        for (let i = 0; i < target.words; i++) {
            const check = sim.mLoad(sim.cr[5].word0, permission, 5, target.address + i,
                {base: sim.cr[5].word1, upperBound: sim.cr[5].word1 + sim.cr[5].word2}, true);
            if (!check.ok) throw new Error('Heap ' + permission + ' access denied: ' + check.message);
        }
    }
    function read(sim, offset) {
        const target = ownedTarget(sim, offset);
        preflight(sim, target, 'R');
        return decode(Array.from(sim.memory.slice(target.address, target.address + schema.words)));
    }
    function commit(sim, target, words) {
        // No await or callbacks between final preflight and publication. All
        // validation completes before the first write.
        preflight(sim, target, 'W');
        for (let i = 0; i < words.length; i++) sim.memory[target.address + i] = words[i];
        return decode(words);
    }
    function importRecord(sim, offset, input, options = {}) {
        const target = ownedTarget(sim, offset);
        const staged = encode(input);
        preflight(sim, target, 'R');
        const oldWords = Array.from(sim.memory.slice(target.address, target.address + schema.words));
        if (oldWords.some(w => w !== 0)) {
            const old = decode(oldWords); // unknown nonzero data is never overwritten
            if (!options.replace) throw new Error('A call record already exists. Explicit replacement approval is required.');
            staged[3] = (old.revision + 1) >>> 0;
        }
        return commit(sim, target, staged);
    }
    function updateRecord(sim, offset, patch) {
        object(patch);
        const keys = Object.keys(patch);
        if (!keys.length) throw new Error('Supply at least one field to update.');
        for (const key of keys) if (!names.includes(key))
            throw new Error('Only record fields may be updated; invalid field: ' + key);
        const old = read(sim, offset);
        const staged = encode({...old, ...patch}, (old.revision + 1) >>> 0);
        return commit(sim, ownedTarget(sim, offset), staged);
    }
    function source(offset = 0) {
        if (!Number.isInteger(offset) || offset < 0 || offset + schema.words > 1024)
            throw new Error('Demo source requires an offset in 0–966 (indexed ISA address range).');
        const methods = [];
        const method = (name, lines) => methods.push('method ' + name + '() {\n    ' + lines.join('\n    ') + '\n}');
        const revision = ['DREAD DR2, CR5, #' + (offset + 3),
            'IADD DR2, DR2, #1', 'DWRITE DR2, CR5, #' + (offset + 3)];
        // Allocate this region before Initialize; it is never called by the IDE.
        const init = ['IADD DR1, DR0, #0'];
        for (let i = 0; i < schema.words; i++) init.push('DWRITE DR1, CR5, #' + (offset + i));
        for (const [i, value] of [schema.magic, 1, schema.words, 1].entries())
            init.push('IADD DR1, DR0, #' + value, 'DWRITE DR1, CR5, #' + (offset + i));
        method('Initialize', [...init, 'RETURN']);
        method('ReadState', ['DREAD DR1, CR5, #' + (offset + 4), 'RETURN']);
        ['MarkRouting', 'Connect', 'End'].forEach((name, i) =>
            method(name, ['IADD DR1, DR0, #' + (i + 1), 'DWRITE DR1, CR5, #' + (offset + 4), ...revision, 'RETURN']));
        method('ReadConditions', ['DREAD DR1, CR5, #' + (offset + 5), 'RETURN']);
        method('UpdateConditions', ['DWRITE DR1, CR5, #' + (offset + 5), ...revision, 'RETURN']);
        for (const field of schema.fields.filter(f => f.type === 'utf8')) {
            const title = field.name[0].toUpperCase() + field.name.slice(1);
            method('Read' + title + 'Length', ['DREAD DR1, CR5, #' + (offset + field.offset), 'RETURN']);
            // Explicit word getters avoid unchecked dynamic indexes escaping the field.
            for (let i = 0; i < field.capacity / 4; i++)
                method('Read' + title + 'Word' + i, [
                    'DREAD DR1, CR5, #' + (offset + field.offset + 1 + i), 'RETURN']);
        }
        return '; Thread heap CallRecord v1 — demonstration ABI, not an ISA extension.\n' +
            '; Allocate heap words ' + offset + '..' + (offset + schema.words - 1) + ' exclusively before Initialize/import.\n' +
            '; These fixed-offset methods do not check software allocation ownership. Stop using them before release.\n' +
            '; Initialize clears the record. Do not call it after importing your data.\n' +
            '; CR5 is the existing Thread heap; no additional GT is required.\n' +
            '; Methods share the active Thread, not private per-abstraction storage.\n' +
            '; DR1 is the result / UpdateConditions input. Updates clobber DR2.\n' +
            '; Strings: byte length then big-endian packed UTF-8, zero padded.\n' +
            '; JSON/text updates are IDE operations; numeric state/conditions updates are callable.\n' +
            'abstraction ide.CallRecord {\ncapabilities { SELF E }\n' + methods.join('\n\n') + '\n}\n';
    }
    const api = {schema, sample, encode, decode, validateTarget, reservePool, allocate, release, allocations, read, importRecord, updateRecord,
        exportJson: (sim, offset) => JSON.stringify(read(sim, offset), null, 2), source};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ThreadHeapRecord = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

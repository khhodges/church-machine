'use strict';
// Browser/Node guard for church.symbolic-lump-binding/v1 canonical bytes.
// Validates only what the integrity-covered words themselves state: the
// embedded symbolic_binding, the canonical C-list (SELF 0xFEED5E1F, external
// rows 0) and every recorded CALL site holding its conditional INVALID_OP
// placeholder. It never resolves, binds, or accepts a client sidecar as
// authority; a supplied plan contract must equal the embedded one exactly.
(function(root) {
    const SCHEMA = 'church.symbolic-lump-binding/v1';
    const SELF_MARKER = 0xFEED5E1F;
    // Existing WORD opcode (0x1E) with zero operand; condition bits preserved.
    const placeholder = condition => (((0x1E << 27) | ((condition & 15) << 23)) >>> 0);
    const isPlaceholder = word => ((word >>> 27) === 0x1E) && ((word & 0x7FFFFF) === 0);
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
        }
        return value;
    }
    const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    function decodeApi(words) {
        const frame = root.LumpContentFrame ||
            (typeof require === 'function' ? require('./lump-content-frame.js') : null);
        return frame && typeof frame.lumpDecodeContentFrameApi === 'function'
            ? frame.lumpDecodeContentFrameApi(words) : null;
    }
    function embedded(words) {
        const api = decodeApi(words);
        return api && api.symbolic_binding ? api.symbolic_binding : null;
    }
    // Returns {symbolic:false} for non-symbolic artifacts, else throws on any
    // violation and returns {symbolic:true, contract}.
    function validate(words, options) {
        const opts = options || {};
        const binary = Array.from(words || [], w => Number(w) >>> 0);
        if (!binary.length) throw new Error('Symbolic LUMP has no words');
        const contract = embedded(binary);
        if (!contract) {
            if (opts.planContract) throw new Error('Save plan claims a symbolic contract absent from the exact bytes');
            return { symbolic: false };
        }
        if (opts.planContract && !same(opts.planContract, contract))
            throw new Error('Save plan symbolic contract differs from the integrity-covered bytes');
        const header = binary[0];
        const cw = (header >>> 10) & 0x1FFF, cc = header & 0xFF;
        const size = 64 << ((header >>> 23) & 15);
        if (contract.schema !== SCHEMA || size !== binary.length || cc < 1 ||
                !Array.isArray(contract.dependencies) || contract.dependencies.length !== cc ||
                !Array.isArray(contract.calls))
            throw new Error('Symbolic LUMP contract geometry is invalid');
        const start = size - cc;
        if (binary[start] !== SELF_MARKER)
            throw new Error('Symbolic LUMP SELF row 0 must be canonical 0xFEED5E1F');
        for (let row = 1; row < cc; row++) {
            if (binary[start + row] !== 0)
                throw new Error(`Symbolic LUMP row ${row} contains a destination-local word`);
        }
        const caps = Array.isArray(opts.capabilities) ? opts.capabilities : null;
        contract.dependencies.forEach((dep, row) => {
            if (!dep || dep.relocation_row !== row || dep.symbolic_self !== (row === 0))
                throw new Error(`Symbolic dependency row ${row} is invalid`);
            if (caps && row > 0 && caps[row]) {
                const declared = String(caps[row].canonical_leaf || caps[row].name || '');
                const rights = v => [...new Set(Array.isArray(v) ? v : [])].sort().join('');
                if (declared.toUpperCase() !== String(dep.name).toUpperCase() ||
                        rights(caps[row].rights) !== rights(dep.rights))
                    throw new Error(`Symbolic dependency row ${row} disagrees with the declared C-list`);
            }
        });
        const seen = new Set();
        for (const call of contract.calls) {
            if (!call || !Number.isInteger(call.word_offset) || call.word_offset < 1 ||
                    call.word_offset > cw || seen.has(call.word_offset) ||
                    !Number.isInteger(call.row) || call.row < 1 || call.row >= cc ||
                    !Number.isInteger(call.condition) || call.condition < 0 || call.condition > 15)
                throw new Error('Symbolic CALL site metadata is invalid');
            seen.add(call.word_offset);
            if (binary[call.word_offset] !== placeholder(call.condition))
                throw new Error(`Symbolic CALL ${call.full_name} at word ${call.word_offset} is not its unresolved placeholder`);
        }
        return { symbolic: true, contract: JSON.parse(JSON.stringify(contract)) };
    }
    const api = { SCHEMA, SELF_MARKER, placeholder, isPlaceholder, embedded, validate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SymbolicLumpGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

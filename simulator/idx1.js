'use strict';

// Pure IDX1 packet codec and arithmetic. This module does not authenticate code,
// read capabilities, or perform authority/containment transactions.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ChurchIDX1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const MAX_MAGNITUDE = 0xFFFFF;
    const MAX_WORD = 0xFFFFFFFF;

    function fault(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }

    function integer(value, min, max, name, code = 'STRUCTURE') {
        if (!Number.isSafeInteger(value) || value < min || value > max)
            fault(code, `${name} must be an integer in ${min}..${max}`);
        return value;
    }

    function descriptor(value) {
        if (!value || typeof value !== 'object') fault('STRUCTURE', 'Missing IDX1 descriptor');
        const register = integer(value.register, 0, 15, 'DR number');
        const magnitude = integer(value.magnitude, 0, MAX_MAGNITUDE, 'magnitude');
        if (typeof value.subtract !== 'boolean') fault('STRUCTURE', 'subtract must be boolean');
        if (value.subtract && magnitude === 0) fault('STRUCTURE', 'Subtract-zero descriptor is noncanonical');
        return { register, magnitude, subtract: value.subtract };
    }

    function magnitude(text) {
        const token = text.trim().replace(/^#\s*/, '');
        if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.test(token))
            fault('STRUCTURE', `Invalid IDX1 magnitude: ${text}`);
        const value = Number(token);
        return integer(value, 0, MAX_MAGNITUDE, 'magnitude');
    }

    function parseExpression(source) {
        if (typeof source !== 'string') fault('STRUCTURE', 'Index expression must be text');
        const text = source.trim();
        const match = /^DR(0|[1-9]|1[0-5])(?:\s*([+-])\s*(#?\s*(?:[0-9]+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)))?$/i.exec(text);
        if (match) {
            const amount = match[3] === undefined ? 0 : magnitude(match[3]);
            // Source DRn - 0 is explicitly canonicalized to DRn.
            return descriptor({ register: Number(match[1]), magnitude: amount,
                subtract: match[2] === '-' && amount !== 0 });
        }
        return descriptor({ register: 0, magnitude: magnitude(text), subtract: false });
    }

    // Bare numeric CALL method operands retain the legacy ordinal convention;
    // only explicit selector(number) or a DR expression is a runtime selector.
    function parseSelector(source) {
        if (typeof source !== 'string') fault('STRUCTURE', 'Method selector must be text');
        const wrapped = /^selector\s*\((.*)\)$/is.exec(source.trim());
        if (!wrapped && !/^DR/i.test(source.trim()))
            fault('STRUCTURE', 'Use selector(number) for a runtime method selector');
        return parseExpression(wrapped ? wrapped[1] : source);
    }

    function packDescriptor(value) {
        const d = descriptor(value);
        return ((Number(d.subtract) << 24) | (d.register << 20) | d.magnitude) >>> 0;
    }

    function unpackDescriptor(bits) {
        return descriptor({
            register: (bits >>> 20) & 15,
            magnitude: bits & MAX_MAGNITUDE,
            subtract: !!(bits & 0x1000000),
        });
    }

    // Return a mask for each role, after verifying the exhaustive opcode/mode table.
    function replacementMasks(w1, mask) {
        const op = w1 >>> 27, a = (w1 >>> 19) & 15;
        const b = (w1 >>> 15) & 15, imm = w1 & 0x7FFF;
        let allowed, r0 = 0, r1 = 0;
        switch (op) {
            case 0: case 1:
                allowed = 1; r0 = 0x7FFF; break;
            case 5:
                if (a < 12 || b > 11 || (a === 15 && b === 15))
                    fault('STRUCTURE', 'Invalid indexed SWITCH mode');
                allowed = 1; r0 = 0x7FFF; break;
            case 4:
                if (a < 12) fault('STRUCTURE', 'Invalid indexed CHANGE mode');
                allowed = 1; r0 = 0x7FFF; break;
            case 2:
                if (b === 0) {
                    allowed = 2; r1 = 0x7FFF;
                } else if (a === 0 && b === 6 && !(imm & 0x7000)) {
                    allowed = 3; r0 = 0x1F; r1 = 0xFE0;
                } else fault('STRUCTURE', 'Invalid indexed CALL mode');
                break;
            case 16: case 17:
                if (!(imm & 0x4000)) fault('STRUCTURE', 'Indexed data operation requires immediate mode');
                allowed = 1; r0 = 0x3FFF; break;
            case 23:
                if (a !== 0 || b !== 0) fault('STRUCTURE', 'Indexed BRANCH requires A=B=0');
                allowed = 1; r0 = 0x7FFF; break;
            case 18: case 19:
                if ((imm & 0x7C00) || !(imm & 31))
                    fault('STRUCTURE', 'Indexed bit field requires reserved bits zero and width 1..31');
                allowed = 1; r0 = 0x3E0; break;
            default:
                fault('STRUCTURE', `Opcode ${op} cannot be wrapped by IDX1`);
        }
        if (!mask || (mask & ~allowed))
            fault('STRUCTURE', `Invalid role mask ${mask} for opcode ${op}`);
        if (((mask & 1) && (w1 & r0)) || ((mask & 2) && (w1 & r1)))
            fault('STRUCTURE', 'Selected W1 replacement field must be zero');
        return [r0, r1];
    }

    function encodePacket({ w1, role0, role1 }) {
        integer(w1, 0, MAX_WORD, 'W1');
        const mask = (role0 === undefined ? 0 : 1) | (role1 === undefined ? 0 : 2);
        replacementMasks(w1, mask);
        const first = packDescriptor(mask & 1 ? role0 : role1);
        const words = [((10 << 27) | (mask << 25) | first) >>> 0, w1];
        if (mask === 3) words.push(packDescriptor(role1));
        return words;
    }

    function decodePacket(words) {
        if (!words || typeof words.length !== 'number' || words.length < 1)
            fault('FETCH', 'Missing IDX1 prefix');
        const w0 = integer(words[0], 0, MAX_WORD, 'W0');
        if ((w0 >>> 27) !== 10) fault('STRUCTURE', 'Not an IDX1 opcode10 prefix');
        const mask = (w0 >>> 25) & 3;
        if (!mask) fault('STRUCTURE', 'Zero IDX1 role mask');
        const length = mask === 3 ? 3 : 2;
        if (words.length < length) fault('FETCH', 'Truncated IDX1 packet');
        if (words.length !== length) fault('STRUCTURE', 'Extra words after IDX1 packet');
        const w1 = integer(words[1], 0, MAX_WORD, 'W1');
        replacementMasks(w1, mask);
        if (mask === 3 && (integer(words[2], 0, MAX_WORD, 'W2') & 0xFE000000))
            fault('STRUCTURE', 'Nonzero IDX1 W2 reserved bits');
        const first = unpackDescriptor(w0);
        const second = mask === 3 ? unpackDescriptor(words[2]) : undefined;
        return {
            words: Array.from(words), length, mask, w1,
            opcode: w1 >>> 27, condition: (w1 >>> 23) & 15,
            a: (w1 >>> 19) & 15, b: (w1 >>> 15) & 15, immediate: w1 & 0x7FFF,
            role0: mask & 1 ? first : undefined,
            role1: mask & 2 ? (second || first) : undefined,
        };
    }

    function readDR(registers, n) {
        if (n === 0) return 0; // DR0 never consults supplied register state.
        if (!registers || !(n in Object(registers)))
            fault('INDEX_ARITHMETIC', `Missing DR${n} snapshot`);
        return integer(registers[n], 0, MAX_WORD, `DR${n}`, 'INDEX_ARITHMETIC');
    }

    function evaluateDescriptor(value, registers, branch = false) {
        const d = descriptor(value);
        const raw = readDR(registers, d.register);
        const base = branch && raw >= 0x80000000 ? raw - 0x100000000 : raw;
        const result = base + (d.subtract ? -d.magnitude : d.magnitude);
        if (!branch && (result < 0 || result > MAX_WORD))
            fault('INDEX_ARITHMETIC', 'Unsigned IDX1 index underflow or overflow');
        return result; // safe exact integer (at most 2^32 + 2^20).
    }

    function conditionPasses(cond, flags) {
        if (cond === 14) return true;
        if (cond === 15) return false;
        if (!flags) fault('STRUCTURE', 'NZCV flags required for conditional packet');
        const { N, Z, C, V } = flags;
        if ([N, Z, C, V].some(v => typeof v !== 'boolean'))
            fault('STRUCTURE', 'NZCV flags must be boolean');
        return [Z, !Z, C, !C, N, !N, V, !V, C && !Z, !C || Z,
            N === V, N !== V, !Z && N === V, Z || N !== V][cond];
    }

    function advance(pc, length) {
        const next = integer(pc, 0, Number.MAX_SAFE_INTEGER, 'PC') + length;
        if (!Number.isSafeInteger(next))
            fault('CONTAINMENT', 'Packet continuation address overflow');
        return next;
    }

    // Pure preflight only: callers must authenticate the code envelope and
    // authorize source/target before exposing dependent bounds or transactions.
    // Options supply *already authorized* limits, never raw memory lengths.
    function evaluatePacket(words, registers, options = {}) {
        const packet = decodePacket(words); // Structural faults precede NV/false predicate.
        if (!conditionPasses(packet.condition, options.flags))
            return { packet, executed: false, nextPC: options.pc === undefined ? undefined :
                advance(options.pc, packet.length) };
        const values = {};
        if (packet.role0) values.role0 = evaluateDescriptor(packet.role0, registers, packet.opcode === 23);
        if (packet.role1) values.role1 = evaluateDescriptor(packet.role1, registers);
        if (packet.opcode === 18 || packet.opcode === 19) {
            if (values.role0 + (packet.immediate & 31) > 32)
                fault('CONTAINMENT', 'Bit field exceeds 32-bit DR');
        }
        const limits = options.limits || {};
        for (const role of ['role0', 'role1']) {
            if (values[role] !== undefined && limits[role] !== undefined &&
                    values[role] >= integer(limits[role], 0, MAX_WORD + 1, `${role} limit`))
                fault('CONTAINMENT', `${role} outside authorized extent`);
        }
        let target;
        if (packet.opcode === 23 && options.pc !== undefined) {
            const pc = integer(options.pc, 0, Number.MAX_SAFE_INTEGER, 'PC');
            target = pc + values.role0;
            if (!Number.isSafeInteger(target) ||
                    (options.codeStart !== undefined && target < options.codeStart) ||
                    (options.codeEnd !== undefined && target >= options.codeEnd) ||
                    (options.starts !== undefined && !options.starts.has(target)))
                fault('CONTAINMENT', 'Branch target is not an admitted instruction start');
        }
        return { packet, executed: true, values, target,
            nextPC: options.pc === undefined ? undefined :
                (packet.opcode === 23 ? target : advance(options.pc, packet.length)) };
    }

    return Object.freeze({ MAX_MAGNITUDE, parseExpression, parseSelector,
        encodePacket, decodePacket, evaluateDescriptor, evaluatePacket, conditionPasses });
});
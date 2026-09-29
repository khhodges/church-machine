'use strict';

// Browser/Node execution-envelope validation. Validation is deliberately not
// executable admission: a digest is integrity, not compiler provenance.
(function expose(root) {
    const codec = typeof module !== 'undefined' && module.exports
        ? require('./idx1.js') : root.ChurchIDX1;
    const MAGIC = [0x43, 0x4d, 0x49, 0x44, 0x58, 0x31, 0x0d, 0x0a];
    const FEATURES = ['idx1.boundaries.v1', 'idx1.compact20.v1', 'idx1.dispatch.v1'];
    const fail = message => { const e = new Error(message); e.code = 'IDX1_STRUCTURE'; throw e; };
    const uint = (value, name) => {
        if (!Number.isInteger(value) || Object.is(value, -0) || value < 0 || value > 0xffffffff)
            fail(`${name} must be uint32`);
        return value;
    };
    const fields = (value, keys, name) => {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
                Object.keys(value).length !== keys.length ||
                keys.some(key => !Object.prototype.hasOwnProperty.call(value, key)))
            fail(`${name} has missing or unknown fields`);
    };
    const freeze = value => {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    async function digest(bytes) {
        const crypto = typeof module !== 'undefined' && module.exports
            ? require('node:crypto').webcrypto : root.crypto;
        if (!crypto || !crypto.subtle) fail('SHA-256 is unavailable');
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // JSON.parse alone loses duplicate keys. Parse the small, closed metadata
    // language directly, rejecting duplicate keys, noninteger numbers, lone
    // surrogates, BOM and excessive nesting before schema validation.
    function strictJSON(text) {
        let at = 0;
        const ws = () => { while (/[ \t\r\n]/.test(text[at] || '\0')) at++; };
        function string() {
            const start = at++;
            while (at < text.length) {
                const ch = text[at++];
                if (ch === '\\') { at++; continue; }
                if (ch !== '"') continue;
                let value;
                try { value = JSON.parse(text.slice(start, at)); } catch (_) { fail('Invalid JSON string'); }
                for (let i = 0; i < value.length; i++) {
                    const unit = value.charCodeAt(i);
                    if (unit >= 0xd800 && unit <= 0xdbff) {
                        const low = value.charCodeAt(++i);
                        if (!(low >= 0xdc00 && low <= 0xdfff)) fail('Unpaired Unicode surrogate');
                    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail('Unpaired Unicode surrogate');
                }
                return value;
            }
            fail('Unterminated JSON string');
        }
        function value(depth) {
            if (depth > 32) fail('Metadata nesting limit exceeded');
            ws();
            if (text[at] === '"') return string();
            const open = text[at];
            if (open === '{' || open === '[') {
                at++;
                const object = open === '{', close = object ? '}' : ']';
                const result = object ? Object.create(null) : [];
                ws();
                if (text[at] === close) { at++; return result; }
                for (;;) {
                    let key;
                    if (object) {
                        ws();
                        if (text[at] !== '"') fail('Expected JSON object key');
                        key = string();
                        if (Object.prototype.hasOwnProperty.call(result, key)) fail('Duplicate JSON key');
                        ws();
                        if (text[at++] !== ':') fail('Expected JSON colon');
                    }
                    const item = value(depth + 1);
                    if (object) result[key] = item;
                    else result.push(item);
                    ws();
                    if (text[at] === close) { at++; return result; }
                    if (text[at++] !== ',') fail('Expected JSON separator');
                }
            }
            for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
                if (text.startsWith(literal, at)) { at += literal.length; return result; }
            }
            const match = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(at));
            if (!match) fail('Invalid JSON value');
            at += match[0].length;
            const number = Number(match[0]);
            if (!Number.isSafeInteger(number) || Object.is(number, -0)) fail('Invalid integer');
            return number;
        }
        const result = value(0);
        ws();
        if (at !== text.length) fail('Trailing or noninteger JSON data');
        return result;
    }

    function validateLayout(words, layout) {
        fields(layout, ['codeWords', 'extents', 'instructionStarts', 'dispatch', 'fastEntry'], 'layout');
        const header = words[0], allocation = 2 ** (((header >>> 23) & 15) + 6);
        const cw = (header >>> 10) & 8191, cc = header & 255;
        if (header >>> 27 !== 31 || words.length !== allocation || cw < 1 || 1 + cw + cc > allocation)
            fail('Invalid inner LUMP geometry');
        if (((header >>> 8) & 3) !== 0) fail('IDX1 inner LUMP must have abstraction typ=0');
        if (uint(layout.codeWords, 'codeWords') !== cw) fail('codeWords differs from header');
        if (!Array.isArray(layout.extents) || !Array.isArray(layout.instructionStarts) ||
                !Array.isArray(layout.dispatch)) fail('Layout maps must be arrays');
        const starts = [];
        let cursor = 1;
        for (const extent of layout.extents) {
            fields(extent, ['startWord', 'endWord', 'kind'], 'extent');
            const start = uint(extent.startWord, 'startWord'), end = uint(extent.endWord, 'endWord');
            if (start !== cursor || end <= start || end > cw + 1 ||
                    !['code', 'data'].includes(extent.kind)) fail('Extents must partition body');
            cursor = end;
            if (extent.kind === 'data') continue;
            for (let at = start; at < end;) {
                starts.push(at);
                const word = words[at], op = word >>> 27;
                if (op === 10) {
                    const length = ((word >>> 25) & 3) === 3 ? 3 : 2;
                    if (at + length > end) fail('Packet crosses code extent');
                    codec.decodePacket(words.slice(at, at + length));
                    at += length;
                } else {
                    if (!(op <= 7 || (op >= 16 && op <= 25))) fail('Unsupported IDX1 opcode');
                    if ((op === 18 || op === 19) && ((word & 0x7c00) || !(word & 31)))
                        fail('Invalid bit-field width or reserved bits');
                    at++;
                }
            }
        }
        if (cursor !== cw + 1) fail('Extents do not cover body');
        if (starts.length !== layout.instructionStarts.length ||
                starts.some((word, i) => word !== uint(layout.instructionStarts[i], 'instructionStart')))
            fail('Instruction start map differs from independent decode');
        if (!starts.includes(uint(layout.fastEntry, 'fastEntry'))) fail('Invalid fast entry');
        const warnings = [], dispatch = [];
        let previous = 0;
        const targetOfBranch = (at, word) =>
            at + ((word & 0x4000) ? (word & 0x7fff) - 0x8000 : word & 0x7fff);
        for (const entry of layout.dispatch) {
            fields(entry, ['selector', 'word', 'kind'], 'dispatch');
            const selector = uint(entry.selector, 'selector'), at = uint(entry.word, 'dispatch word');
            if (selector <= previous || selector !== at || at > cw) fail('Invalid dispatch order/word');
            previous = selector;
            const word = words[at];
            let target;
            if (entry.kind === 'branch') {
                if (!starts.includes(at) || word >>> 27 !== 23 || ((word >>> 23) & 15) !== 14 ||
                        (word & 0x7f8000)) fail('Dispatch branch must be one-word unconditional BRANCH');
                target = targetOfBranch(at, word);
            } else if (entry.kind === 'private' || entry.kind === 'offset') {
                if (!layout.extents.some(e => e.kind === 'data' && at >= e.startWord && at < e.endWord))
                    fail('Offset/private dispatch must be data');
                if ((entry.kind === 'private') !== (word === 0)) fail('Invalid offset/private dispatch value');
                target = word;
            } else fail('Unknown dispatch kind');
            if (entry.kind !== 'private' && !starts.includes(target))
                warnings.push(`Selector ${selector} target is not an instruction start`);
            dispatch.push({ ...entry, target });
        }
        for (const at of starts) {
            const word = words[at];
            let target;
            if (word >>> 27 === 23) target = targetOfBranch(at, word);
            else if (word >>> 27 === 10 && words[at + 1] >>> 27 === 23 && !((word >>> 20) & 15))
                target = at + ((word & 0x1000000) ? -(word & 0xfffff) : word & 0xfffff);
            if (target !== undefined && !starts.includes(target))
                warnings.push(`BRANCH at word ${at} target is not an instruction start`);
        }
        return { dispatch, warnings };
    }

    async function parse(input) {
        // Snapshot before awaiting a digest, so a caller cannot race validation.
        const bytes = Uint8Array.from(input);
        if (bytes.length < 24 || MAGIC.some((byte, i) => bytes[i] !== byte)) fail('Invalid IDX1 magic');
        const view = new DataView(bytes.buffer);
        const version = view.getUint32(8), metaLength = view.getUint32(12), payloadLength = view.getUint32(16);
        if (version !== 1 || view.getUint32(20) !== 0 || !metaLength || metaLength > 1048576)
            fail('Unsupported envelope version or lengths');
        const payloadAt = 24 + metaLength + ((4 - metaLength % 4) % 4);
        if (payloadLength % 4 || payloadAt + payloadLength !== bytes.length) fail('Invalid envelope framing');
        if (bytes.slice(24 + metaLength, payloadAt).some(byte => byte !== 0)) fail('Nonzero padding');
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.slice(24, 24 + metaLength));
        } catch (_) { fail('Invalid metadata UTF-8'); }
        const metadata = strictJSON(text);
        fields(metadata, ['schema', 'isaProfile', 'requiredFeatures', 'payloadSha256', 'layout'], 'metadata');
        if (metadata.schema !== 'cm.idx1.execution/1' || metadata.isaProfile !== 'IDX1' ||
                JSON.stringify(metadata.requiredFeatures) !== JSON.stringify(FEATURES))
            fail('Unsupported profile/schema/features');
        if (typeof metadata.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.payloadSha256))
            fail('Invalid payload digest');
        const payload = bytes.slice(payloadAt);
        if (await digest(payload) !== metadata.payloadSha256) fail('Payload digest mismatch');
        const words = [];
        for (let at = payloadAt; at < bytes.length; at += 4) words.push(view.getUint32(at));
        const facts = validateLayout(words, metadata.layout);
        return freeze({ profile: 'IDX1', executionDigest: await digest(bytes),
            bytes: Array.from(bytes), payload: Array.from(payload), words, metadata, ...facts });
    }
    async function frame(input, layout) {
        const payload = Uint8Array.from(input);
        // Clone before the first await. Caller mutations cannot change metadata.
        const copiedLayout = strictJSON(JSON.stringify(layout));
        const metadata = { schema: 'cm.idx1.execution/1', isaProfile: 'IDX1',
            requiredFeatures: FEATURES, payloadSha256: await digest(payload), layout: copiedLayout };
        const text = new TextEncoder().encode(JSON.stringify(metadata));
        const payloadAt = 24 + text.length + ((4 - text.length % 4) % 4);
        const bytes = new Uint8Array(payloadAt + payload.length), view = new DataView(bytes.buffer);
        bytes.set(MAGIC);
        view.setUint32(8, 1); view.setUint32(12, text.length); view.setUint32(16, payload.length);
        bytes.set(text, 24); bytes.set(payload, payloadAt);
        return parse(bytes);
    }
    const api = Object.freeze({ parse, frame });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChurchIDX1Envelope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
'use strict';

// Shared stored API validation for compilation, inspection and admission.
// Structural validation is not admission or destination binding approval.
(function(root) {
    const NAME = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;
    const LEAF = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)+$/;
    const ISSUED = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)+#[1-9][0-9]*$/;
    const HEX64 = /^[0-9a-f]{64}$/;
    const TYPES = ['Inform', 'Outform', 'Abstract'];
    const fail = message => { throw new Error('LUMP API: ' + message); };
    const object = v => v !== null && typeof v === 'object' &&
        Object.prototype.toString.call(v) === '[object Object]';
    const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
    function keys(v, allowed, required, path) {
        if (!object(v)) fail(path + ' must be an object');
        for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(path + ': unknown field ' + k);
        for (const k of required) if (!own(v, k)) fail(path + ': missing ' + k);
    }
    function rights(v) {
        if (typeof v !== 'string' || (v !== '' && !/^[RWX]+$|^[LSE]+$/.test(v)) ||
            [...'RWXLSE'].filter(r => v.includes(r)).join('') !== v ||
            (/^[LSE]+$/.test(v) && v.length > 1 && v !== 'LS'))
            fail('permissions must be empty or unique, ordered RWX or LSE, without mixing families');
    }
    function register(v, path) {
        if (typeof v !== 'string' || !/^(DR|CR)([0-9]|1[0-5])$/.test(v))
            fail(path + ': invalid register');
    }
    function parameters(value, path) {
        if (!object(value) || !Object.keys(value).length) fail(path + ': omit empty parameter lists');
        const used = new Set();
        for (const [name, spec] of Object.entries(value)) {
            if (!NAME.test(name)) fail(path + ': invalid parameter name');
            let reg = spec;
            if (object(spec)) {
                keys(spec, ['register', 'type', 'rights'], ['register', 'type', 'rights'], path);
                reg = spec.register;
                if (!TYPES.includes(spec.type)) fail(path + ': invalid capability type');
                rights(spec.rights);
                if (typeof reg !== 'string' || !reg.startsWith('CR')) fail(path + ': capability requires CR');
            } else if (typeof reg !== 'string' || !reg.startsWith('DR')) {
                fail(path + ': capability parameters need explicit type and rights');
            }
            register(reg, path);
            if (used.has(reg)) fail(path + ': duplicate parameter register');
            used.add(reg);
        }
    }
    function validate(api, header) {
        keys(header, ['cw','cc'], ['cw','cc'], 'header geometry');
        if (!Number.isInteger(header.cw) || header.cw < 1 || header.cw > 8191 ||
            !Number.isInteger(header.cc) || header.cc < 1 || header.cc > 255)
            fail('invalid code/C-list extent');
        keys(api, ['name','passkey','methods','imports','symbolic_binding','contracts'], ['name','methods'], 'root');
        const typed = own(api, 'passkey');
        if (typed && api.passkey !== 1) fail('passkey must be 1');
        if (typeof api.name !== 'string' || !NAME.test(api.name)) fail('invalid abstraction name');
        if (!object(api.methods)) fail('methods must be a name-keyed object, not a legacy array');
        const selectors = new Set();
        for (const [name, method] of Object.entries(api.methods)) {
            if (!NAME.test(name)) fail('invalid method name');
            if (typed) {
                if (!Array.isArray(method) || method.length !== 3)
                    fail('typed method requires [selector, inputs, result]');
                const [selector, inputs, result] = method;
                if (!Number.isInteger(selector) || selector < 0 || selector > 126 ||
                        selector >= header.cw || selectors.has(selector))
                    fail('invalid or duplicate typed method selector');
                selectors.add(selector);
                if (!Array.isArray(inputs)) fail('typed inputs must be an ordered array');
                const names = new Set();
                let scalarCount = 0, capabilityCount = 0;
                for (const input of inputs) {
                    if (!Array.isArray(input) || typeof input[0] !== 'string' ||
                            !NAME.test(input[0]) || names.has(input[0]))
                        fail('invalid or duplicate typed input name');
                    names.add(input[0]);
                    const spec = input.slice(1);
                    typedType(spec.length === 1 ? spec[0] : spec, false);
                    if (input[1] === 1) scalarCount++;
                    else capabilityCount++;
                }
                if (scalarCount > 14 || capabilityCount > 1)
                    fail('typed inputs exceed DR2–DR15 or single CR2 input');
                typedType(result, true);
                continue;
            }
            keys(method, ['selector','inputs','returns'], ['selector'], 'method ' + name);
            if (!Number.isInteger(method.selector) || method.selector < 0 || method.selector >= header.cw)
                fail('method selector outside code extent');
            if (selectors.has(method.selector)) fail('duplicate method selector');
            selectors.add(method.selector);
            if (own(method, 'inputs')) parameters(method.inputs, name + ' inputs');
            if (own(method, 'returns')) {
                if (typeof method.returns === 'string') {
                    register(method.returns, name + ' returns');
                    if (!method.returns.startsWith('DR')) fail('capability returns need type and rights');
                } else parameters(method.returns, name + ' returns');
            }
        }
        if (own(api, 'contracts')) validateContracts(api.contracts, api.methods);
        const rows = new Map(), names = new Set();
        if (own(api, 'imports')) {
            if (!object(api.imports) || !Object.keys(api.imports).length) fail('omit empty imports');
            for (const [permission, group] of Object.entries(api.imports)) {
                rights(permission);
                if (!object(group) || !Object.keys(group).length) fail('empty permission group');
                for (const [row, target] of Object.entries(group)) {
                    if (!/^[1-9][0-9]*$/.test(row) || Number(row) >= header.cc)
                        fail('import row outside C-list; row zero is implicit SELF');
                    if (rows.has(row)) fail('duplicate import row across permission groups');
                    let name;
                    if (typeof target === 'number') {
                        if (!Number.isInteger(target) || target < 1 || target >= header.cc)
                            fail('invalid target reference');
                    } else if (typeof target === 'string') {
                        // Only qualified destination leaf symbols use this short form.
                        // Never treat it as a way to omit an issued LUMP's identity locks.
                        if (!LEAF.test(target)) fail('leaf import must be qualified');
                        name = target;
                    } else {
                        keys(target, ['name','T','binary_hash','identity_hash','type'],
                            ['name','T','binary_hash','identity_hash','type'], 'locked import');
                        if (typeof target.name !== 'string' || !ISSUED.test(target.name) ||
                            !Number.isSafeInteger(Number(target.name.split('#')[1])))
                            fail('locked import requires qualified name#issue');
                        if (typeof target.T !== 'string' || !/^[0-9a-f]{8}$/.test(target.T) ||
                            typeof target.binary_hash !== 'string' || !HEX64.test(target.binary_hash) ||
                            typeof target.identity_hash !== 'string' || !HEX64.test(target.identity_hash) ||
                            !TYPES.includes(target.type))
                            fail('invalid locked import identity or type');
                        name = target.name;
                    }
                    if (name) {
                        if (names.has(name)) fail('duplicate target definition; use a row reference');
                        names.add(name);
                    }
                    rows.set(row, target);
                }
            }
        }
        if (rows.size !== header.cc - 1) fail('every non-SELF C-list row requires a declaration');
        for (const [row, target] of rows) {
            let next = target;
            const seen = new Set([row]);
            while (typeof next === 'number') {
                const key = String(next);
                if (!rows.has(key) || seen.has(key)) fail('missing or cyclic target reference');
                seen.add(key);
                next = rows.get(key);
            }
        }
        if (own(api, 'symbolic_binding')) symbolic(api.symbolic_binding, header, api.name);
        return api;
    }
    function typedType(spec, result) {
        if (spec === 1 || (result && spec === 0)) return;
        if (!Array.isArray(spec) || ![2,3,4,5].includes(spec[0]) ||
                spec.length !== (spec[0] === 5 ? 3 : 2))
            fail('invalid typed capability descriptor');
        rights(spec[1]);
        if (spec[0] === 5 && (!Array.isArray(spec[2]) || !spec[2].length ||
                spec[2].some((type, i, types) => ![2,3,4].includes(type) ||
                    (i > 0 && type <= types[i - 1]))))
            fail('Object accepted types must be unique ascending types 2–4');
    }
    function validateContracts(contracts, methods) {
        keys(contracts, Object.keys(methods), Object.keys(methods), 'functional contracts');
        if (!Object.keys(contracts).length) fail('functional contracts cannot be empty');
        const text = (v, path) => {
            if (typeof v !== 'string' || !v.trim() || v.length > 4096)
                fail(path + ' must be nonempty text of at most 4096 characters');
        };
        for (const [name, contract] of Object.entries(contracts)) {
            const fields = ['purpose','inputs','result','effects','failures','authorization','example'];
            keys(contract, fields, fields, 'contract ' + name);
            for (const field of fields.filter(f => f !== 'inputs'))
                text(contract[field], name + '.' + field);
            const method = methods[name];
            const inputs = Array.isArray(method)
                ? method[1].map(input => input[0]) : Object.keys(method.inputs || {});
            keys(contract.inputs, inputs, inputs, name + '.inputs');
            for (const [input, description] of Object.entries(contract.inputs)) {
                const fields = ['meaning','unit','allowed','encoding'];
                keys(description, fields, fields, name + '.' + input);
                for (const field of fields) text(description[field], name + '.' + input + '.' + field);
            }
        }
        return contracts;
    }
    // Explicit comment directives; ordinary comments are never inferred as API.
    function extractContracts(source, methods) {
        const contracts = Object.create(null);
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!/^\s*;\s*@(?:contract|endcontract)\b/.test(lines[i])) continue;
            const start = i + 1;
            try {
                const match = lines[i].match(/^\s*;\s*@contract\s+([A-Za-z_]\w*)\s*$/);
                if (!match) fail('expected ; @contract MethodName');
                const name = match[1];
                if (own(contracts, name)) fail('duplicate functional contract ' + name);
                const json = [];
                for (++i; i < lines.length && !/^\s*;\s*@endcontract\s*$/.test(lines[i]); i++) {
                    if (!/^\s*;/.test(lines[i]) || /^\s*;\s*@contract\b/.test(lines[i]))
                        fail('contract JSON must be comment lines ending with ; @endcontract');
                    json.push(lines[i].replace(/^\s*;\s?/, ''));
                }
                if (i === lines.length) fail('unterminated functional contract ' + name);
                contracts[name] = parseJSON(json.join('\n'));
            } catch (error) {
                error.line = start;
                throw error;
            }
        }
        if (!Object.keys(contracts).length) return undefined;
        return validateContracts({...contracts}, methods);
    }
    // Symbolic CALL relocations are integrity-covered declarations only.
    function symbolic(b, header, owner) {
        keys(b, ['schema','owner','dependencies','calls'], ['schema','owner','dependencies','calls'], 'symbolic_binding');
        if (b.schema !== 'church.symbolic-lump-binding/v1') fail('symbolic_binding: unsupported schema');
        if (b.owner !== owner) fail('symbolic_binding: owner differs from abstraction name');
        if (!Array.isArray(b.dependencies) || b.dependencies.length !== header.cc)
            fail('symbolic_binding: dependencies must cover the exact C-list');
        b.dependencies.forEach((d, row) => {
            keys(d, ['name','rights','relocation_row','symbolic_self'], ['name','rights','relocation_row','symbolic_self'], 'symbolic dependency');
            if (d.relocation_row !== row || d.symbolic_self !== (row === 0)) fail('symbolic_binding: invalid relocation row');
            if (row === 0 ? d.name !== 'SELF' : (typeof d.name !== 'string' || !NAME.test(d.name)))
                fail('symbolic_binding: invalid dependency name');
            if (!Array.isArray(d.rights) || new Set(d.rights).size !== d.rights.length ||
                d.rights.some(r => !'RWXLSE'.includes(r) || r.length !== 1) ||
                (d.rights.some(r => 'RWX'.includes(r)) && d.rights.some(r => 'LSE'.includes(r))))
                fail('symbolic_binding: invalid rights');
        });
        if (!Array.isArray(b.calls)) fail('symbolic_binding: calls must be an array');
        const offsets = new Set();
        for (const c of b.calls) {
            keys(c, ['word_offset','full_name','row','source_line','condition'], ['word_offset','full_name','row','source_line','condition'], 'symbolic call');
            if (!Number.isInteger(c.word_offset) || c.word_offset < 1 || c.word_offset > header.cw || offsets.has(c.word_offset))
                fail('symbolic_binding: call offset outside code extent or duplicated');
            offsets.add(c.word_offset);
            if (typeof c.full_name !== 'string' || !NAME.test(c.full_name)) fail('symbolic_binding: invalid full_name');
            if (!Number.isInteger(c.row) || c.row < 1 || c.row >= header.cc || c.row > 31) fail('symbolic_binding: invalid call row');
            if (!(c.source_line === null || (Number.isInteger(c.source_line) && c.source_line > 0))) fail('symbolic_binding: invalid source_line');
            if (!Number.isInteger(c.condition) || c.condition < 0 || c.condition > 15) fail('symbolic_binding: invalid condition');
        }
    }
    function sort(value) {
        if (!object(value)) return value;
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
    }
    function serialize(api, header) {
        validate(api, header);
        const text = JSON.stringify(own(api, 'passkey') ? {
            name:api.name, passkey:api.passkey, methods:sort(api.methods),
            ...(api.imports ? {imports:sort(api.imports)} : {}),
            ...(api.contracts ? {contracts:sort(api.contracts)} : {}),
            ...(api.symbolic_binding ? {symbolic_binding:sort(api.symbolic_binding)} : {})
        } : sort(api));
        if (new TextEncoder().encode(text).length > 65535) fail('JSON exceeds frame length');
        return text;
    }
    function parseJSON(text) {
        if (typeof text !== 'string' || text.length > 65535 ||
            new TextEncoder().encode(text).length > 65535) fail('invalid JSON length');
        // JSON.parse validates grammar; this second pass rejects duplicate keys,
        // including escaped spellings, before callers can trust the parsed value.
        const parsed = JSON.parse(text);
        const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g);
        let i = 0;
        function walk(depth) {
            if (depth > 32) fail('JSON nesting exceeds limit');
            const token = tokens[i++];
            if (token === '{') {
                const seen = new Set();
                while (tokens[i] !== '}') {
                    const key = JSON.parse(tokens[i++]);
                    if (seen.has(key)) fail('duplicate JSON key ' + key);
                    seen.add(key);
                    i++; // colon, already grammar-checked
                    walk(depth + 1);
                    if (tokens[i] === ',') i++;
                }
                i++;
            } else if (token === '[') {
                while (tokens[i] !== ']') {
                    walk(depth + 1);
                    if (tokens[i] === ',') i++;
                }
                i++;
            }
        }
        walk(0);
        return parsed;
    }
    function parse(text, header) {
        return validate(parseJSON(text), header);
    }
    const api = {validate, parse, parseJSON, serialize, extractContracts, validateContracts};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LumpApiContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';

// One stored contract. The expanded view is a mechanical adapter for internal
// instruction/binding consumers, never a second serialized API or authority.
(function(root) {
    const node = typeof module !== 'undefined' && module.exports;
    const contract = node ? require('./lump-api-contract') : root.LumpApiContract;
    const clone = value => JSON.parse(JSON.stringify(value));
    const compact = api => !!api && !!api.methods && !Array.isArray(api.methods);
    function encode(api, header) {
        if (compact(api)) return JSON.parse(contract.serialize(api, header));
        if (!api || !Array.isArray(api.methods) || !Array.isArray(api.capabilities))
            throw new Error('Cannot compile compact API without method and capability declarations');
        const out = {name:api.name, methods:{}};
        for (const method of api.methods) {
            if (method.outputs && method.outputs.length)
                throw new Error('Additional method outputs require an explicit compact mapping');
            if (!method.name || Object.hasOwn(out.methods, method.name))
                throw new Error('Missing or duplicate public method name');
            const item = {selector:method.index};
            function parameter(param) {
                if (String(param.register).startsWith('DR')) return param.register;
                if (!['Inform','Outform','Abstract'].includes(param.secure_type || param.type))
                    throw new Error('Capability parameter requires an explicit supported type');
                return {register:param.register,type:param.secure_type || param.type,
                    rights:(param.rights || []).join('')};
            }
            if (method.inputs && method.inputs.length) {
                item.inputs = {};
                for (const param of method.inputs) {
                    if (!param.name || Object.hasOwn(item.inputs, param.name))
                        throw new Error('Missing or duplicate input parameter name');
                    item.inputs[param.name] = parameter(param);
                }
            }
            if (method.returns) {
                const ret = method.returns;
                item.returns = String(ret.register).startsWith('DR') ? ret.register :
                    {[ret.name || 'result']:parameter(ret)};
            }
            out.methods[method.name] = item;
        }
        const seen = new Map();
        for (let row = 0; row < api.capabilities.length; row++) {
            const cap = api.capabilities[row];
            if (row === 0) {
                if (!cap || !['SELF','__SELF__'].includes(cap.name))
                    throw new Error('Compact API requires compiler-owned SELF at row zero');
                continue;
            }
            if (cap.role || cap.initial || cap.private_data || cap.filled_by)
                throw new Error('Unsupported runtime/private-storage binding; no declaration was discarded');
            const requested = cap.rights || cap.grants || [];
            if (cap.rights && cap.grants && [...new Set(cap.rights)].sort().join('') !==
                    [...new Set(cap.grants)].sort().join(''))
                throw new Error('Conflicting rights and grants cannot be compacted');
            const rights = [...'RWXLSE'].filter(r => requested.includes(r)).join('');
            if (requested.some(r => !'RWXLSE'.includes(r)))
                throw new Error('Unknown capability permission');
            let target = cap.canonical_leaf || cap.name;
            const identity = cap.N || cap.identity_string;
            if (identity || cap.T || cap.token || cap.binary_hash || cap.identity_hash) {
                target = {name:identity, T:cap.T || cap.token, binary_hash:cap.binary_hash,
                    identity_hash:cap.identity_hash, type:cap.capability_type || 'Inform'};
            }
            const key = JSON.stringify(target);
            out.imports ||= {};
            out.imports[rights] ||= {};
            out.imports[rights][row] = seen.has(key) ? seen.get(key) : target;
            if (!seen.has(key)) seen.set(key, row);
        }
        return JSON.parse(contract.serialize(out, header));
    }
    function expand(api, words) {
        if (!compact(api)) return clone(api);
        const header = {cw:(words[0] >>> 10) & 8191, cc:words[0] & 255};
        contract.validate(api, header);
        for (const method of Object.values(api.methods)) {
            if (method.returns && typeof method.returns === 'object' &&
                    Object.keys(method.returns).length > 1)
                throw new Error('Multiple return values require an explicit internal binding view');
        }
        const capabilities = [{name:'SELF',rights:['E'],grants:['E']}];
        const targets = new Map();
        for (const [rights, rows] of Object.entries(api.imports || {}))
            for (const [row, target] of Object.entries(rows)) targets.set(Number(row), {rights,target});
        for (let row = 1; row < header.cc; row++) {
            const {rights} = targets.get(row);
            let target = targets.get(row).target;
            while (typeof target === 'number') target = targets.get(target).target;
            let declaration;
            if (typeof target === 'string') {
                declaration = {name:target};
                if (target.includes('.')) declaration.canonical_leaf = target;
            } else {
                declaration = {name:target.name, N:target.name, T:target.T,
                    binary_hash:target.binary_hash,identity_hash:target.identity_hash,
                    capability_type:target.type};
            }
            capabilities.push({...declaration,rights:[...rights],grants:[...rights]});
        }
        function parameters(params) {
            return Object.entries(params || {}).map(([name, spec]) => typeof spec === 'string'
                ? {name,register:spec,kind:'value'}
                : {name,register:spec.register,kind:'capability',secure_type:spec.type,rights:[...spec.rights]});
        }
        return {name:api.name, capabilities,
            methods:Object.entries(api.methods).map(([name, method]) => ({
                name,index:method.selector,branchOffset:words[1 + method.selector] & 0x7fff,
                inputs:parameters(method.inputs),
                ...(method.returns ? {returns:typeof method.returns === 'string'
                    ? {name:'result',register:method.returns} : parameters(method.returns)[0]} : {})
            }))
        };
    }
    const exported = {isCompact:compact,encode,expand};
    if (node) module.exports = exported;
    else root.LumpApiCodec = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

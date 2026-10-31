// Public, black-box projection of an inspected artifact's interface.
// Never use this projection for binding, admission, hashing or re-emission.
(function(root) {
    'use strict';
    const copyFields = (value, keys) => {
        const result = {};
        if (!value || typeof value !== 'object') return result;
        for (const key of keys) {
            const v = value[key];
            if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
                result[key] = v;
            else if (Array.isArray(v) && v.every(x => ['string', 'number', 'boolean'].includes(typeof x)))
                result[key] = v.slice();
        }
        return result;
    };
    const parameter = value => typeof value === 'string' ? value : copyFields(value, [
        'name', 'register', 'kind', 'type', 'secure_type', 'rights',
        'description', 'optional', 'default', 'min', 'max', 'values'
    ]);
    function project(definition) {
        if (!definition || typeof definition !== 'object') return null;
        if (definition.methods && !Array.isArray(definition.methods))
            return JSON.parse(JSON.stringify(definition));
        const result = copyFields(definition, ['name', 'description']);
        if (definition.contracts) result.contracts = JSON.parse(JSON.stringify(definition.contracts));
        result.methods = (Array.isArray(definition.methods) ? definition.methods : [])
            .filter(m => m && typeof m === 'object' && m.visibility !== 'private')
            .map(m => {
                const method = copyFields(m, ['name', 'index', 'description']);
                if (Array.isArray(m.inputs)) method.inputs = m.inputs.map(parameter);
                else if (Array.isArray(m.params)) method.params = m.params.map(parameter);
                if (m.returns !== undefined) method.returns = Array.isArray(m.returns)
                    ? m.returns.map(parameter) : parameter(m.returns);
                return method;
            });
        // A declared calling convention is part of the external contract,
        // unlike implementation language, allocation and dependency grants.
        if (result.methods.length && definition.returnConvention)
            result.returnConvention = parameter(definition.returnConvention);
        return result;
    }
    const escape = value => String(value).replace(/[&<>"']/g, c =>
        ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
    function renderContracts(contracts) {
        if (!contracts) return '<p>No functional contract was embedded in this artifact. Argument meanings are not inferred.</p>';
        let html = '<section aria-label="Functional contracts"><h3>Functional contracts</h3>' +
            '<p>Author-declared behavior, validated for completeness—not proof of implementation or runtime enforcement.</p>';
        for (const [name, c] of Object.entries(contracts)) {
            html += `<h4>${escape(name)}</h4><p>${escape(c.purpose)}</p>`;
            for (const [name, input] of Object.entries(c.inputs))
                html += `<h5>Input: ${escape(name)}</h5><dl>` +
                    Object.entries(input).map(([key, value]) =>
                        `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('') + '</dl>';
            for (const field of ['result','effects','failures','authorization','example'])
                html += `<p><strong>${escape(field[0].toUpperCase() + field.slice(1))}</strong><br>${escape(c[field])}</p>`;
        }
        return html + '</section>';
    }
    function render(definition, loading) {
        const api = project(definition);
        if (api && api.methods && !Array.isArray(api.methods)) {
            return '<div class="lump-detail-section"><div class="lump-section-title">API — canonical black-box definition</div>' +
                renderContracts(api.contracts) +
                '<details><summary>ABI and canonical interface JSON</summary><pre>' +
                escape(JSON.stringify(api, null, 2)) + '</pre></details></div>';
        }
        if (!api) return `<div class="lump-detail-section">${loading
            ? 'Loading the public interface from the saved binary…'
            : 'Public API unavailable. No interface is inferred from source, sidecars or catalog entries.'}</div>`;
        let html = '<div class="lump-detail-sections"><div class="lump-detail-section">' +
            '<div class="lump-section-title">Public API — black box</div>' +
            `<strong>${escape(api.name || 'Unnamed interface')}</strong>` +
            '<p>What callers can invoke, supply and receive. Implementation details are in Internals.</p>';
        if (api.description) html += `<p>${escape(api.description)}</p>`;
        html += renderContracts(api.contracts);
        if (!api.methods.length) html += '<p>No public methods are declared in this artifact. No callable methods are invented.</p>';
        api.methods.forEach(m => {
            html += `<h4>${escape(m.name || 'Unnamed method')}` +
                (m.index !== undefined ? ` · selector ${escape(m.index)}` : '') + '</h4>';
            if (m.description) html += `<p>${escape(m.description)}</p>`;
            html += `<p>Inputs</p><pre class="lump-api-json">${escape(JSON.stringify(m.inputs || m.params || [], null, 2))}</pre>`;
            html += `<p>Returns</p><pre class="lump-api-json">${escape(JSON.stringify(m.returns !== undefined
                ? m.returns : api.returnConvention || 'Not declared', null, 2))}</pre>`;
        });
        html += `<details><summary>Public interface JSON</summary><pre class="lump-api-json">${escape(JSON.stringify(api, null, 2))}</pre></details>`;
        html += '<p>This is a public projection of the saved metadata, not a rewritten LUMP. Internal binding records and allocation are unchanged.</p></div></div>';
        return html;
    }
    // Context only: never resolves registers, grants, or source declarations.
    function callContext(text, offset) {
        const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
        const end = text.indexOf('\n', offset);
        const line = text.slice(start, end < 0 ? text.length : end);
        const code = line.split(/;|\/\//)[0];
        if (offset - start > code.length) return null;
        const call = code.match(/^\s*(?:[\w.]+:\s*)?CALL\s+(.+?)\s*$/i);
        if (!call) return null;
        const args = call[1].trim();
        const indexed = args.match(/^CR6\[([\w.]+)\]\s*,\s*(#?\d+|[\w.]+)$/i);
        const held = args.match(/^CR\d+\s*,\s*(#?\d+|[\w.]+)$/i);
        const target = indexed ? indexed[2] : held ? held[1] : args;
        if (/^#?\d+$/.test(target))
            return { abstraction: null, method: target.replace(/^#/, '') };
        // Unparsed operands must not turn a dot inside CR6[pet.name] into
        // an abstraction name. Petnames are not target identity evidence.
        if (!indexed && !held && /[\[\],]/.test(args))
            return { abstraction: null, method: null };
        const dot = target.lastIndexOf('.');
        if (dot > 0) return { abstraction: target.slice(0, dot), method: target.slice(dot + 1) };
        if (/^[\w.]+$/.test(target) && !/^CR\d+$/i.test(target))
            return { abstraction: null, method: target };
        return { abstraction: null, method: null };
    }
    async function inspectExact(identity, fetcher) {
        if (!identity.filename || !identity.token || !/^[a-f0-9]{64}$/i.test(identity.binary_hash || ''))
            throw new Error('Exact filename, token and binary hash are required');
        const response = await fetcher(`/api/lump/${encodeURIComponent(identity.token)}/words?exact_filename=${encodeURIComponent(identity.filename)}&binary_hash=${encodeURIComponent(identity.binary_hash)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Inspection returned HTTP ${response.status}`);
        const data = await response.json();
        const inspection = data.inspection || data.binary_inspection || data;
        if ((data.filename || data.lump || data.archive_filename) !== identity.filename ||
            String(inspection.binary_hash || '').toLowerCase() !== identity.binary_hash.toLowerCase())
            throw new Error('Returned artifact does not match the selected revision');
        if (Object.prototype.hasOwnProperty.call(inspection, 'api_definition')) return inspection.api_definition;
        if (!data.raw_tail_hex && Array.isArray(data.words) && typeof LumpContentFrame !== 'undefined') {
            const content = await LumpContentFrame.lumpInspectContentFrame(data.words);
            if (content.headerValid && content.contentFrameValid) return content.apiDefinition;
        }
        return null;
    }
    function renderCallContract(api, methodName, identity) {
        let html = `<p>Exact saved LUMP: <code>${escape(identity.filename)}</code><br>SHA-256: <code style="overflow-wrap:anywhere">${escape(identity.binary_hash)}</code></p>`;
        if (!api || !Array.isArray(api.methods))
            return html + '<p>Saved API unavailable for these bytes. No contract is inferred from source or another revision.</p>';
        // Numeric selectors must be declared, never inferred from array position.
        const method = api.methods.find(m => m && (m.name === methodName ||
            (/^\d+$/.test(methodName || '') && (m.index ?? m.selector) !== undefined &&
                String(m.index ?? m.selector) === methodName)));
        if (!method)
            return html + '<p>Method unavailable or unresolved in this saved API. No method or contract is inferred.</p>';
        const contract = api.contracts && Object.prototype.hasOwnProperty.call(api.contracts, method.name)
            ? api.contracts[method.name] : null;
        if (!contract) return html + `<p>No functional contract was embedded for ${escape(method.name)} in this artifact. Argument meanings are not inferred.</p>`;
        return html + renderContracts({ [method.name]: contract });
    }
    const exported = {project, render, renderContracts, callContext, inspectExact, renderCallContract};
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
    else root.LumpPublicApi = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

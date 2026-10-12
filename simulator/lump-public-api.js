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
    function render(definition, loading) {
        const api = project(definition);
        if (api && api.methods && !Array.isArray(api.methods)) {
            return '<div class="lump-detail-section"><div class="lump-section-title">API — canonical black-box definition</div>' +
                '<p>The exact embedded definition used by the IDE and linking loader.</p><pre>' +
                escape(JSON.stringify(api, null, 2)) + '</pre></div>';
        }
        if (!api) return `<div class="lump-detail-section">${loading
            ? 'Loading the public interface from the saved binary…'
            : 'Public API unavailable. No interface is inferred from source, sidecars or catalog entries.'}</div>`;
        let html = '<div class="lump-detail-sections"><div class="lump-detail-section">' +
            '<div class="lump-section-title">Public API — black box</div>' +
            `<strong>${escape(api.name || 'Unnamed interface')}</strong>` +
            '<p>What callers can invoke, supply and receive. Implementation details are in Internals.</p>';
        if (api.description) html += `<p>${escape(api.description)}</p>`;
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
    const exported = {project, render};
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
    else root.LumpPublicApi = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

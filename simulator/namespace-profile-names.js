// Public profile names match the Namespace dropdown, not storage/API keys.
(function(root) {
    'use strict';
    const names = Object.freeze({
        ascending: 'New layout — ascending table / four-word header',
        phase1: 'Phase 1 — 256-slot default / metadata, self, entry Thread',
        legacy: 'Previous saved design / committed-image controls',
    });
    const api = Object.freeze({
        names,
        label: profile => names[profile] || 'Unknown Namespace design',
    });
    root.NamespaceProfileNames = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

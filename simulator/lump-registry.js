// lump-registry.js — Global Pet Name Namespace (GPNN) Singleton
//
// Single source of truth for all digital object identity in the IDE.
// Token (CRC-32 hex string, 8 chars) is the universal global identifier.
// Physical NS slot numbers are private implementation details — never used
// as resolution keys by callers of this module.
//
// Internal entry shape:
//   { token, abstraction, sources: { memory?: {...}, server?: {...} } }
//
// Producer API (called at assemble/compile/save/fetch time):
//   LumpRegistry.registerMemory(token, abstraction, words, capabilities)
//   LumpRegistry.registerFromServer(serverLumps)
//   LumpRegistry.setCurrent(token)
//   LumpRegistry.setPending(token)
//
// Consumer API:
//   LumpRegistry.getCurrent()         → token | null
//   LumpRegistry.getPending()         → token | null (non-destructive peek)
//   LumpRegistry.consumePending()     → token | null  (reads AND clears)
//   LumpRegistry.resolve(token)       → entry | null  (synchronous)
//   LumpRegistry.resolveWords(token)  → Promise<{words,capabilities,abstraction}|null>
//   LumpRegistry.evictMemory(token)   → void
//   LumpRegistry.list()               → sorted entry array
//   LumpRegistry.getServerList()      → flat server-metadata array (compat)
//   LumpRegistry.has(token)           → boolean
//   LumpRegistry.isServerListFetched()→ boolean
//   LumpRegistry.warmServerList()     → Promise<serverList> — shared in-flight fetch;
//                                       all concurrent callers share one network request

(function () {
    'use strict';

    var _current = null;   // token of currently selected/compiled lump
    var _pending  = null;  // token pending navigation to Lumps view
    var _entries  = new Map(); // token → { token, abstraction, sources }
    var _serverListFetched = false; // true after first registerFromServer() call
    var _serverListFetchPromise = null; // in-flight warmServerList() promise (shared)

    // Restore last-viewed token from localStorage on startup
    try {
        var _saved = localStorage.getItem('lumpRegistryCurrent');
        if (_saved && typeof _saved === 'string') _current = _saved;
    } catch (_e) {}

    var LumpRegistry = {

        // ── Producers ─────────────────────────────────────────────────────────

        // Register in-memory assembled lump content.
        // Called immediately after every successful assemble/compile.
        // Argument order matches the task spec: (token, abstraction, words, capabilities)
        registerMemory: function (token, abstraction, words, capabilities) {
            if (!token) return;
            var entry = _entries.get(token) || {
                token: token,
                abstraction: abstraction || ('Lump 0x' + token),
                sources: {}
            };
            entry.abstraction = abstraction || entry.abstraction;
            entry.sources.memory = {
                words:         words        ? Array.prototype.slice.call(words)        : [],
                capabilities:  capabilities ? Array.prototype.slice.call(capabilities) : [],
                registeredAt:  Date.now()
            };
            _entries.set(token, entry);
        },

        // Bulk-register server metadata from /api/lumps/list.
        // Merges into existing entries — in-memory content is preserved.
        // Sets _serverListFetched = true even for an empty list so callers
        // can distinguish "never fetched" from "fetched but repo is empty".
        registerFromServer: function (serverLumps) {
            _serverListFetched = true;
            var now   = Date.now();
            var lumps = serverLumps || [];
            for (var i = 0; i < lumps.length; i++) {
                var l = lumps[i];
                if (!l || !l.token) continue;
                var entry = _entries.get(l.token) || {
                    token: l.token,
                    abstraction: l.abstraction || l.token,
                    sources: {}
                };
                entry.abstraction = l.abstraction || entry.abstraction;
                entry.sources.server = Object.assign({ fetchedAt: now }, l);
                _entries.set(l.token, entry);
            }
        },

        // Mark the token of the lump most recently compiled/saved/selected.
        // Persisted to localStorage so the selection survives page reload.
        setCurrent: function (token) {
            _current = token || null;
            try {
                if (_current) localStorage.setItem('lumpRegistryCurrent', _current);
                else          localStorage.removeItem('lumpRegistryCurrent');
            } catch (_e) {}
        },

        // Set the token that the next renderLumps() call should pre-select.
        setPending: function (token) {
            _pending = token || null;
        },

        // ── Consumers ─────────────────────────────────────────────────────────

        // Returns true once registerFromServer() has been called at least once
        // (even for an empty list). Lets updateNamespace() skip its prefetch
        // when renderLumps() or another path has already fetched the server list.
        isServerListFetched: function () { return _serverListFetched; },

        // Warm the server list with at most one in-flight network request.
        // All concurrent callers share the same Promise — no duplicate fetches.
        // Resolves to the flat server-metadata array (same shape as getServerList()).
        warmServerList: function () {
            if (_serverListFetched) return Promise.resolve(LumpRegistry.getServerList());
            if (_serverListFetchPromise) return _serverListFetchPromise;
            _serverListFetchPromise = fetch('/api/lumps/list')
                .then(function (r) { return r.ok ? r.json() : []; })
                .catch(function () { return []; })
                .then(function (lumps) {
                    _serverListFetchPromise = null;
                    LumpRegistry.registerFromServer(lumps || []);
                    return LumpRegistry.getServerList();
                });
            return _serverListFetchPromise;
        },

        getCurrent: function () { return _current; },
        getPending: function () { return _pending; },

        // Read the pending token AND clear it atomically.
        // Use this inside renderLumps() so the pending token is consumed once.
        consumePending: function () {
            var t = _pending;
            _pending = null;
            return t;
        },

        // Synchronous resolve: checks memory then server cache.
        // Returns the full entry {token, abstraction, sources} or null.
        resolve: function (token) {
            if (!token) return null;
            return _entries.get(token) || null;
        },

        // Async resolveWords: memory source first, then fetches
        // /api/lump/<token>/words from the server as a fallback.
        // Returns {words, capabilities, abstraction} or null.
        resolveWords: async function (token) {
            if (!token) return null;
            var entry = _entries.get(token);
            // Memory source — fastest path, no network request
            if (entry && entry.sources && entry.sources.memory &&
                entry.sources.memory.words && entry.sources.memory.words.length > 0) {
                return {
                    words:        entry.sources.memory.words,
                    capabilities: entry.sources.memory.capabilities || [],
                    abstraction:  entry.abstraction
                };
            }
            // Server fallback — fetch instruction words from the API
            try {
                var r = await fetch('/api/lump/' + token + '/words');
                if (!r.ok) return null;
                var data = await r.json();
                if (data && data.words) {
                    // Cache the fetched words as an in-memory source for next time
                    this.registerMemory(token, entry ? entry.abstraction : token,
                        data.words, data.capabilities || []);
                    return {
                        words:        data.words,
                        capabilities: data.capabilities || [],
                        abstraction:  data.abstraction || (entry ? entry.abstraction : token)
                    };
                }
            } catch (_e) {}
            return null;
        },

        // Forget in-memory content for a token (called when an edit invalidates
        // the previously assembled lump).  If no server source remains, the
        // entry is removed entirely.
        evictMemory: function (token) {
            if (!token) return;
            var entry = _entries.get(token);
            if (!entry) return;
            if (entry.sources) delete entry.sources.memory;
            if (!entry.sources || (!entry.sources.memory && !entry.sources.server)) {
                _entries.delete(token);
            }
        },

        // List all known entries sorted by: server entries first (by fetchedAt
        // desc), then memory-only entries (by registeredAt desc).
        list: function () {
            var arr = [];
            _entries.forEach(function (entry) { arr.push(entry); });
            arr.sort(function (a, b) {
                var aServer = !!(a.sources && a.sources.server);
                var bServer = !!(b.sources && b.sources.server);
                if (aServer !== bServer) return aServer ? -1 : 1;
                var aT = (a.sources && (
                    (a.sources.server && a.sources.server.fetchedAt) ||
                    (a.sources.memory && a.sources.memory.registeredAt))) || 0;
                var bT = (b.sources && (
                    (b.sources.server && b.sources.server.fetchedAt) ||
                    (b.sources.memory && b.sources.memory.registeredAt))) || 0;
                return bT - aT;
            });
            return arr;
        },

        // Return a flat array of server metadata objects — backward-compat
        // replacement for code that still iterates a _lumpsCache-shaped list.
        // Objects are live references to internal entry.sources.server objects;
        // mutations to them (e.g. forked=true) persist in the registry.
        getServerList: function () {
            var out = [];
            _entries.forEach(function (entry) {
                if (entry.sources && entry.sources.server) out.push(entry.sources.server);
            });
            return out;
        },

        has: function (token) {
            return token ? _entries.has(token) : false;
        },
    };

    window.LumpRegistry = LumpRegistry;

    // ── Backward-compat proxy properties ────────────────────────────────────
    //
    // All existing code that reads/writes window._editorLastSavedToken or
    // window._pendingLumpToken automatically routes through the registry.
    // This provides zero-diff compat for the ~20 remaining read-only usages
    // while new code uses the registry API directly for all writes.

    try {
        Object.defineProperty(window, '_editorLastSavedToken', {
            get: function () { return LumpRegistry.getCurrent(); },
            set: function (v) { LumpRegistry.setCurrent(v); },
            configurable: true, enumerable: true
        });
    } catch (_e) { window._editorLastSavedToken = null; }

    try {
        Object.defineProperty(window, '_pendingLumpToken', {
            get: function () { return LumpRegistry.getPending(); },
            set: function (v) { LumpRegistry.setPending(v); },
            configurable: true, enumerable: true
        });
    } catch (_e) { window._pendingLumpToken = null; }

    // _lumpsCache — computed from the server snapshot in the registry.
    // Removing the `let _lumpsCache = []` declaration from app-abstractions.js
    // makes all script-scope reads of this name fall through to this proxy.
    // Objects returned are live references; property mutations persist in the
    // registry (e.g. `_lumpsCache[i].forked = true` from app-lumps.js).
    try {
        Object.defineProperty(window, '_lumpsCache', {
            get: function () { return LumpRegistry.getServerList(); },
            configurable: true, enumerable: true
        });
    } catch (_e) {}

    // _selectedLumpToken — computed from getCurrent().
    // Removing the `let _selectedLumpToken = null` declaration from
    // app-abstractions.js makes all script-scope reads go through this proxy.
    // Write paths (assignments) are replaced with explicit LumpRegistry.setCurrent()
    // calls in each modified function; this proxy is read-only for safety.
    try {
        Object.defineProperty(window, '_selectedLumpToken', {
            get: function () { return LumpRegistry.getCurrent(); },
            configurable: true, enumerable: true
        });
    } catch (_e) {}

}());

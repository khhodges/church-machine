// lump-registry.js — Global Pet Name Namespace (GPNN) Singleton
//
// Single source of truth for all digital object identity in the IDE.
// Token (CRC-32 hex string, 8 chars) is the universal global identifier.
// Physical NS slot numbers are private implementation details — never used
// as resolution keys outside of lumpTokenAtSlot().
//
// Producer API (called at assemble/compile/save/fetch time):
//   LumpRegistry.registerMemory(token, words, caps, name)
//   LumpRegistry.registerFromServer(lumps)
//   LumpRegistry.setCurrent(token)
//   LumpRegistry.setPending(token)
//   LumpRegistry.clearPending()
//
// Consumer API (called at navigation/display time):
//   LumpRegistry.getCurrent()         → token string | null
//   LumpRegistry.getPending()         → token string | null
//   LumpRegistry.resolve(token)       → descriptor object | null
//   LumpRegistry.resolveWords(token)  → Uint32Array | null  (memory-only)
//   LumpRegistry.getServerList()      → raw /api/lumps/list array
//
// Backward-compat proxy properties on window:
//   window._editorLastSavedToken  ←→ LumpRegistry.setCurrent / getCurrent
//   window._pendingLumpToken      ←→ LumpRegistry.setPending / getPending
//
// All existing code that reads/writes these window properties continues to
// work transparently; the registry is the actual storage.

(function () {
    'use strict';

    var _current = null;          // token of currently compiled/selected lump
    var _pending = null;          // token pending navigation to Lumps view
    var _serverList = [];         // raw array from /api/lumps/list
    var _serverMap  = new Map();  // token → server descriptor
    var _memoryMap  = new Map();  // token → {words, caps, abstraction, ns_slot:null}

    var LumpRegistry = {

        // ── Producers ─────────────────────────────────────────────────────────

        // Register an in-memory assembled lump (not yet server-persisted).
        // words  : Array of 32-bit instruction words (plain JS numbers)
        // caps   : Array of capability descriptors (may be empty array)
        // name   : Human-readable abstraction name (string)
        registerMemory: function (token, words, caps, name) {
            if (!token) return;
            _memoryMap.set(token, {
                source:      'memory',
                token:       token,
                words:       words ? Array.prototype.slice.call(words) : [],
                caps:        caps  ? Array.prototype.slice.call(caps)  : [],
                abstraction: name || ('Lump 0x' + token),
                ns_slot:     null,
                lump_type:   'code',
                content_type:'code',
                language:    'assembly'
            });
        },

        // Register the full lump list fetched from /api/lumps/list.
        // Called once per renderLumps() fetch; replaces the previous server snapshot.
        registerFromServer: function (lumps) {
            _serverList = lumps || [];
            _serverMap  = new Map();
            for (var i = 0; i < _serverList.length; i++) {
                var l = _serverList[i];
                if (l && l.token) {
                    _serverMap.set(l.token, Object.assign({ source: 'server' }, l));
                }
            }
        },

        // Set the token of the lump most recently compiled/saved (replaces
        // window._editorLastSavedToken as the authoritative write path).
        setCurrent: function (token) {
            _current = token || null;
        },

        // Set the token that the next renderLumps() call should pre-select
        // (replaces window._pendingLumpToken as the authoritative write path).
        setPending: function (token) {
            _pending = token || null;
        },

        clearPending: function () {
            _pending = null;
        },

        // ── Consumers ─────────────────────────────────────────────────────────

        getCurrent: function () { return _current; },
        getPending: function () { return _pending; },

        // Resolve a token to its descriptor.
        // Server entries take precedence (they include ns_slot, version, etc.).
        // Memory-only entries (freshly assembled, not yet persisted) are the fallback.
        resolve: function (token) {
            if (!token) return null;
            return _serverMap.get(token) || _memoryMap.get(token) || null;
        },

        // Resolve a token to its in-memory instruction word array.
        // Returns null for server-only lumps (words must be fetched from
        // /api/lump/<token>/words in that case, as openLumpInEditor does).
        resolveWords: function (token) {
            var e = _memoryMap.get(token);
            return (e && e.words && e.words.length > 0) ? e.words : null;
        },

        // Raw server list for code that still iterates _lumpsCache.
        getServerList: function () { return _serverList; },

        // Check whether a token is known to the registry (either source).
        has: function (token) {
            return token ? (_serverMap.has(token) || _memoryMap.has(token)) : false;
        },

        // Return all known tokens (server + memory, deduped).
        allTokens: function () {
            var seen = new Set();
            _serverMap.forEach(function (_, t) { seen.add(t); });
            _memoryMap.forEach(function (_, t) { seen.add(t); });
            return Array.from(seen);
        },
    };

    window.LumpRegistry = LumpRegistry;

    // ── Backward-compat proxy properties ────────────────────────────────────
    //
    // All existing code that reads/writes window._editorLastSavedToken or
    // window._pendingLumpToken automatically routes through the registry.
    // This means the 22+ existing call sites need zero changes while the
    // registry is the actual source of truth.
    //
    // Both properties are defined as configurable so test harnesses can
    // override them if needed.

    try {
        Object.defineProperty(window, '_editorLastSavedToken', {
            get: function () { return LumpRegistry.getCurrent(); },
            set: function (v) { LumpRegistry.setCurrent(v); },
            configurable: true,
            enumerable:   true
        });
    } catch (_e) {
        // Fallback: defineProperty not available (e.g. some test VMs)
        window._editorLastSavedToken = null;
    }

    try {
        Object.defineProperty(window, '_pendingLumpToken', {
            get: function () { return LumpRegistry.getPending(); },
            set: function (v) { LumpRegistry.setPending(v); },
            configurable: true,
            enumerable:   true
        });
    } catch (_e) {
        window._pendingLumpToken = null;
    }

}());

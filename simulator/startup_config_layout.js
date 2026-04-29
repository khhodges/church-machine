// =============================================================================
// startup_config_layout.js — Startup.Config lump layout constants
// =============================================================================
//
// Single source of truth for the Startup.Config lump memory layout (Task #512).
// All files that read or write the Startup.Config lump must import these
// constants instead of hardcoding them.  If the layout changes, only this file
// and server/startup_config_layout.py need updating.
//
// Lump layout (64 words total, cw=3, cc=1):
//   word  0            : lump header
//   words 1-3          : code region (3 CLOOMC instructions)
//   words 4-62         : data region (59 words = keys 0..58)
//     word 4  (key 0)  : entry_slot
//     word 5  (key 1)  : config_version
//     word 6  (key 2)  : flags               ← SC_FLAGS_WORD
//     word 7  (key 3)  : fault_count         ← SC_FAULT_COUNT_WORD
//     words 8-62       : user params (keys 4..58)
//   word 63            : c-list slot 0 (configured entry E-GT)
//
// Python mirror: server/startup_config_layout.py defines the same five constants
// so server/boot_image.py can import them.  Keep the two files in sync.

(function () {
    var _SC = {
        SC_DATA_OFFSET:      4,   // first data word index in lump (after header + 3-word code region)
        SC_LAST_DATA_KEY:    58,  // last valid ReadParam / WriteParam key  (word 62 in lump)
        SC_OOB_KEY:          59,  // first out-of-bounds key (would reach c-list at word 63)
        SC_FLAGS_WORD:       6,   // absolute lump word index for flags      (data key 2)
        SC_FAULT_COUNT_WORD: 7,   // absolute lump word index for fault_count (data key 3)
    };

    if (typeof module !== 'undefined') {
        module.exports = _SC;
    } else if (typeof window !== 'undefined') {
        window.StartupConfigLayout = _SC;
    }
})();

// Cache-busting guard: force navigation to the versioned simulator URL if on the plain
// /simulator/ path.  This file has no version tag so browsers always revalidate via ETag —
// meaning even a tab that has had /simulator/ cached for days will execute this fresh code
// and be sent to the versioned URL where the correct HTML is served.
(function _simulatorCacheBust() {
    if (typeof window === 'undefined' || !window.location) return;
    var _VER = 'r20260429e';
    var _path = window.location.pathname;
    // If not already on this exact versioned URL, redirect (catches both /simulator/ and old /~/rXXX).
    if (_path.indexOf('/simulator/') === 0 && !_path.startsWith('/simulator/~/' + _VER)) {
        window.location.replace('/simulator/~/' + _VER + (window.location.hash || ''));
    }
})();

// Failsafe: inject "Turing DR Test ✦" tab if missing from HTML.
(function _ensureTuringDRTab() {
    if (typeof document === 'undefined') return;
    function _inject() {
        if (document.querySelector('[data-example="led_turing_full"]')) return;
        var anchor = document.querySelector('[data-example="turing_test"]');
        if (!anchor) return;
        var btn = document.createElement('button');
        btn.className = 'example-tab';
        btn.setAttribute('data-example', 'led_turing_full');
        btn.setAttribute('data-tooltip', 'Turing DR Test \u2014 Full visual ISA test across all DR0\u2013DR15 registers');
        btn.style.color = '#4ade80';
        btn.onclick = function() { if (typeof loadExample === 'function') loadExample('led_turing_full'); };
        btn.textContent = 'Turing DR Test \u2736';
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _inject);
    } else {
        _inject();
    }
})();

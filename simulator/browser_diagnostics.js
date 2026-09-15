/* Early, privacy-limited crash telemetry. No source, arbitrary messages,
 * function names, URL queries, form values or persistent browser identifiers. */
(function () {
    'use strict';
    var lastInteraction = 'none';
    var lastInteractionAt = 0;
    var seen = new Map();
    var sent = 0;
    var windowStart = Date.now();
    var errorTypes = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError',
        'RangeError', 'URIError', 'EvalError'];

    // ErrorEvent.error and PromiseRejectionEvent.reason are allowed to contain
    // arbitrary thrown values. Keep malformed script/rejection events from
    // reaching a later crash monitor, while allowing actual Error instances to
    // remain visible. The tag check also recognizes Error instances from
    // another window/realm. Resource failures intentionally stay observable.
    function isRealError(value) {
        try {
            return value instanceof Error ||
                Object.prototype.toString.call(value) === '[object Error]';
        } catch (_) {
            return false;
        }
    }
    function containNonErrorEvent(event) {
        try {
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
        } catch (_) {}
        try {
            if (event && typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        } catch (_) {}
    }
    function warnContained(kind) {
        try {
            if (typeof console !== 'undefined' && console &&
                    typeof console.warn === 'function') {
                var label = kind === 'rejection' ? 'rejection' : 'window error';
                console.warn('[Church Machine] Caught non-Error ' + label +
                    ': [details withheld]');
            }
        } catch (_) {}
    }
    function fileName(value) {
        try {
            var url = new URL(value, location.href);
            if (url.origin !== location.origin) return '';
            if (/^\/simulator\/~\/[a-f0-9]{7,64}$/.test(url.pathname)) return 'index.html';
            var match = url.pathname.match(/^\/simulator\/([a-zA-Z0-9_-]+\.(?:js|css|html))$/);
            return match ? match[1] : '';
        } catch (_) { return ''; }
    }
    function position(value) {
        return Number.isInteger(value) && value >= 0 && value <= 1000000 ? value : 0;
    }
    function framesFor(error, event) {
        var frames = [];
        function add(file, line, column) {
            file = fileName(file);
            if (!file || frames.length >= 8) return;
            var frame = {file: file, line: position(Number(line)), column: position(Number(column))};
            if (!frames.some(function(f) {
                return f.file === frame.file && f.line === frame.line && f.column === frame.column;
            })) frames.push(frame);
        }
        if (event && event.filename) add(event.filename, event.lineno, event.colno);
        // Extract locations only. Never transmit error text, code or function names.
        if (error && typeof error.stack === 'string') {
            error.stack.split('\n').slice(1, 16).forEach(function(line) {
                var match = line.match(/(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/);
                if (match) add(match[1], match[2], match[3]);
            });
        }
        return frames;
    }
    function browserFamily() {
        var ua = navigator.userAgent || '';
        return /Firefox\//.test(ua) ? 'firefox' :
            /Chrome\/|Chromium\/|Edg\//.test(ua) ? 'chromium' :
            /Safari\//.test(ua) ? 'safari' : 'other';
    }
    function report(kind, error, event, resource) {
        try {
            var now = Date.now();
            if (now - windowStart >= 60000) { sent = 0; windowStart = now; seen.clear(); }
            if (sent >= 10) return;
            var editor = document.getElementById('editor');
            var version = location.pathname.match(/\/simulator\/~\/([a-f0-9]{7,64})$/);
            var payload = {
                kind: kind,
                error_type: error && errorTypes.indexOf(error.name) !== -1 ? error.name : 'NonError',
                occurred_at: new Date(now).toISOString(),
                page: editor && editor.classList.contains('active') ? 'editor' : 'other',
                interaction: now - lastInteractionAt < 10000 ? lastInteraction : 'none',
                browser: browserFamily(),
                viewport: {width: position(Math.round(window.innerWidth)), height: position(Math.round(window.innerHeight))},
                frames: framesFor(error, event),
                resource: resource || '',
                version: version ? version[1] : 'unknown'
            };
            var key = JSON.stringify([kind, payload.error_type, payload.frames, payload.resource]);
            if (seen.has(key)) return;
            seen.set(key, true);
            sent++;
            // No retries: diagnostic outages must never produce more errors or
            // affect the IDE. keepalive allows delivery during page teardown.
            fetch('/api/browser-diagnostics', {
                method: 'POST', credentials: 'omit', keepalive: true,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            }).catch(function() {});
        } catch (_) { /* Reporting itself must never interrupt the application. */ }
    }
    ['scroll', 'resize', 'click', 'keydown'].forEach(function(kind) {
        window.addEventListener(kind, function() {
            lastInteraction = kind; lastInteractionAt = Date.now();
        }, {capture: true, passive: true});
    });
    // Loaded before the existing containment guards: report and contain
    // non-Error script/rejection events before they reach the preview monitor.
    // Resource failures are reported but deliberately continue to later
    // listeners/default handling because they can break application startup.
    window.addEventListener('error', function(event) {
        var target = event.target;
        if (target && target !== window && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
            var resource = fileName(target.src || target.href);
            if (resource) report('resource', null, null, resource);
            return;
        }
        var kind = /^ResizeObserver loop/.test(event.message || '') ? 'resize_observer' : 'script';
        if (!isRealError(event.error)) {
            if (kind !== 'resize_observer') warnContained('script');
            containNonErrorEvent(event);
        }
        report(kind, event.error, event);
    }, true);
    window.addEventListener('unhandledrejection', function(event) {
        if (!isRealError(event.reason)) {
            warnContained('rejection');
            containNonErrorEvent(event);
        }
        report('rejection', event.reason);
    }, true);
})();